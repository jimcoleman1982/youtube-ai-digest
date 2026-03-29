import type { Config } from "@netlify/functions";
import { generateDigest, formatDigestForSlack } from "./lib/digest.js";
import { appendUsageLog } from "./lib/blobs.js";

/**
 * Daily AI digest - runs at 7 PM MT (1 AM UTC).
 * Synthesizes all videos processed today into a single intelligence brief
 * and posts it to Slack.
 */
export default async function handler() {
  console.log("daily-digest: starting");

  try {
    // Today's date in MT (UTC-6 during MDT)
    const now = new Date();
    const mtOffset = -6 * 60;
    const mtTime = new Date(now.getTime() + mtOffset * 60 * 1000);
    const today = mtTime.toISOString().split("T")[0];

    console.log(`daily-digest: generating for ${today}`);

    const digest = await generateDigest("daily", today, today);

    if (!digest) {
      console.log("daily-digest: no videos processed today, skipping");
      return new Response("No videos today", { status: 200 });
    }

    const dateLabel = new Date(today + "T12:00:00").toLocaleDateString(
      "en-US",
      { weekday: "long", month: "long", day: "numeric", year: "numeric" }
    );

    const slackMessage = formatDigestForSlack("daily", digest, dateLabel);

    // Post to Slack
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackMessage }),
      });
      if (!res.ok) {
        console.error(`Slack post failed: ${res.status}`);
      }
    } else {
      console.warn("SLACK_WEBHOOK_URL not set");
    }

    // Log usage
    await appendUsageLog({
      date: today,
      videoId: "daily-digest",
      inputTokens: digest.tokenUsage.inputTokens,
      outputTokens: digest.tokenUsage.outputTokens,
      estimatedCost: digest.tokenUsage.estimatedCost,
      isAdHoc: false,
    });

    console.log(
      `daily-digest: done. ${digest.videoCount} videos, ${digest.channelCount} channels.`
    );
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("daily-digest error:", err);
    return new Response("Error", { status: 500 });
  }
}

// 1 AM UTC = 7 PM MDT
export const config: Config = {
  schedule: "0 1 * * *",
};

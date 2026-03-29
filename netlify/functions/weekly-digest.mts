import type { Config } from "@netlify/functions";
import { generateDigest, formatDigestForSlack } from "./lib/digest.js";
import { appendUsageLog } from "./lib/blobs.js";

/**
 * Weekly AI digest - runs Sunday at 7 PM MT (Monday 1 AM UTC).
 * Synthesizes the entire week's videos into a trend-focused brief
 * and posts it to Slack.
 */
export default async function handler() {
  console.log("weekly-digest: starting");

  try {
    // Current date in MT
    const now = new Date();
    const mtOffset = -6 * 60;
    const mtTime = new Date(now.getTime() + mtOffset * 60 * 1000);
    const endDate = mtTime.toISOString().split("T")[0];

    // Go back 7 days
    const startTime = new Date(mtTime.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = startTime.toISOString().split("T")[0];

    console.log(`weekly-digest: generating for ${startDate} to ${endDate}`);

    const digest = await generateDigest("weekly", startDate, endDate);

    if (!digest) {
      console.log("weekly-digest: no videos this week, skipping");
      return new Response("No videos this week", { status: 200 });
    }

    const startLabel = new Date(startDate + "T12:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" }
    );
    const endLabel = new Date(endDate + "T12:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" }
    );
    const dateLabel = `${startLabel} - ${endLabel}`;

    const slackMessage = formatDigestForSlack("weekly", digest, dateLabel);

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
      date: endDate,
      videoId: "weekly-digest",
      inputTokens: digest.tokenUsage.inputTokens,
      outputTokens: digest.tokenUsage.outputTokens,
      estimatedCost: digest.tokenUsage.estimatedCost,
      isAdHoc: false,
    });

    console.log(
      `weekly-digest: done. ${digest.videoCount} videos, ${digest.channelCount} channels.`
    );
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("weekly-digest error:", err);
    return new Response("Error", { status: 500 });
  }
}

// Monday 1 AM UTC = Sunday 7 PM MDT
export const config: Config = {
  schedule: "0 1 * * 1",
};

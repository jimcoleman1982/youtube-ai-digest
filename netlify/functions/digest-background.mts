import type { Context } from "@netlify/functions";
import { generateDigest, formatDigestForSlack } from "./lib/digest.js";
import { appendUsageLog } from "./lib/blobs.js";

/**
 * Background function (15-min timeout) that generates and posts
 * daily or weekly AI digests to Slack.
 */
export default async (req: Request, context: Context) => {
  let period: "daily" | "weekly" = "daily";

  // Check if period was passed as query param or in body
  const url = new URL(req.url);
  const paramPeriod = url.searchParams.get("period");
  if (paramPeriod === "weekly") period = "weekly";

  try {
    const body = await req.text();
    if (body) {
      const parsed = JSON.parse(body);
      if (parsed.period === "weekly") period = "weekly";
    }
  } catch {
    // no body, use default or query param
  }

  console.log(`digest-background: starting ${period} digest`);

  try {
    // Current date in MT (UTC-6 during MDT)
    const now = new Date();
    const mtOffset = -6 * 60;
    const mtTime = new Date(now.getTime() + mtOffset * 60 * 1000);
    const endDate = mtTime.toISOString().split("T")[0];

    let startDate: string;
    if (period === "weekly") {
      const startTime = new Date(mtTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = startTime.toISOString().split("T")[0];
    } else {
      startDate = endDate;
    }

    console.log(`digest-background: ${period} for ${startDate} to ${endDate}`);

    const digest = await generateDigest(period, startDate, endDate);

    if (!digest) {
      console.log(`digest-background: no videos for ${period}, skipping`);
      return;
    }

    // Format date label
    let dateLabel: string;
    if (period === "daily") {
      dateLabel = new Date(endDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } else {
      const startLabel = new Date(startDate + "T12:00:00").toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
      );
      const endLabel = new Date(endDate + "T12:00:00").toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      );
      dateLabel = `${startLabel} - ${endLabel}`;
    }

    const slackMessage = formatDigestForSlack(period, digest, dateLabel);

    // Post to the digest-specific Slack channel, fall back to default
    const webhookUrl =
      Netlify.env.get("SLACK_DIGEST_WEBHOOK_URL") ||
      process.env.SLACK_WEBHOOK_URL;

    if (webhookUrl) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: slackMessage }),
      });
      if (!res.ok) {
        console.error(`Slack post failed: ${res.status}`);
      } else {
        console.log(`digest-background: posted ${period} digest to Slack`);
      }
    } else {
      console.warn("No Slack webhook URL configured for digests");
    }

    // Log usage
    await appendUsageLog({
      date: endDate,
      videoId: `${period}-digest`,
      inputTokens: digest.tokenUsage.inputTokens,
      outputTokens: digest.tokenUsage.outputTokens,
      estimatedCost: digest.tokenUsage.estimatedCost,
      isAdHoc: false,
    });

    console.log(
      `digest-background: done. ${digest.videoCount} videos, ${digest.channelCount} channels.`
    );
  } catch (err) {
    console.error(`digest-background (${period}) error:`, err);
  }
};

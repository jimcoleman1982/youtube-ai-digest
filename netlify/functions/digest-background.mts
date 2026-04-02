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
    const endDateMDT = mtTime.toISOString().split("T")[0]; // e.g., "2026-04-01" (MDT calendar date)

    let startDateMDT: string;
    let windowStart: string;
    let windowEnd: string;

    if (period === "weekly") {
      const startMT = new Date(mtTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDateMDT = startMT.toISOString().split("T")[0];
      // UTC bounds: midnight MDT = 6 AM UTC
      windowStart = startDateMDT + "T06:00:00.000Z";
      windowEnd = new Date(new Date(endDateMDT + "T06:00:00.000Z").getTime() + 24 * 60 * 60 * 1000).toISOString();
    } else {
      startDateMDT = endDateMDT;
      // MDT day runs from 6 AM UTC to 6 AM UTC the next day
      windowStart = endDateMDT + "T06:00:00.000Z";
      windowEnd = new Date(new Date(windowStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    console.log(`digest-background: ${period} window ${windowStart} to ${windowEnd}`);

    const digest = await generateDigest(period, windowStart, windowEnd);

    if (!digest) {
      console.log(`digest-background: no videos for ${period}, sending no-content notice`);
      const noContentWebhook =
        Netlify.env.get("SLACK_DIGEST_WEBHOOK_URL") ||
        process.env.SLACK_WEBHOOK_URL;
      if (noContentWebhook && period === "daily") {
        const dateLabel = new Date(endDateMDT + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "long", month: "long", day: "numeric", year: "numeric",
        });
        await fetch(noContentWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `_No new AI content processed for ${dateLabel}. System is running fine -- nothing to summarize today._`,
          }),
        });
      }
      return;
    }

    // Format date label
    let dateLabel: string;
    if (period === "daily") {
      dateLabel = new Date(endDateMDT + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } else {
      const startLabel = new Date(startDateMDT + "T12:00:00").toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric" }
      );
      const endLabel = new Date(endDateMDT + "T12:00:00").toLocaleDateString(
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
      date: endDateMDT,
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

import type { Config, Context } from "@netlify/functions";
import { getLastCheck } from "./lib/blobs.js";

const HEALTH_ALERT_HOURS = 12;

/**
 * Scheduled function (30-second limit).
 * Triggers the background function which has a 15-minute timeout.
 * Also fires a Slack alert if no videos have been processed in 12+ hours.
 */
export default async (req: Request, context: Context) => {
  const { next_run } = await req.json();
  console.log("check-new-videos: triggered. Next run:", next_run);

  const siteUrl = process.env.URL || "https://youtube-ai-digest.netlify.app";

  // Health check: alert Slack if processing has stalled for 12+ hours
  try {
    const lastCheck = await getLastCheck();
    if (lastCheck) {
      const hoursSinceLastCheck =
        (Date.now() - new Date(lastCheck).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCheck >= HEALTH_ALERT_HOURS) {
        const webhookUrl =
          Netlify.env.get("SLACK_WEBHOOK_URL") ||
          process.env.SLACK_WEBHOOK_URL;
        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `:warning: *YouTube AI Digest health alert:* No videos have been successfully processed in ${Math.round(hoursSinceLastCheck)} hours (last check: ${lastCheck}). The transcript proxy or pipeline may be down.`,
            }),
          });
          console.log(`check-new-videos: health alert sent (${Math.round(hoursSinceLastCheck)}h since last check)`);
        }
      }
    }
  } catch (err) {
    console.error("check-new-videos: health check failed", err);
  }

  // Trigger the background function to do the heavy processing
  try {
    await fetch(`${siteUrl}/.netlify/functions/process-videos-background`, {
      method: "POST",
    });
    console.log("check-new-videos: background function triggered");
  } catch (err) {
    console.error("check-new-videos: failed to trigger background function", err);
  }
};

export const config: Config = {
  schedule: "@hourly",
};

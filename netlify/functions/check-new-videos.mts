import type { Config, Context } from "@netlify/functions";

/**
 * Scheduled function (30-second limit).
 * Triggers the background function which has a 15-minute timeout.
 */
export default async (req: Request, context: Context) => {
  const { next_run } = await req.json();
  console.log("check-new-videos: triggered. Next run:", next_run);

  // Call the background function to do the heavy processing
  const siteUrl = process.env.URL || "https://youtube-ai-digest.netlify.app";
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

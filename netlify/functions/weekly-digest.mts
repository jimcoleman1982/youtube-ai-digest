import type { Config } from "@netlify/functions";

/**
 * Weekly digest trigger - runs Sunday at 7 PM MT (Monday 1 AM UTC).
 * Kicks off the background function which has a 15-min timeout.
 */
export default async function handler() {
  console.log("weekly-digest: triggering background function");

  const siteUrl =
    process.env.URL || "https://youtube-ai-digest.netlify.app";

  try {
    await fetch(
      `${siteUrl}/.netlify/functions/digest-background?period=weekly`,
      { method: "POST" }
    );
    console.log("weekly-digest: background function triggered");
  } catch (err) {
    console.error("weekly-digest: failed to trigger background", err);
  }

  return new Response("OK", { status: 200 });
}

// Monday 1 AM UTC = Sunday 7 PM MDT
export const config: Config = {
  schedule: "0 1 * * 1",
};

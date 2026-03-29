import type { Config } from "@netlify/functions";

/**
 * Daily digest trigger - runs at 7 PM MT (1 AM UTC).
 * Kicks off the background function which has a 15-min timeout.
 */
export default async function handler() {
  console.log("daily-digest: triggering background function");

  const siteUrl =
    process.env.URL || "https://youtube-ai-digest.netlify.app";

  try {
    await fetch(
      `${siteUrl}/.netlify/functions/digest-background?period=daily`,
      { method: "POST" }
    );
    console.log("daily-digest: background function triggered");
  } catch (err) {
    console.error("daily-digest: failed to trigger background", err);
  }

  return new Response("OK", { status: 200 });
}

// 1 AM UTC = 7 PM MDT
export const config: Config = {
  schedule: "0 1 * * *",
};

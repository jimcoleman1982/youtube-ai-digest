import type { Config } from "@netlify/functions";
import { getSummary } from "./lib/blobs.js";

export default async function handler(
  _request: Request,
  context: { params: { videoId: string } }
) {
  const videoId = context.params.videoId;

  const summary = await getSummary(videoId);
  if (!summary) {
    return new Response(
      JSON.stringify({ error: "Summary not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify(summary), {
    headers: { "Content-Type": "application/json" },
  });
}

export const config: Config = {
  path: "/api/summaries/:videoId",
  method: "GET",
};

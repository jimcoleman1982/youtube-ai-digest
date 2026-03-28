import type { Context, Config } from "@netlify/functions";
import { getProcessedVideos, setProcessedVideos } from "./lib/blobs.js";
import { fetchTranscript } from "./lib/transcript.js";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // Reset pending videos so they get retried
    if (action === "reset-pending") {
      const processedVideos = await getProcessedVideos();
      const kept = processedVideos.filter(
        (v) => v.status === "completed" || v.status === "no-transcript"
      );
      await setProcessedVideos(kept);
      return Response.json({
        removed: processedVideos.length - kept.length,
        remaining: kept.length,
      });
    }

    // Test transcript fetch
    const testVideoId = url.searchParams.get("test");
    if (testVideoId) {
      const siteUrl = Netlify.env.get("URL") || "https://youtube-ai-digest.netlify.app";
      const proxyUrl = `${siteUrl}/edge/transcript-proxy?videoId=${testVideoId}`;

      // First test: direct edge function call
      let edgeResult: any = {};
      try {
        const edgeRes = await fetch(proxyUrl);
        edgeResult = {
          status: edgeRes.status,
          contentType: edgeRes.headers.get("content-type"),
          body: await edgeRes.text(),
        };
        // Try to parse as JSON
        try {
          edgeResult.parsed = JSON.parse(edgeResult.body);
          edgeResult.body = `[${edgeResult.body.length} chars]`;
        } catch { /* not json */ }
      } catch (err) {
        edgeResult = { error: String(err) };
      }

      // Second test: through transcript.ts
      const startTime = Date.now();
      const segments = await fetchTranscript(testVideoId);
      const elapsed = Date.now() - startTime;

      return Response.json({
        videoId: testVideoId,
        siteUrl,
        proxyUrl,
        edgeResult,
        success: segments !== null && segments.length > 0,
        segmentCount: segments?.length || 0,
        firstSegment: segments?.[0] || null,
        lastSegment: segments?.[segments.length - 1] || null,
        elapsedMs: elapsed,
      });
    }

    // Show current state
    const processedVideos = await getProcessedVideos();
    return Response.json({
      totalProcessed: processedVideos.length,
      statuses: processedVideos.map((v) => ({
        id: v.videoId,
        status: v.status,
        attempts: v.attempts,
      })),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/debug",
};

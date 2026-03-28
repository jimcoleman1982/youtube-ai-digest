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
      const startTime = Date.now();
      const segments = await fetchTranscript(testVideoId);
      const elapsed = Date.now() - startTime;

      return Response.json({
        videoId: testVideoId,
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

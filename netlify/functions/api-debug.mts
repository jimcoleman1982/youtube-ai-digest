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
      const transcriptProxyUrl = Netlify.env.get("TRANSCRIPT_PROXY_URL") || "";
      const transcriptProxySecret = Netlify.env.get("TRANSCRIPT_PROXY_SECRET") || "";

      // Test 1: Direct local proxy test (if configured)
      let proxyResult: any = { configured: !!transcriptProxyUrl, url: transcriptProxyUrl || "NOT SET" };
      if (transcriptProxyUrl) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (transcriptProxySecret) {
            headers["Authorization"] = `Bearer ${transcriptProxySecret}`;
          }
          const proxyRes = await fetch(`${transcriptProxyUrl}/transcript`, {
            method: "POST",
            headers,
            body: JSON.stringify({ videoId: testVideoId }),
          });
          const proxyBody = await proxyRes.text();
          proxyResult.status = proxyRes.status;
          try {
            proxyResult.parsed = JSON.parse(proxyBody);
            proxyResult.bodyLength = proxyBody.length;
          } catch {
            proxyResult.body = proxyBody.slice(0, 500);
          }
        } catch (err) {
          proxyResult.error = String(err);
        }
      }

      // Test 2: Through fetchTranscript (full pipeline)
      const startTime = Date.now();
      const transcriptResult = await fetchTranscript(testVideoId);
      const elapsed = Date.now() - startTime;

      return Response.json({
        videoId: testVideoId,
        siteUrl,
        env: {
          TRANSCRIPT_PROXY_URL: transcriptProxyUrl || "NOT SET",
          TRANSCRIPT_PROXY_SECRET: transcriptProxySecret ? "SET" : "NOT SET",
        },
        proxyResult,
        fetchTranscriptResult: {
          success: transcriptResult.segments !== null && transcriptResult.segments.length > 0,
          segmentCount: transcriptResult.segments?.length || 0,
          firstSegment: transcriptResult.segments?.[0] || null,
          permanent: transcriptResult.permanent,
          elapsedMs: elapsed,
        },
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

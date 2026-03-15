import type { Config } from "@netlify/functions";
import { extractVideoId, fetchRSSFeed } from "./lib/youtube.js";
import { fetchTranscript, formatTranscriptWithTimestamps, estimateDuration, truncateTranscript } from "./lib/transcript.js";
import { summarizeTranscript } from "./lib/summarize.js";
import { appendUsageLog } from "./lib/blobs.js";
import { checkRateLimit } from "./lib/rate-limit.js";
import type { FullSummary } from "./lib/types.js";

export default async function handler(request: Request) {
  // Rate limiting
  const ip =
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";
  const rateCheck = checkRateLimit(ip, 20);
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Rate limit exceeded. Try again in ${rateCheck.retryAfterSeconds} seconds.`,
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const body = await request.json() as { url?: string };
  const url = body.url?.trim();

  if (!url) {
    return new Response(
      JSON.stringify({ success: false, error: "URL is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid YouTube URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch transcript
  const segments = await fetchTranscript(videoId);
  if (!segments) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "No transcript available for this video",
      }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const duration = estimateDuration(segments);
  const formatted = formatTranscriptWithTimestamps(segments);
  const { text: transcript } = truncateTranscript(formatted);

  // Try to get video metadata from RSS or use defaults
  let title = "Unknown Title";
  let channelName = "Unknown Channel";
  let description = "";
  let publishedDate = new Date().toISOString();
  let channelId = "";

  // Attempt to get metadata by trying common approaches
  try {
    // Try fetching the video page for metadata
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<meta name="title" content="([^"]+)"/);
      if (titleMatch) title = titleMatch[1];
      const channelMatch = html.match(/"ownerChannelName":"([^"]+)"/);
      if (channelMatch) channelName = channelMatch[1];
      const channelIdMatch = html.match(/"channelId":"(UC[^"]+)"/);
      if (channelIdMatch) channelId = channelIdMatch[1];
      const descMatch = html.match(/<meta name="description" content="([^"]+)"/);
      if (descMatch) description = descMatch[1];
      const dateMatch = html.match(/"publishDate":"([^"]+)"/);
      if (dateMatch) publishedDate = dateMatch[1];
    }
  } catch {
    // Use defaults
  }

  // Summarize
  let summarizeResult;
  try {
    summarizeResult = await summarizeTranscript({
      title,
      channelName,
      publishedDate,
      description,
      transcript,
    });
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Summarization failed, please try again",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Log usage (but don't persist the summary)
  await appendUsageLog({
    date: new Date().toISOString().split("T")[0],
    videoId,
    inputTokens: summarizeResult.tokenUsage.inputTokens,
    outputTokens: summarizeResult.tokenUsage.outputTokens,
    estimatedCost: summarizeResult.tokenUsage.estimatedCost,
    isAdHoc: true,
  });

  const summary: FullSummary = {
    videoId,
    title,
    channelName,
    channelId,
    publishedDate,
    processedAt: new Date().toISOString(),
    videoUrl: `https://youtube.com/watch?v=${videoId}`,
    description,
    status: "completed",
    estimatedDurationSeconds: duration,
    summary: summarizeResult.summary,
    tokenUsage: summarizeResult.tokenUsage,
  };

  return new Response(
    JSON.stringify({ success: true, summary, isAdHoc: true }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export const config: Config = {
  path: "/api/summarize-url",
  method: "POST",
};

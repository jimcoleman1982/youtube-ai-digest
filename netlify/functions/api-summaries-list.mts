import type { Config } from "@netlify/functions";
import { getSummariesIndex } from "./lib/blobs.js";

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const search = url.searchParams.get("search")?.toLowerCase();
  const page = parseInt(url.searchParams.get("page") || "1");
  const importance = parseInt(url.searchParams.get("importance") || "0");
  const pageSize = 50;

  let index = await getSummariesIndex();

  // Filter by channel
  if (channel) {
    index = index.filter((s) => s.channelId === channel || s.channelName === channel);
  }

  // Filter by importance
  if (importance > 0) {
    index = index.filter((s) => s.importanceScore >= importance);
  }

  // Filter by search text
  if (search) {
    index = index.filter(
      (s) =>
        s.title.toLowerCase().includes(search) ||
        s.tldr.toLowerCase().includes(search) ||
        s.channelName.toLowerCase().includes(search)
    );
  }

  // Sort newest first by processedAt
  index.sort((a, b) => {
    const ta = a.processedAt || a.publishedDate || "";
    const tb = b.processedAt || b.publishedDate || "";
    return tb.localeCompare(ta);
  });

  const total = index.length;
  const start = (page - 1) * pageSize;
  const paginated = index.slice(start, start + pageSize);

  return new Response(
    JSON.stringify({
      summaries: paginated,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export const config: Config = {
  path: "/api/summaries",
  method: "GET",
};

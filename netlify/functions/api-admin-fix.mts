import type { Config } from "@netlify/functions";
import {
  getSummariesIndex,
  setSummariesIndex,
  getSummary,
  setSummary,
  getProcessedVideos,
  setProcessedVideos,
} from "./lib/blobs.js";

/**
 * One-time admin fix endpoint.
 * - Renames "AI News & Strategy Daily | Nate B Jones" to "Nate Jones" in all summaries
 * - Resets failed "no-transcript" videos so they retry
 */
export default async function handler(request: Request) {
  const fixes: string[] = [];

  // 1. Fix channel name in summaries index
  const index = await getSummariesIndex();
  let indexChanged = false;
  for (const entry of index) {
    if (entry.channelName && entry.channelName.includes("Nate B Jones")) {
      fixes.push(`Index: renamed "${entry.channelName}" -> "Nate Jones" for ${entry.videoId}`);
      entry.channelName = "Nate Jones";
      indexChanged = true;
    }
  }
  if (indexChanged) {
    await setSummariesIndex(index);
  }

  // 2. Fix channel name in individual summary blobs
  for (const entry of index) {
    if (entry.channelName === "Nate Jones") {
      const summary = await getSummary(entry.videoId);
      if (summary && summary.channelName && summary.channelName.includes("Nate B Jones")) {
        summary.channelName = "Nate Jones";
        await setSummary(entry.videoId, summary);
        fixes.push(`Summary blob: renamed channelName for ${entry.videoId}`);
      }
      // Also check channelTitle field
      if (summary && (summary as any).channelTitle && (summary as any).channelTitle.includes("Nate B Jones")) {
        (summary as any).channelTitle = "Nate Jones";
        await setSummary(entry.videoId, summary);
        fixes.push(`Summary blob: renamed channelTitle for ${entry.videoId}`);
      }
    }
  }

  // 3. Reset no-transcript videos so they retry
  const processed = await getProcessedVideos();
  const resetIds: string[] = [];
  const updated = processed.filter((v) => {
    if (v.status === "no-transcript" && v.attempts >= 3) {
      resetIds.push(v.id);
      return false; // Remove from processed list so they retry
    }
    return true;
  });

  if (resetIds.length > 0) {
    await setProcessedVideos(updated);
    fixes.push(`Reset ${resetIds.length} failed videos for retry: ${resetIds.join(", ")}`);
  }

  return new Response(JSON.stringify({ fixes, totalFixes: fixes.length }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const config: Config = {
  path: "/api/admin-fix",
  method: "POST",
};

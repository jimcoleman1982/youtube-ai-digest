import type { Config } from "@netlify/functions";
import { getChannels, setChannels, getSummariesIndex, setSummariesIndex, getSummary, setSummary } from "./lib/blobs.js";

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const channelId = url.pathname.split("/").pop();

  if (!channelId) {
    return new Response(
      JSON.stringify({ error: "Channel ID is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await request.json() as { channelName?: string };
  const newName = body.channelName?.trim();

  if (!newName) {
    return new Response(
      JSON.stringify({ error: "channelName is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Update channel list
  const channels = await getChannels();
  const channel = channels.find((c) => c.channelId === channelId);

  if (!channel) {
    return new Response(
      JSON.stringify({ error: "Channel not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const oldName = channel.channelName;
  channel.channelName = newName;
  await setChannels(channels);

  // Update summaries index entries for this channel
  const index = await getSummariesIndex();
  let updatedCount = 0;
  for (const entry of index) {
    if (entry.channelId === channelId) {
      entry.channelName = newName;
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    await setSummariesIndex(index);
  }

  // Update individual summary records
  for (const entry of index) {
    if (entry.channelId === channelId) {
      const summary = await getSummary(entry.videoId);
      if (summary && summary.channelName !== newName) {
        summary.channelName = newName;
        await setSummary(entry.videoId, summary);
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      channelId,
      oldName,
      newName,
      summariesUpdated: updatedCount,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export const config: Config = {
  path: "/api/channels/:id",
  method: "PATCH",
};

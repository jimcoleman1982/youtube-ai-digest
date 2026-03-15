import type { Config } from "@netlify/functions";
import { getChannels, setChannels } from "./lib/blobs.js";
import { resolveChannelId } from "./lib/youtube.js";

export default async function handler(request: Request) {
  const body = await request.json() as { url?: string };
  const url = body.url?.trim();

  if (!url) {
    return new Response(
      JSON.stringify({ error: "URL is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const resolved = await resolveChannelId(url);
  if (!resolved) {
    return new Response(
      JSON.stringify({ error: "Could not resolve channel from URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const channels = await getChannels();

  // Check for duplicates
  if (channels.some((c) => c.channelId === resolved.channelId)) {
    return new Response(
      JSON.stringify({ error: "Channel already exists", channel: channels.find(c => c.channelId === resolved.channelId) }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  const newChannel = {
    channelId: resolved.channelId,
    channelName: resolved.channelName,
    handleUrl: url,
    addedAt: new Date().toISOString(),
  };

  channels.push(newChannel);
  await setChannels(channels);

  return new Response(JSON.stringify(newChannel), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

export const config: Config = {
  path: "/api/channels",
  method: "POST",
};

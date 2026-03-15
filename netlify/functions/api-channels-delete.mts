import type { Config } from "@netlify/functions";
import { getChannels, setChannels } from "./lib/blobs.js";

export default async function handler(
  request: Request,
  context: { params: { id: string } }
) {
  const channelId = context.params.id;

  const channels = await getChannels();
  const filtered = channels.filter((c) => c.channelId !== channelId);

  if (filtered.length === channels.length) {
    return new Response(
      JSON.stringify({ error: "Channel not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  await setChannels(filtered);

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export const config: Config = {
  path: "/api/channels/:id",
  method: "DELETE",
};

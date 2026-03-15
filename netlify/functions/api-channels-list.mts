import type { Config } from "@netlify/functions";
import { getChannels } from "./lib/blobs.js";

export default async function handler() {
  const channels = await getChannels();
  return new Response(JSON.stringify(channels), {
    headers: { "Content-Type": "application/json" },
  });
}

export const config: Config = {
  path: "/api/channels",
  method: "GET",
};

import { XMLParser } from "fast-xml-parser";
import type { VideoEntry } from "./types.js";

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchRSSFeed(
  channelId: string
): Promise<VideoEntry[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(feedUrl);
  if (!res.ok) {
    console.error(`RSS fetch failed for ${channelId}: ${res.status}`);
    return [];
  }

  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xml);

  const feed = parsed?.feed;
  if (!feed) return [];

  const entries = Array.isArray(feed.entry)
    ? feed.entry
    : feed.entry
      ? [feed.entry]
      : [];

  return entries.map((entry: Record<string, unknown>) => {
    const videoId =
      (entry["yt:videoId"] as string) ||
      "";
    const title = (entry.title as string) || "";
    const published = (entry.published as string) || "";
    const channelName =
      (entry.author as { name?: string })?.name || feed.title || "";

    // Media group may contain description
    const mediaGroup = entry["media:group"] as Record<string, unknown> | undefined;
    const description =
      (mediaGroup?.["media:description"] as string) || "";

    return {
      videoId,
      title,
      channelName,
      channelId,
      publishedDate: published,
      description,
    };
  });
}

export async function resolveChannelId(
  handleUrl: string
): Promise<{ channelId: string; channelName: string } | null> {
  try {
    // Fetch the channel page and look for canonical channel ID
    const res = await fetch(handleUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Look for channel ID in various places in the HTML
    const channelIdMatch =
      html.match(/\"externalId\":\"(UC[a-zA-Z0-9_-]+)\"/) ||
      html.match(/channel_id=(UC[a-zA-Z0-9_-]+)/) ||
      html.match(/\"channelId\":\"(UC[a-zA-Z0-9_-]+)\"/);

    if (!channelIdMatch) return null;

    const channelId = channelIdMatch[1];

    // Try to get channel name from the page title or meta
    const nameMatch =
      html.match(/<meta property="og:title" content="([^"]+)"/) ||
      html.match(/<title>([^<]+)<\/title>/);

    let channelName = nameMatch ? nameMatch[1] : "";
    // Clean up " - YouTube" suffix
    channelName = channelName.replace(/ - YouTube$/, "").trim();

    // If no name from HTML, try RSS feed
    if (!channelName) {
      const feedEntries = await fetchRSSFeed(channelId);
      if (feedEntries.length > 0) {
        channelName = feedEntries[0].channelName;
      }
    }

    return { channelId, channelName: channelName || handleUrl };
  } catch (err) {
    console.error(`Failed to resolve channel: ${handleUrl}`, err);
    return null;
  }
}

export function isWithinTimeWindow(
  publishedDate: string,
  hoursBack: number
): boolean {
  const published = new Date(publishedDate).getTime();
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  return published > cutoff;
}

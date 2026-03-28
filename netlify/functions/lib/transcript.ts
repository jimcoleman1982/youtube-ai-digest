import type { TranscriptSegment } from "./types.js";

/**
 * Fetch transcript for a YouTube video.
 * Strategy 1: Local proxy via TRANSCRIPT_PROXY_URL (residential IP, most reliable)
 * Strategy 2: Edge function proxy (datacenter IP, works for some videos)
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[] | null> {
  // Strategy 1: Local proxy (residential IP via Cloudflare Tunnel)
  const proxyUrl = Netlify.env.get("TRANSCRIPT_PROXY_URL");
  const proxySecret = Netlify.env.get("TRANSCRIPT_PROXY_SECRET") || "";

  if (proxyUrl) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (proxySecret) {
        headers["Authorization"] = `Bearer ${proxySecret}`;
      }

      const res = await fetch(`${proxyUrl}/transcript`, {
        method: "POST",
        headers,
        body: JSON.stringify({ videoId }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.segments) && data.segments.length > 0) {
          return data.segments as TranscriptSegment[];
        }
        console.log(
          `Local proxy: no transcript for ${videoId}: ${data.error || "no segments"}`
        );
      } else {
        console.log(`Local proxy returned ${res.status} for ${videoId}`);
      }
    } catch (err) {
      console.log(`Local proxy unreachable for ${videoId}: ${err}`);
    }
  }

  // Strategy 2: Edge function proxy (different datacenter IPs)
  const siteUrl =
    Netlify.env.get("URL") || "https://youtube-ai-digest.netlify.app";

  try {
    const res = await fetch(
      `${siteUrl}/edge/transcript-proxy?videoId=${videoId}`
    );

    if (!res.ok) {
      console.error(
        `Edge proxy returned ${res.status} for ${videoId}`
      );
      return null;
    }

    const data = await res.json();

    if (!data.success || !data.transcript) {
      console.log(
        `Edge proxy: no transcript for ${videoId}: ${data.error || "unknown"}`
      );
      return null;
    }

    return parseTranscriptXml(data.transcript);
  } catch (err) {
    console.error(`Edge proxy error for ${videoId}:`, err);
    return null;
  }
}

function parseTranscriptXml(xml: string): TranscriptSegment[] | null {
  const segments: TranscriptSegment[] = [];
  const pRegex = /<p\s[^>]*?t="(\d+)"[^>]*?d="(\d+)"[^>]*?>([\s\S]*?)<\/p>/g;
  const sTextRegex = /<s[^>]*?>([\s\S]*?)<\/s>/g;
  const stripTags = /<[^>]+>/g;

  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const offset = parseInt(match[1]);
    const duration = parseInt(match[2]);
    const inner = match[3];

    let text = "";
    const sMatches = inner.match(sTextRegex);
    if (sMatches) {
      text = sMatches.map((s) => s.replace(stripTags, "")).join(" ");
    } else {
      text = inner.replace(stripTags, "");
    }

    text = decodeHtmlEntities(text.trim());
    if (text) {
      segments.push({ text, offset, duration });
    }
  }

  if (segments.length === 0) {
    const simpleRegex =
      /<text\s[^>]*?start="([\d.]+)"[^>]*?dur="([\d.]+)"[^>]*?>([\s\S]*?)<\/text>/g;
    while ((match = simpleRegex.exec(xml)) !== null) {
      const offset = Math.round(parseFloat(match[1]) * 1000);
      const duration = Math.round(parseFloat(match[2]) * 1000);
      const text = decodeHtmlEntities(match[3].replace(stripTags, "").trim());
      if (text) {
        segments.push({ text, offset, duration });
      }
    }
  }

  return segments.length > 0 ? segments : null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) =>
      String.fromCodePoint(parseInt(num, 10))
    );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatTranscriptWithTimestamps(
  segments: TranscriptSegment[]
): string {
  const lines: string[] = [];
  let lastTimestamp = -30;

  for (const segment of segments) {
    const startSeconds = segment.offset / 1000;
    if (startSeconds - lastTimestamp >= 30) {
      lines.push(`\n[${formatTime(startSeconds)}]`);
      lastTimestamp = startSeconds;
    }
    lines.push(segment.text);
  }

  return lines.join(" ").trim();
}

export function estimateDuration(segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  return Math.ceil((last.offset + last.duration) / 1000);
}

const MAX_TRANSCRIPT_CHARS = 720000;

export function truncateTranscript(transcript: string): {
  text: string;
  wasTruncated: boolean;
} {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return { text: transcript, wasTruncated: false };
  }
  const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  return {
    text:
      truncated +
      "\n\n[TRANSCRIPT TRUNCATED - video exceeds maximum length for summarization]",
    wasTruncated: true,
  };
}

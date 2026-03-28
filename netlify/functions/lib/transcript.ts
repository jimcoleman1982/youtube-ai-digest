import { XMLParser } from "fast-xml-parser";
import type { TranscriptSegment } from "./types.js";

/**
 * Fetch transcript via the site's own edge function proxy.
 * Edge functions run on different infrastructure than serverless functions,
 * avoiding YouTube's datacenter IP blocking.
 */
export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[] | null> {
  const siteUrl =
    Netlify.env.get("URL") || "https://youtube-ai-digest.netlify.app";

  try {
    const res = await fetch(
      `${siteUrl}/edge/transcript-proxy?videoId=${videoId}`
    );

    if (!res.ok) {
      console.error(
        `Edge transcript proxy returned ${res.status} for ${videoId}`
      );
      return null;
    }

    const data = await res.json();

    if (!data.success || !data.transcript) {
      console.log(
        `No transcript from edge proxy for ${videoId}: ${data.error || "unknown"}`
      );
      return null;
    }

    return parseTranscriptXml(data.transcript);
  } catch (err) {
    console.error(`Transcript fetch error for ${videoId}:`, err);
    return null;
  }
}

function parseTranscriptXml(xml: string): TranscriptSegment[] | null {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const parsed = parser.parse(xml);

    const body = parsed?.timedtext?.body;
    if (!body) return null;

    let paragraphs = body.p;
    if (!paragraphs) return null;
    if (!Array.isArray(paragraphs)) paragraphs = [paragraphs];

    const segments: TranscriptSegment[] = [];
    for (const p of paragraphs) {
      const offset = parseInt(p["@_t"] || "0");
      const duration = parseInt(p["@_d"] || "0");

      let text = "";
      if (typeof p === "string") {
        text = p;
      } else if (p.s) {
        const spans = Array.isArray(p.s) ? p.s : [p.s];
        text = spans
          .map((s: any) => (typeof s === "string" ? s : s["#text"] || ""))
          .join(" ");
      } else if (p["#text"] !== undefined) {
        text = String(p["#text"]);
      }

      if (text) {
        segments.push({
          text: decodeHtmlEntities(text.trim()),
          offset,
          duration,
        });
      }
    }

    return segments.length > 0 ? segments : null;
  } catch (err) {
    console.error("Failed to parse transcript XML:", err);
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));
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

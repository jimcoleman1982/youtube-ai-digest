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
  // Use regex parsing for reliability across YouTube XML format variants
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
    // Check for <s> sub-elements (format 3)
    const sMatches = inner.match(sTextRegex);
    if (sMatches) {
      text = sMatches
        .map((s) => s.replace(stripTags, ""))
        .join(" ");
    } else {
      // Plain text inside <p>
      text = inner.replace(stripTags, "");
    }

    text = decodeHtmlEntities(text.trim());
    if (text) {
      segments.push({ text, offset, duration });
    }
  }

  // Fallback: try format without </p> closing tags (self-closing or simple)
  if (segments.length === 0) {
    const simpleRegex = /<text\s[^>]*?start="([\d.]+)"[^>]*?dur="([\d.]+)"[^>]*?>([\s\S]*?)<\/text>/g;
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

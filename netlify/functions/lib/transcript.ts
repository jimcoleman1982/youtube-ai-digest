import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptSegment } from "./types.js";

export async function fetchTranscript(
  videoId: string
): Promise<TranscriptSegment[] | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "en",
    });
    if (!segments || segments.length === 0) return null;
    return segments.map((s) => ({
      text: s.text,
      offset: s.offset,
      duration: s.duration,
    }));
  } catch {
    // Try without language preference (auto-generated)
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      if (!segments || segments.length === 0) return null;
      return segments.map((s) => ({
        text: s.text,
        offset: s.offset,
        duration: s.duration,
      }));
    } catch {
      return null;
    }
  }
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
  let lastTimestamp = -30; // Force first timestamp

  for (const segment of segments) {
    const startSeconds = segment.offset / 1000;
    // Insert timestamp marker every ~30 seconds
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

// Max token approximation: ~4 chars per token
const MAX_TRANSCRIPT_CHARS = 720000; // ~180k tokens

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

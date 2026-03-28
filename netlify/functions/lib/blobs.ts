import { getStore } from "@netlify/blobs";
import type {
  Channel,
  ProcessedVideo,
  SummaryIndex,
  FullSummary,
  UsageLogEntry,
} from "./types.js";

const STORE_NAME = "youtube-digest";

function store() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

// --- Channels ---

export async function getChannels(): Promise<Channel[]> {
  const s = store();
  const data = await s.get("channels", { type: "json" });
  return (data as Channel[]) || [];
}

export async function setChannels(channels: Channel[]): Promise<void> {
  const s = store();
  await s.setJSON("channels", channels);
}

// --- Processed Videos ---

export async function getProcessedVideos(): Promise<ProcessedVideo[]> {
  const s = store();
  const data = await s.get("processed-videos", { type: "json" });
  return (data as ProcessedVideo[]) || [];
}

export async function setProcessedVideos(
  videos: ProcessedVideo[]
): Promise<void> {
  const s = store();
  await s.setJSON("processed-videos", videos);
}

export function pruneProcessedVideos(
  videos: ProcessedVideo[]
): ProcessedVideo[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return videos.filter((v) => new Date(v.processedAt).getTime() > thirtyDaysAgo);
}

// --- Summaries Index ---

export async function getSummariesIndex(): Promise<SummaryIndex[]> {
  const s = store();
  const data = await s.get("summaries-index", { type: "json" });
  return (data as SummaryIndex[]) || [];
}

export async function setSummariesIndex(
  index: SummaryIndex[]
): Promise<void> {
  const s = store();
  await s.setJSON("summaries-index", index);
}

// --- Individual Summaries ---

export async function getSummary(
  videoId: string
): Promise<FullSummary | null> {
  const s = store();
  const data = await s.get(`summary:${videoId}`, { type: "json" });
  return (data as FullSummary) || null;
}

export async function setSummary(
  videoId: string,
  summary: FullSummary
): Promise<void> {
  const s = store();
  await s.setJSON(`summary:${videoId}`, summary);
}

// --- Usage Log ---

export async function getUsageLog(): Promise<UsageLogEntry[]> {
  const s = store();
  const data = await s.get("usage-log", { type: "json" });
  return (data as UsageLogEntry[]) || [];
}

export async function appendUsageLog(entry: UsageLogEntry): Promise<void> {
  const log = await getUsageLog();
  log.push(entry);
  const s = store();
  await s.setJSON("usage-log", log);
}

// --- Last Check ---

export async function getLastCheck(): Promise<string | null> {
  const s = store();
  return await s.get("last-check");
}

export async function setLastCheck(timestamp: string): Promise<void> {
  const s = store();
  await s.set("last-check", timestamp);
}

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
  return getStore(STORE_NAME);
}

// --- Channels ---

export async function getChannels(): Promise<Channel[]> {
  const s = store();
  const data = await s.get("channels");
  if (!data) return [];
  return JSON.parse(data) as Channel[];
}

export async function setChannels(channels: Channel[]): Promise<void> {
  const s = store();
  await s.set("channels", JSON.stringify(channels));
}

// --- Processed Videos ---

export async function getProcessedVideos(): Promise<ProcessedVideo[]> {
  const s = store();
  const data = await s.get("processed-videos");
  if (!data) return [];
  return JSON.parse(data) as ProcessedVideo[];
}

export async function setProcessedVideos(
  videos: ProcessedVideo[]
): Promise<void> {
  const s = store();
  await s.set("processed-videos", JSON.stringify(videos));
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
  const data = await s.get("summaries-index");
  if (!data) return [];
  return JSON.parse(data) as SummaryIndex[];
}

export async function setSummariesIndex(
  index: SummaryIndex[]
): Promise<void> {
  const s = store();
  await s.set("summaries-index", JSON.stringify(index));
}

// --- Individual Summaries ---

export async function getSummary(
  videoId: string
): Promise<FullSummary | null> {
  const s = store();
  const data = await s.get(`summary:${videoId}`);
  if (!data) return null;
  return JSON.parse(data) as FullSummary;
}

export async function setSummary(
  videoId: string,
  summary: FullSummary
): Promise<void> {
  const s = store();
  await s.set(`summary:${videoId}`, JSON.stringify(summary));
}

// --- Usage Log ---

export async function getUsageLog(): Promise<UsageLogEntry[]> {
  const s = store();
  const data = await s.get("usage-log");
  if (!data) return [];
  return JSON.parse(data) as UsageLogEntry[];
}

export async function appendUsageLog(entry: UsageLogEntry): Promise<void> {
  const log = await getUsageLog();
  log.push(entry);
  const s = store();
  await s.set("usage-log", JSON.stringify(log));
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

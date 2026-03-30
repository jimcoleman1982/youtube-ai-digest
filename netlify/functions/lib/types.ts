export interface Channel {
  channelId: string;
  channelName: string;
  handleUrl: string;
  addedAt: string; // ISO timestamp
}

export interface ProcessedVideo {
  videoId: string;
  processedAt: string; // ISO timestamp
  attempts: number;
  status: "completed" | "no-transcript" | "pending" | "retrying";
  retryAfter?: string; // ISO timestamp - don't retry before this time
  firstSeen?: string; // ISO timestamp - when we first discovered this video
  title?: string; // saved on discovery so we don't lose it when RSS ages out
  channelName?: string;
  channelId?: string;
  publishedDate?: string;
  description?: string;
}

export interface SummaryIndex {
  videoId: string;
  channelName: string;
  channelId: string;
  title: string;
  publishedDate: string; // ISO timestamp
  processedAt: string; // ISO timestamp
  importanceScore: number;
  tldr: string;
  status: "completed" | "pending" | "no-transcript" | "failed";
}

export interface KeyMoment {
  timestamp: string; // "MM:SS"
  seconds: number;
  label: string;
}

export interface SummaryContent {
  tldr: string;
  keyPoints: string[];
  notableDetails: string;
  whyThisMatters: string;
  importanceScore: number;
  keyMoments: KeyMoment[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface FullSummary {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  publishedDate: string;
  processedAt: string;
  videoUrl: string;
  description: string;
  status: "completed" | "pending" | "no-transcript" | "failed";
  estimatedDurationSeconds: number;
  summary: SummaryContent;
  tokenUsage: TokenUsage;
}

export interface UsageLogEntry {
  date: string; // YYYY-MM-DD
  videoId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  isAdHoc: boolean;
}

export interface TranscriptSegment {
  text: string;
  offset: number; // start time in ms (youtube-transcript uses offset)
  duration: number; // in ms
}

export interface VideoEntry {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  publishedDate: string;
  description: string;
}

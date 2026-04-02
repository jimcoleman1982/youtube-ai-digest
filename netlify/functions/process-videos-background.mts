import type { Context } from "@netlify/functions";
import {
  getChannels,
  getProcessedVideos,
  setProcessedVideos,
  pruneProcessedVideos,
  getSummariesIndex,
  setSummariesIndex,
  setSummary,
  appendUsageLog,
  setLastCheck,
} from "./lib/blobs.js";
import { fetchTranscript, formatTranscriptWithTimestamps, estimateDuration, truncateTranscript } from "./lib/transcript.js";
import { summarizeTranscript } from "./lib/summarize.js";
import { postToSlack, postNoTranscriptAlert, postSummarizationFailedAlert, delay } from "./lib/slack.js";
import { fetchRSSFeed, isWithinTimeWindow } from "./lib/youtube.js";
import type { FullSummary, SummaryIndex, ProcessedVideo } from "./lib/types.js";

const MIN_VIDEO_DURATION_SECONDS = 90;

// Give up retrying after 7 days from first discovery
const MAX_RETRY_DAYS = 7;

// Backoff schedule: hours to wait after each failed attempt
// After attempt 1: wait 1h, after 2: 3h, after 3: 6h, then 12h, 24h, 24h...
const BACKOFF_HOURS = [1, 3, 6, 12, 24];

function getBackoffHours(attempts: number): number {
  if (attempts <= 0) return 0;
  const idx = Math.min(attempts - 1, BACKOFF_HOURS.length - 1);
  return BACKOFF_HOURS[idx];
}

/**
 * Background function with 15-minute timeout.
 * Does the actual video processing: RSS check, transcript fetch,
 * Claude summarization, Slack posting, Blob storage.
 */
export default async (req: Request, context: Context) => {
  console.log("process-videos-background: starting");

  try {
    const channels = await getChannels();
    if (channels.length === 0) {
      console.log("No channels configured, skipping");
      return;
    }

    let processedVideos = await getProcessedVideos();
    const completedSet = new Set(
      processedVideos
        .filter((v) => v.status === "completed")
        .map((v) => v.videoId)
    );

    let summariesIndex = await getSummariesIndex();
    let slackMessageCount = 0;
    const now = new Date();

    // Phase 1: Discover new videos from RSS feeds
    for (const channel of channels) {
      let entries;
      try {
        entries = await fetchRSSFeed(channel.channelId);
      } catch (err) {
        console.error(`RSS fetch failed for ${channel.channelName}:`, err);
        continue;
      }

      // Filter to 48-hour window for new discovery
      const recentEntries = entries.filter((e) =>
        isWithinTimeWindow(e.publishedDate, 48)
      );

      for (const entry of recentEntries) {
        if (completedSet.has(entry.videoId)) continue;

        // Save metadata on first discovery so we never lose track
        const existing = processedVideos.find((v) => v.videoId === entry.videoId);
        if (!existing) {
          processedVideos.push({
            videoId: entry.videoId,
            processedAt: now.toISOString(),
            attempts: 0,
            status: "pending",
            firstSeen: now.toISOString(),
            title: entry.title,
            channelName: entry.channelName || channel.channelName,
            channelId: channel.channelId,
            publishedDate: entry.publishedDate,
            description: entry.description,
          });
        }
      }
    }

    // Phase 2: Process all pending/retrying videos that are ready
    const videosToProcess = processedVideos.filter((v) => {
      if (v.status === "completed") return false;

      // Check if we've exceeded the max retry window (7 days from first discovery)
      const firstSeen = v.firstSeen ? new Date(v.firstSeen) : new Date(v.processedAt);
      const daysSinceFirstSeen = (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirstSeen > MAX_RETRY_DAYS) {
        // Truly give up after 7 days
        if (v.status !== "no-transcript") {
          console.log(`Giving up on ${v.title || v.videoId} after ${daysSinceFirstSeen.toFixed(1)} days (${v.attempts} attempts)`);
          v.status = "no-transcript";
          v.processedAt = now.toISOString();
        }
        return false;
      }

      // Check backoff: don't retry before retryAfter
      if (v.retryAfter && new Date(v.retryAfter) > now) {
        return false;
      }

      return true;
    });

    for (const video of videosToProcess) {
      if (completedSet.has(video.videoId)) continue;

      const videoUrl = `https://youtube.com/watch?v=${video.videoId}`;
      const title = video.title || video.videoId;

      // Try to fetch transcript
      const transcriptResult = await fetchTranscript(video.videoId);
      const segments = transcriptResult.segments;

      if (!segments) {
        video.attempts += 1;

        // If the proxy confirmed this video has no captions, give up after 2 attempts
        // (2 attempts to guard against transient misdetection)
        if (transcriptResult.permanent && video.attempts >= 2) {
          console.log(`Permanent no-caption for ${title} (confirmed after ${video.attempts} attempts). Marking no-transcript.`);
          video.status = "no-transcript";
          video.processedAt = now.toISOString();
          continue;
        }

        const backoffHours = getBackoffHours(video.attempts);
        const retryAfter = new Date(now.getTime() + backoffHours * 60 * 60 * 1000);
        video.retryAfter = retryAfter.toISOString();
        video.status = "retrying";
        video.processedAt = now.toISOString();

        console.log(`No transcript for ${title} (attempt ${video.attempts}, next retry in ${backoffHours}h)`);

        // Post Slack alert on first attempt only
        if (video.attempts === 1) {
          if (slackMessageCount > 0) await delay(500);
          await postNoTranscriptAlert(title, videoUrl);
          slackMessageCount++;
        }
        continue;
      }

      // Skip very short videos
      const duration = estimateDuration(segments);
      if (duration < MIN_VIDEO_DURATION_SECONDS) {
        console.log(`Skipping short video (${duration}s): ${title}`);
        video.status = "completed";
        video.processedAt = now.toISOString();
        video.attempts += 1;
        completedSet.add(video.videoId);
        continue;
      }

      // Format transcript and truncate if needed
      const formatted = formatTranscriptWithTimestamps(segments);
      const { text: transcript } = truncateTranscript(formatted);

      // Summarize with Claude
      let summarizeResult;
      try {
        summarizeResult = await summarizeTranscript({
          title,
          channelName: video.channelName || "",
          publishedDate: video.publishedDate || "",
          description: video.description || "",
          transcript,
        });
      } catch (err) {
        console.error(`Summarization failed for ${title}:`, err);
        if (slackMessageCount > 0) await delay(500);
        await postSummarizationFailedAlert(title, videoUrl);
        slackMessageCount++;

        video.status = "completed";
        video.processedAt = now.toISOString();
        video.attempts += 1;
        completedSet.add(video.videoId);
        continue;
      }

      const nowStr = now.toISOString();

      // Build full summary object
      const fullSummary: FullSummary = {
        videoId: video.videoId,
        title,
        channelName: video.channelName || "",
        channelId: video.channelId || "",
        publishedDate: video.publishedDate || "",
        processedAt: nowStr,
        videoUrl,
        description: video.description || "",
        status: "completed",
        estimatedDurationSeconds: duration,
        summary: summarizeResult.summary,
        tokenUsage: summarizeResult.tokenUsage,
      };

      // Save to Blobs
      await setSummary(video.videoId, fullSummary);

      // Update index (prepend for newest-first)
      const indexEntry: SummaryIndex = {
        videoId: video.videoId,
        channelName: fullSummary.channelName,
        channelId: video.channelId || "",
        title,
        publishedDate: video.publishedDate || "",
        processedAt: nowStr,
        importanceScore: summarizeResult.summary.importanceScore,
        tldr: summarizeResult.summary.tldr,
        status: "completed",
      };
      summariesIndex = [indexEntry, ...summariesIndex];

      // Log usage
      await appendUsageLog({
        date: nowStr.split("T")[0],
        videoId: video.videoId,
        inputTokens: summarizeResult.tokenUsage.inputTokens,
        outputTokens: summarizeResult.tokenUsage.outputTokens,
        estimatedCost: summarizeResult.tokenUsage.estimatedCost,
        isAdHoc: false,
      });

      // Post to Slack
      if (slackMessageCount > 0) await delay(500);
      await postToSlack(fullSummary);
      slackMessageCount++;

      // Mark as completed
      video.status = "completed";
      video.processedAt = nowStr;
      video.attempts += 1;
      completedSet.add(video.videoId);

      console.log(`Processed: ${title}`);
    }

    // Prune old processed entries and save
    processedVideos = pruneProcessedVideos(processedVideos);
    await setProcessedVideos(processedVideos);
    await setSummariesIndex(summariesIndex);
    await setLastCheck(new Date().toISOString());

    console.log(`process-videos-background: done. ${slackMessageCount} Slack messages sent.`);
  } catch (err) {
    console.error("process-videos-background error:", err);
  }
};

import type { Config } from "@netlify/functions";
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

export default async function handler() {
  console.log("check-new-videos: starting");

  try {
    const channels = await getChannels();
    if (channels.length === 0) {
      console.log("No channels configured, skipping");
      return new Response("No channels configured", { status: 200 });
    }

    let processedVideos = await getProcessedVideos();
    const processedSet = new Set(
      processedVideos
        .filter((v) => v.status === "completed" || v.status === "no-transcript")
        .map((v) => v.videoId)
    );

    let summariesIndex = await getSummariesIndex();
    let slackMessageCount = 0;

    for (const channel of channels) {
      let entries;
      try {
        entries = await fetchRSSFeed(channel.channelId);
      } catch (err) {
        console.error(`RSS fetch failed for ${channel.channelName}:`, err);
        continue;
      }

      // Filter to 48-hour window
      const recentEntries = entries.filter((e) =>
        isWithinTimeWindow(e.publishedDate, 48)
      );

      for (const entry of recentEntries) {
        if (processedSet.has(entry.videoId)) continue;

        const videoUrl = `https://youtube.com/watch?v=${entry.videoId}`;

        // Check existing attempts for this video
        const existing = processedVideos.find(
          (v) => v.videoId === entry.videoId
        );
        const attempts = existing ? existing.attempts : 0;

        // After 3 failed transcript attempts, mark as no-transcript
        if (attempts >= 3) {
          console.log(
            `Giving up on transcript for ${entry.title} after ${attempts} attempts`
          );
          const processed: ProcessedVideo = {
            videoId: entry.videoId,
            processedAt: new Date().toISOString(),
            attempts,
            status: "no-transcript",
          };
          processedVideos = processedVideos.filter(
            (v) => v.videoId !== entry.videoId
          );
          processedVideos.push(processed);
          processedSet.add(entry.videoId);
          continue;
        }

        // Try to fetch transcript
        const segments = await fetchTranscript(entry.videoId);

        if (!segments) {
          console.log(`No transcript for ${entry.title} (attempt ${attempts + 1})`);

          // Update attempt count
          const updated: ProcessedVideo = {
            videoId: entry.videoId,
            processedAt: new Date().toISOString(),
            attempts: attempts + 1,
            status: "pending",
          };
          processedVideos = processedVideos.filter(
            (v) => v.videoId !== entry.videoId
          );
          processedVideos.push(updated);

          // Post Slack alert on first attempt only
          if (attempts === 0) {
            await postNoTranscriptAlert(entry.title, videoUrl);
            if (slackMessageCount > 0) await delay(500);
            slackMessageCount++;
          }
          continue;
        }

        // Skip very short videos
        const duration = estimateDuration(segments);
        if (duration < MIN_VIDEO_DURATION_SECONDS) {
          console.log(
            `Skipping short video (${duration}s): ${entry.title}`
          );
          processedVideos.push({
            videoId: entry.videoId,
            processedAt: new Date().toISOString(),
            attempts: 1,
            status: "completed",
          });
          processedSet.add(entry.videoId);
          continue;
        }

        // Format transcript and truncate if needed
        const formatted = formatTranscriptWithTimestamps(segments);
        const { text: transcript } = truncateTranscript(formatted);

        // Summarize with Claude
        let summarizeResult;
        try {
          summarizeResult = await summarizeTranscript({
            title: entry.title,
            channelName: entry.channelName || channel.channelName,
            publishedDate: entry.publishedDate,
            description: entry.description,
            transcript,
          });
        } catch (err) {
          console.error(`Summarization failed for ${entry.title}:`, err);
          await postSummarizationFailedAlert(entry.title, videoUrl);
          if (slackMessageCount > 0) await delay(500);
          slackMessageCount++;

          processedVideos.push({
            videoId: entry.videoId,
            processedAt: new Date().toISOString(),
            attempts: attempts + 1,
            status: "completed",
          });
          processedSet.add(entry.videoId);
          continue;
        }

        const now = new Date().toISOString();

        // Build full summary object
        const fullSummary: FullSummary = {
          videoId: entry.videoId,
          title: entry.title,
          channelName: entry.channelName || channel.channelName,
          channelId: channel.channelId,
          publishedDate: entry.publishedDate,
          processedAt: now,
          videoUrl,
          description: entry.description,
          status: "completed",
          estimatedDurationSeconds: duration,
          summary: summarizeResult.summary,
          tokenUsage: summarizeResult.tokenUsage,
        };

        // Save to Blobs
        await setSummary(entry.videoId, fullSummary);

        // Update index (prepend for newest-first)
        const indexEntry: SummaryIndex = {
          videoId: entry.videoId,
          channelName: fullSummary.channelName,
          channelId: channel.channelId,
          title: entry.title,
          publishedDate: entry.publishedDate,
          processedAt: now,
          importanceScore: summarizeResult.summary.importanceScore,
          tldr: summarizeResult.summary.tldr,
          status: "completed",
        };
        summariesIndex = [indexEntry, ...summariesIndex];

        // Log usage
        await appendUsageLog({
          date: now.split("T")[0],
          videoId: entry.videoId,
          inputTokens: summarizeResult.tokenUsage.inputTokens,
          outputTokens: summarizeResult.tokenUsage.outputTokens,
          estimatedCost: summarizeResult.tokenUsage.estimatedCost,
          isAdHoc: false,
        });

        // Post to Slack
        if (slackMessageCount > 0) await delay(500);
        await postToSlack(fullSummary);
        slackMessageCount++;

        // Mark as processed
        processedVideos = processedVideos.filter(
          (v) => v.videoId !== entry.videoId
        );
        processedVideos.push({
          videoId: entry.videoId,
          processedAt: now,
          attempts: attempts + 1,
          status: "completed",
        });
        processedSet.add(entry.videoId);

        console.log(`Processed: ${entry.title}`);
      }
    }

    // Prune old processed entries and save
    processedVideos = pruneProcessedVideos(processedVideos);
    await setProcessedVideos(processedVideos);
    await setSummariesIndex(summariesIndex);
    await setLastCheck(new Date().toISOString());

    console.log(`check-new-videos: done. ${slackMessageCount} Slack messages sent.`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("check-new-videos error:", err);
    return new Response("Error", { status: 500 });
  }
}

export const config: Config = {
  schedule: "@hourly",
};

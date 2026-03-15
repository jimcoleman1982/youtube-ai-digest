import type { FullSummary } from "./types.js";

function convertTimestampsToSlackLinks(text: string, videoId: string): string {
  return text.replace(/\[(\d{1,2}):(\d{2})\]/g, (_match, mins, secs) => {
    const totalSeconds = parseInt(mins) * 60 + parseInt(secs);
    return `<https://youtube.com/watch?v=${videoId}&t=${totalSeconds}|[${mins}:${secs}]>`;
  });
}

function importanceStars(score: number): string {
  return "\u2b50".repeat(Math.min(Math.max(score, 1), 5));
}

function formatSlackMessage(summary: FullSummary): string {
  const s = summary.summary;
  const videoId = summary.videoId;

  const keyPointsText = s.keyPoints
    .map((p, i) => `${i + 1}. ${convertTimestampsToSlackLinks(p, videoId)}`)
    .join("\n");

  const keyMomentsText = s.keyMoments
    .map(
      (m) =>
        `<https://youtube.com/watch?v=${videoId}&t=${m.seconds}|[${m.timestamp}]> ${m.label}`
    )
    .join("\n");

  return [
    `\ud83c\udfac *${summary.title}*`,
    `\ud83d\udcfa ${summary.channelName} \u00b7 ${new Date(summary.publishedDate).toLocaleDateString()} \u00b7 Importance: ${importanceStars(s.importanceScore)}`,
    `\ud83d\udd17 <https://youtube.com/watch?v=${videoId}|Watch Video>`,
    "",
    "---",
    "",
    "*TLDR*",
    convertTimestampsToSlackLinks(s.tldr, videoId),
    "",
    "*Key Points*",
    keyPointsText,
    "",
    "*Notable Details*",
    convertTimestampsToSlackLinks(s.notableDetails, videoId),
    "",
    "*Why This Matters*",
    convertTimestampsToSlackLinks(s.whyThisMatters, videoId),
    "",
    `\u23f1 *Key Moments:*`,
    keyMomentsText,
  ].join("\n");
}

async function postWebhook(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL not set, skipping Slack post");
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    console.error(`Slack webhook error: ${res.status} ${await res.text()}`);
  }
}

export async function postToSlack(summary: FullSummary): Promise<void> {
  const message = formatSlackMessage(summary);
  await postWebhook(message);
}

export async function postNoTranscriptAlert(
  title: string,
  videoUrl: string
): Promise<void> {
  const text = `\ud83d\udcfa New video detected but no transcript available yet: *${title}*\n\ud83d\udd17 ${videoUrl}`;
  await postWebhook(text);
}

export async function postSummarizationFailedAlert(
  title: string,
  videoUrl: string
): Promise<void> {
  const text = `\u26a0\ufe0f Summarization failed for: *${title}*\n\ud83d\udd17 ${videoUrl}\nPlease check manually.`;
  await postWebhook(text);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

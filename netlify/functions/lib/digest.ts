import Anthropic from "@anthropic-ai/sdk";
import type { SummaryIndex, FullSummary } from "./types.js";
import { getSummariesIndex, getSummary } from "./blobs.js";

export type DigestPeriod = "daily" | "weekly";

export interface DigestResult {
  text: string;
  videoCount: number;
  channelCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

/**
 * Gather summaries from a date range, send to Claude for meta-analysis,
 * return a formatted digest.
 */
export async function generateDigest(
  period: DigestPeriod,
  startDate: string,
  endDate: string
): Promise<DigestResult | null> {
  const index = await getSummariesIndex();

  // Filter to date range (startDate/endDate are UTC ISO timestamps)
  const filtered = index.filter((s) => {
    const d = s.processedAt || s.publishedDate || "";
    return d >= startDate && d < endDate;
  });

  if (filtered.length === 0) {
    return null;
  }

  // Load full summaries for richer context
  const fullSummaries: FullSummary[] = [];
  for (const entry of filtered) {
    const full = await getSummary(entry.videoId);
    if (full) fullSummaries.push(full);
  }

  const channels = new Set(filtered.map((s) => s.channelName));

  // Build the input for Claude
  const videosContext = fullSummaries
    .map((s) => {
      const sm = s.summary;
      return [
        `VIDEO: ${s.title}`,
        `CHANNEL: ${s.channelName}`,
        `DATE: ${s.publishedDate}`,
        `IMPORTANCE: ${sm.importanceScore}/5`,
        `TLDR: ${sm.tldr}`,
        `KEY POINTS:\n${sm.keyPoints.map((p) => `- ${p}`).join("\n")}`,
        sm.whyThisMatters ? `WHY IT MATTERS: ${sm.whyThisMatters}` : "",
        sm.notableDetails ? `NOTABLE: ${sm.notableDetails}` : "",
        "---",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const systemPrompt = buildDigestSystemPrompt(period);
  const userPrompt = buildDigestUserPrompt(
    period,
    startDate,
    endDate,
    filtered.length,
    channels.size,
    videosContext
  );

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const estimatedCost =
    (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;

  return {
    text,
    videoCount: filtered.length,
    channelCount: channels.size,
    tokenUsage: { inputTokens, outputTokens, estimatedCost },
  };
}

function buildDigestSystemPrompt(period: DigestPeriod): string {
  const timeframe = period === "daily" ? "today" : "this week";

  return `You are an AI industry analyst writing a ${period} intelligence brief for a busy entrepreneur who tracks the AI space closely. He runs multiple businesses and needs to know what matters without wading through individual videos.

VOICE & TONE:
- Direct, confident, and opinionated. Not robotic or corporate.
- You're the sharp friend who actually watches everything and tells him what he needs to know.
- Have a point of view. If something is overhyped, say so. If something is genuinely important, make that clear.
- Conversational but substantive. No fluff, no filler, no "in conclusion" energy.
- Brief moments of personality are good. Dry humor is fine. Don't overdo it.

IMPORTANT FORMATTING RULES:
- Do NOT use em dashes (--) anywhere. Use commas, periods, or parentheses instead.
- Write for Slack. Use *bold* for emphasis, not markdown headers.
- Keep paragraphs short (2-3 sentences max).
- Use bullet points where they help scanning.

YOUR JOB:
Synthesize ALL the video summaries from ${timeframe} into a single, coherent intelligence brief. Don't just list what each video said. Find the threads, the patterns, the signal.`;
}

function buildDigestUserPrompt(
  period: DigestPeriod,
  startDate: string,
  endDate: string,
  videoCount: number,
  channelCount: number,
  videosContext: string
): string {
  const dateRange =
    period === "daily"
      ? startDate
      : `${startDate} to ${endDate}`;

  const sections =
    period === "daily"
      ? `Structure your brief with these sections:

*The Vibe Today*
2-3 sentences. What's the overall mood/energy in the AI space today? What's dominating the conversation?

*What Actually Matters*
The 2-4 most significant developments, themes, or announcements from today's videos. For each one, give context on why it matters and what it means going forward. Reference specific videos/channels when attributing claims. This is the meat of the brief.

*Quick Hits*
Bullet points for smaller items worth knowing but not worth a full paragraph. 3-5 items.

*The One Thing*
If you had to distill today down to a single takeaway for a business operator, what would it be? 1-2 sentences.`
      : `Structure your brief with these sections:

*The Week in AI*
3-4 sentences. What defined this week? What was the dominant narrative? How did the vibe shift from start to finish?

*The Big Stories*
The 3-5 most significant themes or developments from this week. For each, synthesize across multiple videos/channels. What are different voices saying about the same topic? Where is there consensus vs. disagreement? Give real context and your read on what it means.

*Trend Watch*
What's heating up? What's cooling down? What narrative threads are building momentum week over week? 2-3 trends with brief analysis.

*Quick Hits*
Bullet points for smaller items worth knowing. 4-6 items.

*The Bottom Line*
If you had to brief someone in 30 seconds on what happened in AI this week, what would you say? 2-3 sentences. Be opinionated.`;

  return `Here are ${videoCount} AI video summaries from ${channelCount} channels, covering ${dateRange}.

${sections}

---

VIDEO SUMMARIES:

${videosContext}

Write the ${period} brief now. Remember: no em dashes, write for Slack formatting, be direct and opinionated.`;
}

/**
 * Format the digest for Slack posting.
 */
export function formatDigestForSlack(
  period: DigestPeriod,
  digest: DigestResult,
  dateLabel: string
): string {
  const header =
    period === "daily"
      ? `\ud83d\udcca *AI Digest: ${dateLabel}*`
      : `\ud83d\udcca *Weekly AI Rollup: ${dateLabel}*`;

  const meta = `_${digest.videoCount} videos from ${digest.channelCount} channels_`;

  return `${header}\n${meta}\n\n${digest.text}`;
}

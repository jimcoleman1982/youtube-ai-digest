import Anthropic from "@anthropic-ai/sdk";
import type { SummaryContent, TokenUsage } from "./types.js";

const SYSTEM_PROMPT = `You are an AI industry analyst creating detailed video summaries for a busy executive who tracks the AI space.

Your summaries must be structured, substantive, and actionable. Every sentence should convey information. No filler.

Write in a direct, confident tone.

TIMESTAMP REFERENCES:
- The transcript includes timestamp markers like [MM:SS].
- When referencing a specific claim, announcement, or key moment, include the timestamp in your summary like this: [MM:SS]
- You MUST identify exactly 3-5 "Key Moments" -- the most important, watch-worthy sections of the video. For each, provide the timestamp and a short label (under 10 words).
- Do NOT timestamp every single point -- only the highest-value moments.

INTERVIEW/PODCAST FORMAT:
- Use the video title and description to identify the host and guest(s).
- Attribute key arguments and claims to specific speakers by name when possible (e.g., "Dario Amodei argued that..." or "The host pushed back on...").
- If you cannot confidently identify a speaker, use "one speaker" or "the guest/host."

OUTPUT FORMAT:
You must respond in valid JSON with this exact structure (no markdown, no backticks, no preamble):

{
  "tldr": "1-2 sentence takeaway",
  "keyPoints": [
    "Point 1 with [MM:SS] timestamp where relevant",
    "Point 2...",
    "..."
  ],
  "notableDetails": "Specific names, companies, products, numbers, dates worth knowing",
  "whyThisMatters": "1-2 sentences on implications for the AI industry",
  "importanceScore": 4,
  "keyMoments": [
    { "timestamp": "02:15", "seconds": 135, "label": "GPT-5 benchmark results revealed" },
    { "timestamp": "08:42", "seconds": 522, "label": "Pricing strategy breakdown" },
    { "timestamp": "15:30", "seconds": 930, "label": "Impact on open source models" }
  ]
}

RULES:
- "importanceScore" is 1-5: how important is this video for someone tracking the AI industry? 5 = major announcement or breakthrough. 1 = low novelty or tangential.
- "keyMoments" must have exactly 3-5 entries, ordered chronologically.
- "keyPoints" should have 3-7 items.
- Keep the total summary text under 500 words.
- Be specific, not generic.`;

function buildUserPrompt(params: {
  title: string;
  channelName: string;
  publishedDate: string;
  description: string;
  transcript: string;
}): string {
  return `Summarize the following YouTube video transcript in detail.

VIDEO TITLE: ${params.title}
CHANNEL: ${params.channelName}
PUBLISHED: ${params.publishedDate}
VIDEO DESCRIPTION: ${params.description}

TIMESTAMPED TRANSCRIPT:
${params.transcript}

Respond with valid JSON only. No markdown, no backticks, no preamble.`;
}

export interface SummarizeResult {
  summary: SummaryContent;
  tokenUsage: TokenUsage;
}

export async function summarizeTranscript(params: {
  title: string;
  channelName: string;
  publishedDate: string;
  description: string;
  transcript: string;
}): Promise<SummarizeResult> {
  const client = new Anthropic();

  const userPrompt = buildUserPrompt(params);

  let response: Anthropic.Message | undefined;
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      const summary = JSON.parse(text) as SummaryContent;

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const estimatedCost =
        (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;

      return {
        summary,
        tokenUsage: { inputTokens, outputTokens, estimatedCost },
      };
    } catch (err) {
      if (attempts >= maxAttempts) {
        // Fall back to a basic structure if JSON parse fails
        const fallbackText =
          response! &&
          response!.content[0].type === "text"
            ? response!.content[0].text
            : "Summarization failed";

        const inputTokens = response?.usage?.input_tokens ?? 0;
        const outputTokens = response?.usage?.output_tokens ?? 0;
        const estimatedCost =
          (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;

        return {
          summary: {
            tldr: fallbackText.slice(0, 200),
            keyPoints: [fallbackText],
            notableDetails: "",
            whyThisMatters: "",
            importanceScore: 3,
            keyMoments: [],
          },
          tokenUsage: { inputTokens, outputTokens, estimatedCost },
        };
      }
      // Wait 5 seconds before retry
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  throw new Error("Unreachable");
}

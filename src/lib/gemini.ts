import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Question, EvalResult, CostBreakdown } from "@/types";

let genai: GoogleGenerativeAI | null = null;

function getGenai() {
  if (!genai) {
    genai = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_KEY!);
  }
  return genai;
}

export function geminiAvailable(): boolean {
  const key = process.env.GOOGLE_GENERATIVE_AI_KEY?.trim() ?? "";
  return key.length >= 12;
}

export async function evaluateWithGemini(
  question: Question,
  answerText: string,
  imageBase64?: string
): Promise<EvalResult> {
  const started = performance.now();
  const model = getGenai().getGenerativeModel({ model: "gemini-3.8-flash" });

  const rubricLines = question.rubric
    .map((r, i) => `  [${i + 1}] (${r.score} pt) ${r.description}`)
    .join("\n");

  const ratingOptions = question.rating.map((r) => r.level).join(" | ");

  const prompt = `You are grading a student's math answer. Be concise and accurate.

Question: ${question.stem}
Expected answer: ${question.correctAnswer}

Rubric (each item is worth points independently):
${rubricLines}

Rating levels: ${ratingOptions}
${question.rating.map((r) => `  ${r.level}: ${r.description}`).join("\n")}

Student's answer: ${answerText || "(see image)"}

Respond with ONLY valid JSON, no markdown:
{
  "rubricBreakdown": [${question.rubric.map((_, i) => `{"earned": <true|false>, "probability": <0.0-1.0>}`).join(", ")}],
  "rating": "<one of: ${ratingOptions}>",
  "reasoning": "<one sentence>"
}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [prompt];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
  }

  const result = await model.generateContent(parts);
  const text = result.response.text().trim().replace(/```json\n?|```/g, "");
  const json = JSON.parse(text);
  const latencyMs = Math.round(performance.now() - started);

  // Gemini 3.8 Flash: $0.75/M input tokens, $3.75/M output tokens (through Dec 2026)
  const GEMINI_INPUT_COST_PER_TOKEN = 0.75 / 1_000_000;
  const GEMINI_OUTPUT_COST_PER_TOKEN = 3.75 / 1_000_000;
  const usage = result.response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const geminiCostUsd =
    inputTokens * GEMINI_INPUT_COST_PER_TOKEN +
    outputTokens * GEMINI_OUTPUT_COST_PER_TOKEN;
  const costNote = imageBase64
    ? "Image + text eval in one call (vision input)"
    : "Text-only eval";

  const rubricBreakdown = question.rubric.map((item, i) => ({
    description: item.description,
    earned: Boolean(json.rubricBreakdown?.[i]?.earned),
    probability: Number(json.rubricBreakdown?.[i]?.probability ?? (json.rubricBreakdown?.[i]?.earned ? 1 : 0)),
  }));

  const score = rubricBreakdown.reduce(
    (sum, r, i) => sum + (r.earned ? question.rubric[i].score : 0),
    0
  );

  return {
    score,
    maxScore: question.maxScore,
    rubricBreakdown,
    rating: String(json.rating),
    reasoning: String(json.reasoning),
    latencyMs,
    cost: {
      tokens: { inputTokens, outputTokens },
      costUsd: geminiCostUsd,
      note: costNote,
    },
    raw: {
      input: { prompt },
      output: json,
      model: "gemini-3.8-flash",
      usage: { inputTokens, outputTokens },
    },
  };
}

// Gemini 2.0 Flash Lite: $0.075/M input, $0.30/M output
const OCR_INPUT_COST_PER_TOKEN = 0.075 / 1_000_000;
const OCR_OUTPUT_COST_PER_TOKEN = 0.30 / 1_000_000;

export async function ocrImageWithGemini(
  imageBase64: string
): Promise<{ text: string; cost: CostBreakdown; latencyMs: number }> {
  const started = performance.now();
  const model = getGenai().getGenerativeModel({ model: "gemini-2.0-flash-lite" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [
    "Extract all text and mathematical expressions from this image. Return only the extracted content, nothing else.",
    { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
  ];

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  const latencyMs = Math.round(performance.now() - started);

  const usage = result.response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd = inputTokens * OCR_INPUT_COST_PER_TOKEN + outputTokens * OCR_OUTPUT_COST_PER_TOKEN;

  return {
    text,
    latencyMs,
    cost: {
      tokens: { inputTokens, outputTokens },
      costUsd,
      note: "Vision OCR via gemini-2.0-flash-lite",
    },
  };
}

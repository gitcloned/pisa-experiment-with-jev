import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Question, EvalResult } from "@/types";

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

  const rubricLines = [
    `FULL CREDIT (${question.rubric.full.score}/${question.maxScore}): ${question.rubric.full.description}`,
    ...(question.rubric.partial
      ? [`PARTIAL CREDIT (${question.rubric.partial.score}/${question.maxScore}): ${question.rubric.partial.description}`]
      : []),
    `NO CREDIT (${question.rubric.none.score}/${question.maxScore}): ${question.rubric.none.description}`,
  ].join("\n");

  const validScores = [
    question.rubric.full.score,
    ...(question.rubric.partial ? [question.rubric.partial.score] : []),
    question.rubric.none.score,
  ].join(", ");

  const prompt = `You are grading a student's math answer. Be concise and accurate.

Question: ${question.stem}
Expected answer: ${question.correctAnswer}

Rubric:
${rubricLines}

Student's answer: ${answerText || "(see image)"}

Respond with ONLY valid JSON, no markdown:
{"score": <one of: ${validScores}>, "reasoning": "<one sentence>"}`;

  const parts: Parameters<typeof model.generateContent>[0] extends { contents: infer C } ? never : any[] = [prompt];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
  }

  const result = await model.generateContent(parts as any);
  const text = result.response.text().trim().replace(/```json\n?|```/g, "");
  const json = JSON.parse(text);
  const latencyMs = Math.round(performance.now() - started);

  return {
    score: Number(json.score),
    maxScore: question.maxScore,
    reasoning: String(json.reasoning),
    latencyMs,
  };
}

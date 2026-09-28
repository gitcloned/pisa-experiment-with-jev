import { NextRequest, NextResponse } from "next/server";
import { loadQuestion } from "@/lib/questions";
import { evaluateWithJev, jevAvailable } from "@/lib/jev";
import { evaluateWithGemini, geminiAvailable } from "@/lib/gemini";
import type { EvalResult } from "@/types";

export const runtime = "nodejs";

const fallback = (maxScore: number, reason: string): EvalResult => ({
  score: 0,
  maxScore,
  reasoning: reason,
  latencyMs: 0,
  error: true,
});

export async function POST(req: NextRequest) {
  const { sectionId, questionId, answerText, answerImage } = await req.json();

  if (!sectionId || !questionId) {
    return NextResponse.json({ error: "Missing sectionId or questionId" }, { status: 400 });
  }

  const question = loadQuestion(sectionId, Number(questionId));
  const text = answerText || "";
  const imageOnly = !!answerImage && !text;

  const [jevResult, geminiResult] = await Promise.allSettled([
    jevAvailable()
      ? evaluateWithJev(question, text)
      : Promise.resolve(fallback(question.maxScore, "No Jev API key configured")),
    geminiAvailable()
      ? evaluateWithGemini(question, text, answerImage)
      : Promise.resolve(fallback(question.maxScore, "No Gemini API key configured")),
  ]);

  if (jevResult.status === "rejected") console.error("[jev]", jevResult.reason);
  if (geminiResult.status === "rejected") console.error("[gemini]", geminiResult.reason);

  // For image-only answers, Jev can't process the image directly.
  // The pipeline would require: Gemini OCR → extracted text → Jev eval.
  // Flag this on the Jev result so the UI can explain the extra cost step.
  const jevValue = jevResult.status === "fulfilled" ? jevResult.value : fallback(question.maxScore, "Jev evaluation failed");
  if (imageOnly && jevValue.cost) {
    jevValue.cost.note = "Cost shown is Jev-only (evaluated empty text). Real image pipeline needs OCR first (extra Gemini call ~$0.001), not included here.";
  }

  return NextResponse.json({
    jev: jevValue,
    gemini:
      geminiResult.status === "fulfilled"
        ? geminiResult.value
        : fallback(question.maxScore, "Gemini evaluation failed"),
  });
}

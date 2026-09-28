import { NextRequest, NextResponse } from "next/server";
import { loadQuestion } from "@/lib/questions";
import { evaluateWithJev, jevAvailable } from "@/lib/jev";
import { evaluateWithGemini, geminiAvailable, ocrImageWithGemini } from "@/lib/gemini";
import type { EvalResult, CostBreakdown } from "@/types";

export const runtime = "nodejs";

const fallback = (maxScore: number, reason: string): EvalResult => ({
  score: 0,
  maxScore,
  reasoning: reason,
  latencyMs: 0,
  error: true,
});

export async function POST(req: NextRequest) {
  const { sectionId, questionId, answerText, answerImage, timeSolveSec } = await req.json();

  if (!sectionId || !questionId) {
    return NextResponse.json({ error: "Missing sectionId or questionId" }, { status: 400 });
  }

  const question = loadQuestion(sectionId, Number(questionId));
  const text = answerText || "";
  const imageOnly = !!answerImage && !text;

  let jevText = text;
  let ocrCost: CostBreakdown | undefined;

  if (imageOnly && geminiAvailable()) {
    // Run OCR and Gemini main eval in parallel (both need the image)
    const [ocrResult, geminiResult] = await Promise.allSettled([
      ocrImageWithGemini(answerImage),
      evaluateWithGemini(question, text, answerImage, timeSolveSec),
    ]);

    if (ocrResult.status === "rejected") console.error("[ocr]", ocrResult.reason);
    if (geminiResult.status === "rejected") console.error("[gemini]", geminiResult.reason);

    if (ocrResult.status === "fulfilled") {
      jevText = ocrResult.value.text;
      ocrCost = ocrResult.value.cost;
    }

    // Jev runs after OCR so it has the extracted text
    let jevValue: EvalResult;
    try {
      jevValue = jevAvailable()
        ? await evaluateWithJev(question, jevText, timeSolveSec)
        : fallback(question.maxScore, "No Jev API key configured");
    } catch (e) {
      console.error("[jev]", e);
      jevValue = fallback(question.maxScore, "Jev evaluation failed");
    }

    if (ocrResult.status === "fulfilled") {
      jevValue.ocrLatencyMs = ocrResult.value.latencyMs;
      jevValue.latencyMs += ocrResult.value.latencyMs; // OCR is part of Jev pipeline
    }
    if (ocrCost) {
      jevValue.ocrCost = ocrCost;
      if (jevValue.cost) jevValue.cost.note = "Jev eval of OCR-extracted text";
    }

    return NextResponse.json({
      jev: jevValue,
      gemini:
        geminiResult.status === "fulfilled"
          ? geminiResult.value
          : fallback(question.maxScore, "Gemini evaluation failed"),
    });
  }

  // Text answer (or text + image): run Jev and Gemini in parallel
  const [jevResult, geminiResult] = await Promise.allSettled([
    jevAvailable()
      ? evaluateWithJev(question, text, timeSolveSec)
      : Promise.resolve(fallback(question.maxScore, "No Jev API key configured")),
    geminiAvailable()
      ? evaluateWithGemini(question, text, answerImage, timeSolveSec)
      : Promise.resolve(fallback(question.maxScore, "No Gemini API key configured")),
  ]);

  if (jevResult.status === "rejected") console.error("[jev]", jevResult.reason);
  if (geminiResult.status === "rejected") console.error("[gemini]", geminiResult.reason);

  return NextResponse.json({
    jev: jevResult.status === "fulfilled" ? jevResult.value : fallback(question.maxScore, "Jev evaluation failed"),
    gemini: geminiResult.status === "fulfilled" ? geminiResult.value : fallback(question.maxScore, "Gemini evaluation failed"),
  });
}

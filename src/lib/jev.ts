import "server-only";
import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";
import type { Question, EvalResult } from "@/types";

let client: TypeSafeClient | null = null;

function getClient() {
  if (!client) {
    client = new TypeSafeClient({
      defaultModel: process.env.JEV_MODEL || "jev-latest",
      retry: { maxRetries: 0 },
      timeout: 3000,
    });
  }
  return client;
}

export function jevAvailable(): boolean {
  const key = process.env.TYPESAFE_API_KEY?.trim() ?? "";
  return key.length >= 12 && !/\.\.\.|your|xxx|placeholder|changeme|<|>/i.test(key);
}

export async function evaluateWithJev(
  question: Question,
  answerText: string
): Promise<EvalResult> {
  const started = performance.now();

  const rubricLevels = [
    question.rubric.none.description,
    ...(question.rubric.partial ? [question.rubric.partial.description] : []),
    question.rubric.full.description,
  ];

  const res = await getClient().systemOne({
    state: {
      question: question.stem,
      correctAnswer: question.correctAnswer,
      studentAnswer: answerText,
    },
    questions: {
      rubricScore: score(
        "How well does the student answer match the rubric for this question",
        rubricLevels as [string, string, ...string[]]
      ),
      answerCorrect: noul("The student reached the correct final numerical answer"),
      methodCorrect: noul("The student used a valid mathematical method or approach"),
    },
  });

  const latencyMs = Math.round(performance.now() - started);
  const idx = res.answers.rubricScore.score; // 0-based index into rubricLevels
  const scoreValue = Math.round((idx / (rubricLevels.length - 1)) * question.maxScore);

  return {
    score: scoreValue,
    maxScore: question.maxScore,
    reasoning: rubricLevels[idx] ?? "Unable to determine",
    latencyMs,
  };
}

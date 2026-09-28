import "server-only";
import { TypeSafeClient, noul, choice } from "@typesafe-ai/sdk";
import type { Question, EvalResult } from "@/types";

let client: TypeSafeClient | null = null;

function getClient() {
  if (!client) {
    client = new TypeSafeClient({
      defaultModel: process.env.JEV_MODEL || "jev-latest",
      retry: { maxRetries: 0 },
      timeout: 5000,
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
  answerText: string,
  timeSolveSec?: number
): Promise<EvalResult> {
  const started = performance.now();

  // Build questions dynamically:
  // - each rubric item → noul (did the student earn this point?)
  // - rating levels → choice (overall performance level)
  const rubricQuestions = Object.fromEntries(
    question.rubric.map((item, i) => [
      `rubric_${i}`,
      noul(`The student's answer satisfies: "${item.description}"`),
    ])
  );

  const ratingChoices = Object.fromEntries(
    question.rating.map((r) => [r.level, r.description])
  ) as Record<string, string>;

  const questions = {
    ...rubricQuestions,
    rating: choice("What is the overall performance level of this student's answer", ratingChoices),
  };

  const state = {
    question: question.stem,
    correctAnswer: question.correctAnswer,
    studentAnswer: answerText,
    time_to_solve_sec: timeSolveSec ?? null,
    avg_time_to_solve_sec: question.avg_time_to_solve_sec,
  };

  const res = await getClient().systemOne({ state, questions });

  const latencyMs = Math.round(performance.now() - started);

  // Jev charges $0.042 per million input tokens, output is free.
  // SDK doesn't expose token counts, so estimate from payload char count ÷ 4.
  const inputPayload = JSON.stringify({ state, questions });
  const estimatedInputTokens = Math.ceil(inputPayload.length / 4);
  const JEV_INPUT_COST_PER_TOKEN = 0.042 / 1_000_000;
  const jevCostUsd = estimatedInputTokens * JEV_INPUT_COST_PER_TOKEN;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answers = res.answers as Record<string, any>;
  const rubricBreakdown = question.rubric.map((item, i) => {
    const probability: number = answers[`rubric_${i}`].noul;
    const earned = probability > 0.5;
    return { description: item.description, earned, probability };
  });

  // Score = sum of (probability × item score), rounded to nearest 0.5
  const rawScore = rubricBreakdown.reduce(
    (sum, r, i) => sum + r.probability * question.rubric[i].score,
    0
  );
  const score = Math.round(rawScore * 2) / 2;

  const rating: string = answers.rating.choice;

  return {
    score,
    maxScore: question.maxScore,
    rubricBreakdown,
    rating,
    reasoning: rubricBreakdown
      .map((r, i) => `${r.earned ? "✓" : "✗"} ${question.rubric[i].description}`)
      .join(" · "),
    latencyMs,
    cost: {
      tokens: { inputTokens: estimatedInputTokens, outputTokens: 0 },
      costUsd: jevCostUsd,
      note: "Output tokens free. Input estimated (chars ÷ 4).",
    },
    raw: {
      input: { state, questions: Object.fromEntries(
        question.rubric.map((item, i) => [`rubric_${i}`, `noul("${item.description}")`])
          .concat([["rating", `choice("overall level", ${JSON.stringify(ratingChoices)})`]])
      )},
      output: answers,
      model: res.model,
    },
  };
}

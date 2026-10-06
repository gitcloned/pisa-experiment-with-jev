/**
 * Exp-02: Jev vs Gemini with question-specific rubrics
 *
 * Rubric items derived by analyzing the reference answer and human-scored
 * responses from exp-01. Each question gets 3 targeted noul items that
 * mirror what the human scorer actually rewarded.
 *
 * Usage:
 *   npx tsx bulk-eval/exp-02-with-ai-rubric/scripts/run-eval.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { TypeSafeClient, noul, choice } from "@typesafe-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env.local", import.meta.url).pathname });

// ── Config ────────────────────────────────────────────────────────────────────

const RESPONSES_PER_Q = 5;
const MOHLER_SCALE = 5;

// ── Question-specific rubrics ─────────────────────────────────────────────────

interface RubricItem {
  noulText: string;   // prompt for Jev noul
  weight: number;     // relative weight (must sum to 1.0 across items)
}

interface QuestionRubric {
  id: string;
  question: string;
  referenceAnswer: string;
  rubric: RubricItem[];
  /** Same rubric expressed as bullet points for Gemini's prompt */
  rubricText: string;
}

const RUBRICS: QuestionRubric[] = [
  {
    id: "1.1",
    question: "What is the role of a prototype program in problem solving?",
    referenceAnswer: "To simulate the behaviour of portions of the desired software product.",
    rubric: [
      {
        noulText: "The answer uses the concept of simulating or modelling behaviour — not just showing or demonstrating it to users",
        weight: 0.5,
      },
      {
        noulText: "The answer refers to portions or parts of the software product, not the entire product",
        weight: 0.3,
      },
      {
        noulText: "The answer frames a prototype as a development or problem-solving tool, not merely a presentation or demo tool",
        weight: 0.2,
      },
    ],
    rubricText: `
- (2.5 pts) Answer uses the concept of simulating or modelling behaviour — not just showing/demonstrating
- (1.5 pts) Answer refers to portions/parts of the software, not the entire product
- (1.0 pt)  Answer frames prototype as a development/problem-solving tool, not a presentation tool`,
  },
  {
    id: "2.3",
    question: "What is the difference between a constructor and a function?",
    referenceAnswer:
      "A constructor is called whenever an object is created, whereas a function needs to be called explicitly. Constructors do not have return type, but functions have to indicate a return type.",
    rubric: [
      {
        noulText: "The answer states that constructors are called automatically when an object is created — they are not called explicitly like functions",
        weight: 0.4,
      },
      {
        noulText: "The answer states that constructors do not have a return type, unlike functions which must declare one",
        weight: 0.4,
      },
      {
        noulText: "The answer frames this as a comparison or difference between the two — not just defining each independently",
        weight: 0.2,
      },
    ],
    rubricText: `
- (2.0 pts) Answer states constructors are called automatically on object creation, not called explicitly like functions
- (2.0 pts) Answer states constructors have no return type, unlike functions which must declare a return type
- (1.0 pt)  Answer frames it as a direct comparison, not just separate definitions`,
  },
  {
    id: "4.2",
    question:
      "What is the main difference between strings declared using the type string versus strings declared using an array of characters?",
    referenceAnswer:
      "The strings declared using an array of characters have a null element added at the end of the array.",
    rubric: [
      {
        noulText: "The answer specifically mentions the null terminator or null character ('\\0') at the end of character arrays",
        weight: 0.6,
      },
      {
        noulText: "The answer correctly attributes the null terminator to char arrays — not to the string type",
        weight: 0.25,
      },
      {
        noulText: "The answer focuses on the structural or memory difference, not just ease-of-use or manipulation",
        weight: 0.15,
      },
    ],
    rubricText: `
- (3.0 pts) Answer specifically mentions the null terminator / null character at the end of char arrays
- (1.25 pts) Answer correctly attributes this to char arrays (not to the string type)
- (0.75 pts) Answer focuses on structural/memory difference, not just ease-of-use or manipulation`,
  },
];

// ── Load dataset ──────────────────────────────────────────────────────────────

interface Row {
  number: string;
  Questions: string;
  Answers: string;
  Texts: string;
  Score: string;
}

const csvPath = path.join(__dirname, "../../data/mohler.csv");
const allRows: Row[] = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true,
});

const grouped = new Map<string, Row[]>();
for (const row of allRows) {
  if (!grouped.has(row.number)) grouped.set(row.number, []);
  grouped.get(row.number)!.push(row);
}

const selected: Array<{ row: Row; rubric: QuestionRubric }> = [];
for (const qr of RUBRICS) {
  const rows = grouped.get(qr.id) ?? [];
  rows.slice(0, RESPONSES_PER_Q).forEach((row) => selected.push({ row, rubric: qr }));
}

console.log(`\n📋 Exp-02: rubric-based eval on ${RUBRICS.length} questions × ${RESPONSES_PER_Q} responses\n`);

// ── Clients ───────────────────────────────────────────────────────────────────

const jevClient = new TypeSafeClient({
  defaultModel: process.env.JEV_MODEL || "jev-latest",
  retry: { maxRetries: 0 },
  timeout: 15000,
});

const genai = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_KEY!);
const geminiModel = genai.getGenerativeModel({ model: "gemini-3.8-flash" });

// ── Jev evaluator (rubric-aware noul) ─────────────────────────────────────────

async function evalWithJev(
  row: Row,
  qr: QuestionRubric
): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();

  const state = {
    question: qr.question,
    referenceAnswer: qr.referenceAnswer,
    studentAnswer: row.Texts,
  };

  const noulQuestions = Object.fromEntries(
    qr.rubric.map((item, i) => [`rubric_${i}`, noul(item.noulText)])
  );

  const questions = {
    ...noulQuestions,
    quality: choice("What is the overall quality of this student's answer?", {
      excellent: "Fully correct, clear, and complete",
      good: "Mostly correct with minor gaps",
      partial: "Partially correct or incomplete",
      poor: "Mostly incorrect or missing the key point",
    }),
  };

  const res = await jevClient.systemOne({ state, questions });
  const latencyMs = Math.round(performance.now() - started);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ans = res.answers as Record<string, any>;

  // Weighted score: sum(probability_i × weight_i) × MOHLER_SCALE
  const rawScore = qr.rubric.reduce(
    (sum, item, i) => sum + (ans[`rubric_${i}`].noul as number) * item.weight,
    0
  );
  const score = Math.round(rawScore * MOHLER_SCALE * 2) / 2;

  const inputPayload = JSON.stringify({ state, questions });
  const estimatedTokens = Math.ceil(inputPayload.length / 4);
  const costUsd = estimatedTokens * (0.042 / 1_000_000);

  return { score, latencyMs, costUsd };
}

// ── Gemini evaluator (rubric-aware prompt) ────────────────────────────────────

async function evalWithGemini(
  row: Row,
  qr: QuestionRubric
): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();

  const prompt = `Grade this student's short answer on a scale of 0 to 5 using the rubric below.

Question: ${qr.question}
Reference answer: ${qr.referenceAnswer}

Rubric (points available out of 5):
${qr.rubricText}

Student answer: ${row.Texts}

Instructions:
- Check the student's answer against each rubric item independently
- Award points proportionally — partial credit is allowed
- Do not award points for content that is true but irrelevant to the rubric

Respond with ONLY valid JSON, no markdown:
{"score": <0.0–5.0>, "reasoning": "<one sentence explaining the score>"}`;

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json\n?|```/g, "");
  const json = JSON.parse(text);
  const latencyMs = Math.round(performance.now() - started);

  const usage = result.response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd =
    inputTokens * (0.75 / 1_000_000) +
    outputTokens * (3.75 / 1_000_000);

  const score = Math.round(Number(json.score) * 2) / 2;
  return { score, latencyMs, costUsd };
}

// ── Run ───────────────────────────────────────────────────────────────────────

interface Result {
  qid: string;
  student: string;
  humanScore: number;
  jevScore: number;
  geminiScore: number;
  jevLatencyMs: number;
  geminiLatencyMs: number;
  jevCostUsd: number;
  geminiCostUsd: number;
}

async function main() {
  const results: Result[] = [];

  for (const { row, rubric } of selected) {
    const human = parseFloat(row.Score);
    process.stdout.write(`  Q${row.number} | human=${human} | `);

    const [jev, gemini] = await Promise.all([
      evalWithJev(row, rubric),
      evalWithGemini(row, rubric),
    ]);

    process.stdout.write(
      `jev=${jev.score} (${jev.latencyMs}ms)  gemini=${gemini.score} (${gemini.latencyMs}ms)\n`
    );

    results.push({
      qid: row.number,
      student: row.Texts.slice(0, 80),
      humanScore: human,
      jevScore: jev.score,
      geminiScore: gemini.score,
      jevLatencyMs: jev.latencyMs,
      geminiLatencyMs: gemini.latencyMs,
      jevCostUsd: jev.costUsd,
      geminiCostUsd: gemini.costUsd,
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const n = results.length;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mae = (pred: number[], truth: number[]) =>
    avg(pred.map((p, i) => Math.abs(p - truth[i])));

  const humanScores  = results.map((r) => r.humanScore);
  const jevScores    = results.map((r) => r.jevScore);
  const geminiScores = results.map((r) => r.geminiScore);

  const jevMAE    = mae(jevScores, humanScores);
  const geminiMAE = mae(geminiScores, humanScores);
  const jevAvgMs    = avg(results.map((r) => r.jevLatencyMs));
  const geminiAvgMs = avg(results.map((r) => r.geminiLatencyMs));
  const jevTotalCost    = results.reduce((s, r) => s + r.jevCostUsd, 0);
  const geminiTotalCost = results.reduce((s, r) => s + r.geminiCostUsd, 0);

  // Load exp-01 results for comparison
  let exp01: Record<string, number> | null = null;
  try {
    const exp01Rows: Record<string, string>[] = parse(
      fs.readFileSync(path.join(__dirname, "../../exp-01-with-simple-prompt/data/results.csv"), "utf8"),
      { columns: true }
    );
    const e1Human  = exp01Rows.map((r) => parseFloat(r.human));
    const e1Jev    = exp01Rows.map((r) => parseFloat(r.jev));
    const e1Gemini = exp01Rows.map((r) => parseFloat(r.gemini));
    exp01 = { jevMAE: mae(e1Jev, e1Human), geminiMAE: mae(e1Gemini, e1Human) };
  } catch { /* skip if not found */ }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESULTS  (${n} responses across ${RUBRICS.length} questions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

             JEV            GEMINI
 Speed       ${jevAvgMs.toFixed(0)}ms avg        ${geminiAvgMs.toFixed(0)}ms avg
 Cost        $${jevTotalCost.toFixed(6)}      $${geminiTotalCost.toFixed(6)}
 MAE (exp-02) ${jevMAE.toFixed(2)} / 5          ${geminiMAE.toFixed(2)} / 5${
    exp01
      ? `
 MAE (exp-01) ${exp01.jevMAE.toFixed(2)} / 5          ${exp01.geminiMAE.toFixed(2)} / 5
 Improvement  ${(exp01.jevMAE - jevMAE).toFixed(2)} pts            ${(exp01.geminiMAE - geminiMAE).toFixed(2)} pts`
      : ""
  }

 (MAE = mean absolute error vs human score, lower is better)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PER-RESPONSE BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  console.log(
    " Q".padEnd(6) +
    "Human".padEnd(8) +
    "Jev".padEnd(8) +
    "Gemini".padEnd(8) +
    "Jev Δ".padEnd(8) +
    "Gem Δ".padEnd(8) +
    "Student answer (preview)"
  );
  console.log("─".repeat(100));

  for (const r of results) {
    const jevDelta    = (r.jevScore    - r.humanScore).toFixed(1);
    const geminiDelta = (r.geminiScore - r.humanScore).toFixed(1);
    console.log(
      ` ${r.qid}`.padEnd(6) +
      `${r.humanScore}`.padEnd(8) +
      `${r.jevScore}`.padEnd(8) +
      `${r.geminiScore}`.padEnd(8) +
      `${Number(jevDelta) >= 0 ? "+" : ""}${jevDelta}`.padEnd(8) +
      `${Number(geminiDelta) >= 0 ? "+" : ""}${geminiDelta}`.padEnd(8) +
      r.student.trim().replace(/\n/g, " ")
    );
  }

  // ── Save CSV ───────────────────────────────────────────────────────────────

  const outPath = path.join(__dirname, "../data/results.csv");
  const csvOut = [
    "qid,human,jev,gemini,jev_delta,gemini_delta,jev_ms,gemini_ms,jev_cost_usd,gemini_cost_usd",
    ...results.map((r) =>
      [
        r.qid,
        r.humanScore,
        r.jevScore,
        r.geminiScore,
        (r.jevScore    - r.humanScore).toFixed(2),
        (r.geminiScore - r.humanScore).toFixed(2),
        r.jevLatencyMs,
        r.geminiLatencyMs,
        r.jevCostUsd.toFixed(8),
        r.geminiCostUsd.toFixed(8),
      ].join(",")
    ),
  ].join("\n");

  fs.writeFileSync(outPath, csvOut);
  console.log(`\n✓ Results saved to bulk-eval/exp-02-with-ai-rubric/data/results.csv\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

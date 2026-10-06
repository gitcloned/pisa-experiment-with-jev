/**
 * Exp-03: Jev with rubric (exp-02) vs Gemini with few-shot calibration
 *
 * Jev: same question-specific rubric from exp-02 (worked better)
 * Gemini: few-shot prompt — 3 calibration examples per question showing
 *         what a low / mid / high score looks like, before asking it to grade
 *
 * Usage:
 *   npx tsx bulk-eval/exp-03-gemini-few-shot/scripts/run-eval.ts
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { TypeSafeClient, noul, choice } from "@typesafe-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env.local", import.meta.url).pathname });

// ── Config ────────────────────────────────────────────────────────────────────

const RESPONSES_PER_Q = 5;   // rows 1-5 are test set
const FEW_SHOT_START  = 5;   // rows 6-8 are few-shot examples (0-indexed)
const FEW_SHOT_COUNT  = 3;
const MOHLER_SCALE    = 5;

// ── Question definitions ──────────────────────────────────────────────────────

interface RubricItem {
  noulText: string;
  weight: number;
}

interface QuestionDef {
  id: string;
  question: string;
  referenceAnswer: string;
  rubric: RubricItem[];   // for Jev
}

const QUESTIONS: QuestionDef[] = [
  {
    id: "1.1",
    question: "What is the role of a prototype program in problem solving?",
    referenceAnswer: "To simulate the behaviour of portions of the desired software product.",
    rubric: [
      { noulText: "The answer uses the concept of simulating or modelling behaviour — not just showing or demonstrating it to users", weight: 0.5 },
      { noulText: "The answer refers to portions or parts of the software product, not the entire product", weight: 0.3 },
      { noulText: "The answer frames a prototype as a development or problem-solving tool, not merely a presentation or demo tool", weight: 0.2 },
    ],
  },
  {
    id: "2.3",
    question: "What is the difference between a constructor and a function?",
    referenceAnswer: "A constructor is called whenever an object is created, whereas a function needs to be called explicitly. Constructors do not have return type, but functions have to indicate a return type.",
    rubric: [
      { noulText: "The answer states that constructors are called automatically when an object is created — they are not called explicitly like functions", weight: 0.4 },
      { noulText: "The answer states that constructors do not have a return type, unlike functions which must declare one", weight: 0.4 },
      { noulText: "The answer frames this as a comparison or difference between the two — not just defining each independently", weight: 0.2 },
    ],
  },
  {
    id: "4.2",
    question: "What is the main difference between strings declared using the type string versus strings declared using an array of characters?",
    referenceAnswer: "The strings declared using an array of characters have a null element added at the end of the array.",
    rubric: [
      { noulText: "The answer specifically mentions the null terminator or null character ('\\0') at the end of character arrays", weight: 0.6 },
      { noulText: "The answer correctly attributes the null terminator to char arrays — not to the string type", weight: 0.25 },
      { noulText: "The answer focuses on the structural or memory difference, not just ease-of-use or manipulation", weight: 0.15 },
    ],
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

// Test set: first 5 rows per question (same as exp-01/02)
const selected: Array<{ row: Row; qdef: QuestionDef }> = [];
for (const qdef of QUESTIONS) {
  const rows = grouped.get(qdef.id) ?? [];
  rows.slice(0, RESPONSES_PER_Q).forEach((row) => selected.push({ row, qdef }));
}

// Few-shot examples: rows 6-8 per question
const fewShotMap = new Map<string, Row[]>();
for (const qdef of QUESTIONS) {
  const rows = grouped.get(qdef.id) ?? [];
  fewShotMap.set(qdef.id, rows.slice(FEW_SHOT_START, FEW_SHOT_START + FEW_SHOT_COUNT));
}

console.log(`\n📋 Exp-03: Jev (rubric) vs Gemini (few-shot) — ${QUESTIONS.length} questions × ${RESPONSES_PER_Q} responses\n`);

// ── Clients ───────────────────────────────────────────────────────────────────

const jevClient = new TypeSafeClient({
  defaultModel: process.env.JEV_MODEL || "jev-latest",
  retry: { maxRetries: 0 },
  timeout: 15000,
});

const genai = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_KEY!);
const geminiModel = genai.getGenerativeModel({ model: "gemini-3.8-flash" });

// ── Jev (rubric — same as exp-02) ────────────────────────────────────────────

async function evalWithJev(
  row: Row,
  qdef: QuestionDef
): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();

  const state = {
    question: qdef.question,
    referenceAnswer: qdef.referenceAnswer,
    studentAnswer: row.Texts,
  };

  const noulQuestions = Object.fromEntries(
    qdef.rubric.map((item, i) => [`rubric_${i}`, noul(item.noulText)])
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
  const rawScore = qdef.rubric.reduce(
    (sum, item, i) => sum + (ans[`rubric_${i}`].noul as number) * item.weight,
    0
  );
  const score = Math.round(rawScore * MOHLER_SCALE * 2) / 2;

  const estimatedTokens = Math.ceil(JSON.stringify({ state, questions }).length / 4);
  const costUsd = estimatedTokens * (0.042 / 1_000_000);

  return { score, latencyMs, costUsd };
}

// ── Gemini (few-shot) ─────────────────────────────────────────────────────────

function buildFewShotPrompt(qdef: QuestionDef, examples: Row[], studentAnswer: string): string {
  const exampleBlock = examples
    .map(
      (ex, i) =>
        `Example ${i + 1}:
Student answer: "${ex.Texts.trim()}"
Score: ${ex.Score} / 5`
    )
    .join("\n\n");

  return `You are grading a student's short answer on a scale of 0 to 5.

Question: ${qdef.question}
Reference answer: ${qdef.referenceAnswer}

Here are ${examples.length} calibration examples showing how a human grader scored this question:

${exampleBlock}

Now grade the following answer using the same standard as the examples above.
Partial credit is allowed — use 0.5 increments.

Student answer: "${studentAnswer.trim()}"

Respond with ONLY valid JSON, no markdown:
{"score": <0.0–5.0>, "reasoning": "<one sentence>"}`;
}

async function evalWithGemini(
  row: Row,
  qdef: QuestionDef
): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();
  const examples = fewShotMap.get(qdef.id) ?? [];
  const prompt = buildFewShotPrompt(qdef, examples, row.Texts);

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text().trim().replace(/```json\n?|```/g, "");
  const json = JSON.parse(text);
  const latencyMs = Math.round(performance.now() - started);

  const usage = result.response.usageMetadata;
  const inputTokens  = usage?.promptTokenCount  ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd =
    inputTokens  * (0.75  / 1_000_000) +
    outputTokens * (3.75  / 1_000_000);

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

  for (const { row, qdef } of selected) {
    const human = parseFloat(row.Score);
    process.stdout.write(`  Q${row.number} | human=${human} | `);

    const [jev, gemini] = await Promise.all([
      evalWithJev(row, qdef),
      evalWithGemini(row, qdef),
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

  // ── Summary ───────────────────────────────────────────────────────────────

  const n   = results.length;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mae = (pred: number[], truth: number[]) =>
    avg(pred.map((p, i) => Math.abs(p - truth[i])));

  const humanScores  = results.map((r) => r.humanScore);
  const jevScores    = results.map((r) => r.jevScore);
  const geminiScores = results.map((r) => r.geminiScore);

  const jevMAE    = mae(jevScores,    humanScores);
  const geminiMAE = mae(geminiScores, humanScores);
  const jevAvgMs    = avg(results.map((r) => r.jevLatencyMs));
  const geminiAvgMs = avg(results.map((r) => r.geminiLatencyMs));
  const jevTotalCost    = results.reduce((s, r) => s + r.jevCostUsd, 0);
  const geminiTotalCost = results.reduce((s, r) => s + r.geminiCostUsd, 0);

  // Load prior experiments for comparison
  function loadMAE(csvFile: string): { jevMAE: number; geminiMAE: number } | null {
    try {
      const rows: Record<string, string>[] = parse(fs.readFileSync(csvFile, "utf8"), { columns: true });
      const h = rows.map((r) => parseFloat(r.human));
      const j = rows.map((r) => parseFloat(r.jev));
      const g = rows.map((r) => parseFloat(r.gemini));
      return { jevMAE: mae(j, h), geminiMAE: mae(g, h) };
    } catch { return null; }
  }

  const e1 = loadMAE(path.join(__dirname, "../../exp-01-with-simple-prompt/data/results.csv"));
  const e2 = loadMAE(path.join(__dirname, "../../exp-02-with-ai-rubric/data/results.csv"));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESULTS  (${n} responses, ${QUESTIONS.length} questions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

             JEV (rubric)    GEMINI (few-shot)
 Speed       ${jevAvgMs.toFixed(0)}ms avg          ${geminiAvgMs.toFixed(0)}ms avg
 Cost        $${jevTotalCost.toFixed(6)}        $${geminiTotalCost.toFixed(6)}
 MAE         ${jevMAE.toFixed(2)} / 5              ${geminiMAE.toFixed(2)} / 5

 ── MAE comparison across experiments ──────────────────
             JEV             GEMINI
 Exp-01      ${e1 ? e1.jevMAE.toFixed(2) : "—"} (simple prompt)  ${e1 ? e1.geminiMAE.toFixed(2) : "—"} (simple prompt)
 Exp-02      ${e2 ? e2.jevMAE.toFixed(2) : "—"} (rubric)         ${e2 ? e2.geminiMAE.toFixed(2) : "—"} (rubric)
 Exp-03      ${jevMAE.toFixed(2)} (rubric)         ${geminiMAE.toFixed(2)} (few-shot)  ← this run

 (lower MAE = closer to human score)

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
    "Student (preview)"
  );
  console.log("─".repeat(100));

  for (const r of results) {
    const jd = (r.jevScore    - r.humanScore).toFixed(1);
    const gd = (r.geminiScore - r.humanScore).toFixed(1);
    console.log(
      ` ${r.qid}`.padEnd(6) +
      `${r.humanScore}`.padEnd(8) +
      `${r.jevScore}`.padEnd(8) +
      `${r.geminiScore}`.padEnd(8) +
      `${Number(jd) >= 0 ? "+" : ""}${jd}`.padEnd(8) +
      `${Number(gd) >= 0 ? "+" : ""}${gd}`.padEnd(8) +
      r.student.trim().replace(/\n/g, " ")
    );
  }

  // ── Save CSV ─────────────────────────────────────────────────────────────

  const outPath = path.join(__dirname, "../data/results.csv");
  const csvOut = [
    "qid,human,jev,gemini,jev_delta,gemini_delta,jev_ms,gemini_ms,jev_cost_usd,gemini_cost_usd",
    ...results.map((r) =>
      [
        r.qid, r.humanScore, r.jevScore, r.geminiScore,
        (r.jevScore    - r.humanScore).toFixed(2),
        (r.geminiScore - r.humanScore).toFixed(2),
        r.jevLatencyMs, r.geminiLatencyMs,
        r.jevCostUsd.toFixed(8), r.geminiCostUsd.toFixed(8),
      ].join(",")
    ),
  ].join("\n");

  fs.writeFileSync(outPath, csvOut);
  console.log(`\n✓ Results saved to bulk-eval/exp-03-gemini-few-shot/data/results.csv\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

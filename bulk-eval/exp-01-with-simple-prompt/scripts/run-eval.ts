/**
 * Bulk eval: Jev vs Gemini on Mohler short-answer dataset
 *
 * Usage:
 *   npx tsx bulk-eval/scripts/run-eval.ts
 *
 * Picks 3 questions × 5 responses = 15 student answers.
 * Runs Jev (noul) and Gemini in parallel per response.
 * Prints speed / cost / accuracy comparison.
 */

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { TypeSafeClient, noul, choice } from "@typesafe-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
dotenv.config({ path: new URL("../../.env.local", import.meta.url).pathname });

// ── Config ────────────────────────────────────────────────────────────────────

const NUM_QUESTIONS = 3;
const RESPONSES_PER_Q = 5;
const MOHLER_SCALE = 5; // scores are 0–5

// Fixed question IDs for reproducibility (from Mohler dataset)
const QUESTION_IDS = ["1.1", "2.3", "4.2"];

// ── Load dataset ──────────────────────────────────────────────────────────────

interface Row {
  number: string;
  Questions: string;
  Answers: string;  // reference answer
  Texts: string;    // student answer
  Score: string;    // human score 0–5
}

const csvPath = path.join(__dirname, "../data/mohler.csv");
const allRows: Row[] = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true,
});

// Group by question, pick NUM_QUESTIONS × RESPONSES_PER_Q
const grouped = new Map<string, Row[]>();
for (const row of allRows) {
  if (!grouped.has(row.number)) grouped.set(row.number, []);
  grouped.get(row.number)!.push(row);
}

const selected: Row[] = [];
let pickedCount = 0;
for (const qid of QUESTION_IDS) {
  if (pickedCount >= NUM_QUESTIONS) break;
  const rows = grouped.get(qid);
  if (!rows || rows.length < RESPONSES_PER_Q) continue;
  selected.push(...rows.slice(0, RESPONSES_PER_Q));
  pickedCount++;
}

console.log(`\n📋 Running bulk eval on ${pickedCount} questions × ${RESPONSES_PER_Q} responses\n`);

// ── Clients ───────────────────────────────────────────────────────────────────

const jevClient = new TypeSafeClient({
  defaultModel: process.env.JEV_MODEL || "jev-latest",
  retry: { maxRetries: 0 },
  timeout: 15000,
});

const genai = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_KEY!);
const geminiModel = genai.getGenerativeModel({ model: "gemini-3.8-flash" });

// ── Jev evaluator ─────────────────────────────────────────────────────────────

async function evalWithJev(row: Row): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();

  const state = {
    question: row.Questions,
    referenceAnswer: row.Answers,
    studentAnswer: row.Texts,
  };

  const questions = {
    addresses_main_concept: noul(
      `The student's answer correctly addresses the main concept of the question`
    ),
    factually_accurate: noul(
      `The student's answer is factually accurate relative to the reference answer: "${row.Answers}"`
    ),
    complete: noul(
      `The student's answer is sufficiently complete — it doesn't miss key points`
    ),
    quality: choice("What is the overall quality of this student's answer?", {
      excellent: "Fully correct, clear, and complete",
      good: "Mostly correct with minor gaps",
      partial: "Partially correct or incomplete",
      poor: "Mostly incorrect or missing the point",
    }),
  };

  const res = await jevClient.systemOne({ state, questions });
  const latencyMs = Math.round(performance.now() - started);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ans = res.answers as Record<string, any>;

  // Weighted score: each noul contributes probability × (5/3), capped at 5
  const p1: number = ans.addresses_main_concept.noul;
  const p2: number = ans.factually_accurate.noul;
  const p3: number = ans.complete.noul;
  const rawScore = ((p1 + p2 + p3) / 3) * MOHLER_SCALE;
  const score = Math.round(rawScore * 2) / 2; // nearest 0.5

  const inputPayload = JSON.stringify({ state, questions });
  const estimatedTokens = Math.ceil(inputPayload.length / 4);
  const costUsd = estimatedTokens * (0.042 / 1_000_000);

  return { score, latencyMs, costUsd };
}

// ── Gemini evaluator ──────────────────────────────────────────────────────────

async function evalWithGemini(row: Row): Promise<{ score: number; latencyMs: number; costUsd: number }> {
  const started = performance.now();

  const prompt = `Grade this student's short answer on a scale of 0 to 5.

Question: ${row.Questions}
Reference answer: ${row.Answers}
Student answer: ${row.Texts}

Scoring guide:
  5 = Fully correct, clear, complete
  4 = Mostly correct, minor gaps
  3 = Partially correct
  2 = Some relevant content but mostly off
  1 = Minimal relevance
  0 = Incorrect or blank

Respond with ONLY valid JSON, no markdown:
{"score": <0.0–5.0>, "reasoning": "<one sentence>"}`;

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

// ── Run evals ─────────────────────────────────────────────────────────────────

interface Result {
  qid: string;
  question: string;
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

for (const row of selected) {
  const human = parseFloat(row.Score);
  process.stdout.write(`  Q${row.number} | human=${human} | `);

  const [jev, gemini] = await Promise.all([
    evalWithJev(row),
    evalWithGemini(row),
  ]);

  process.stdout.write(
    `jev=${jev.score} (${jev.latencyMs}ms)  gemini=${gemini.score} (${gemini.latencyMs}ms)\n`
  );

  results.push({
    qid: row.number,
    question: row.Questions,
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

// ── Summary ───────────────────────────────────────────────────────────────────

const n = results.length;
const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
const mae = (pred: number[], truth: number[]) =>
  avg(pred.map((p, i) => Math.abs(p - truth[i])));

const humanScores = results.map((r) => r.humanScore);
const jevScores   = results.map((r) => r.jevScore);
const geminiScores = results.map((r) => r.geminiScore);

const jevMAE    = mae(jevScores, humanScores);
const geminiMAE = mae(geminiScores, humanScores);

const jevAvgMs    = avg(results.map((r) => r.jevLatencyMs));
const geminiAvgMs = avg(results.map((r) => r.geminiLatencyMs));

const jevTotalCost    = results.reduce((s, r) => s + r.jevCostUsd, 0);
const geminiTotalCost = results.reduce((s, r) => s + r.geminiCostUsd, 0);

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESULTS  (${n} responses across ${pickedCount} questions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

             JEV          GEMINI
 Speed       ${jevAvgMs.toFixed(0)}ms avg      ${geminiAvgMs.toFixed(0)}ms avg
 Cost        $${jevTotalCost.toFixed(6)}    $${geminiTotalCost.toFixed(6)}
 MAE         ${jevMAE.toFixed(2)} / 5        ${geminiMAE.toFixed(2)} / 5

 (MAE = mean absolute error vs human score, lower is better)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PER-RESPONSE BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
  const jevDelta   = (r.jevScore   - r.humanScore).toFixed(1);
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

// ── Save CSV ──────────────────────────────────────────────────────────────────

const outPath = path.join(__dirname, "../data/results.csv");
const csvOut = [
  "qid,human,jev,gemini,jev_delta,gemini_delta,jev_ms,gemini_ms,jev_cost_usd,gemini_cost_usd",
  ...results.map((r) =>
    [
      r.qid,
      r.humanScore,
      r.jevScore,
      r.geminiScore,
      (r.jevScore - r.humanScore).toFixed(2),
      (r.geminiScore - r.humanScore).toFixed(2),
      r.jevLatencyMs,
      r.geminiLatencyMs,
      r.jevCostUsd.toFixed(8),
      r.geminiCostUsd.toFixed(8),
    ].join(",")
  ),
].join("\n");

fs.writeFileSync(outPath, csvOut);
console.log(`\n✓ Results saved to bulk-eval/data/results.csv\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

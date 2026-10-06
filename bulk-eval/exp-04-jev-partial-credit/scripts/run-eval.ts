/**
 * Exp-04: Jev with split/softened noul items for partial credit
 *
 * Each strict rubric item from exp-02/03 is split into:
 *   - a coarse check (broader, easier to satisfy) → higher weight
 *   - a precision bonus (exact phrasing/concept)  → lower weight
 *
 * This lets Jev award partial credit for near-misses instead of
 * treating them as full misses.
 *
 * Gemini: unchanged from exp-03 (few-shot — MAE 0.50, best so far)
 *
 * Usage:
 *   npx tsx bulk-eval/exp-04-jev-partial-credit/scripts/run-eval.ts
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
const FEW_SHOT_START  = 5;
const FEW_SHOT_COUNT  = 3;
const MOHLER_SCALE    = 5;

// ── Rubric definitions ────────────────────────────────────────────────────────
//
// Design rule: each original strict item → 1 coarse check + 1 precision bonus
// Coarse:     broader phrasing, student gets credit for being in the right area
// Precision:  exact concept/term, bonus for hitting it precisely
// Weights must sum to 1.0 per question.

interface RubricItem {
  noulText: string;
  weight: number;
  label: string;  // for readability
}

interface QuestionDef {
  id: string;
  question: string;
  referenceAnswer: string;
  rubric: RubricItem[];
}

const QUESTIONS: QuestionDef[] = [
  {
    id: "1.1",
    question: "What is the role of a prototype program in problem solving?",
    referenceAnswer: "To simulate the behaviour of portions of the desired software product.",
    rubric: [
      // Original: "simulates behaviour" (0.5) → split into coarse + precision
      {
        label: "coarse: any development/testing role",
        noulText: "The answer describes any useful role of a prototype in software development or testing — such as helping understand requirements, finding problems, or demonstrating feasibility",
        weight: 0.2,
      },
      {
        label: "precision: specifically simulates/models",
        noulText: "The answer specifically uses the concept of simulating or modelling behaviour — not just showing, presenting, or demonstrating to users",
        weight: 0.3,
      },
      // Original: "portions of software" (0.3) → split
      {
        label: "coarse: not the whole system",
        noulText: "The answer implies the prototype is not the full final product — it is a partial, early, or limited version",
        weight: 0.2,
      },
      {
        label: "precision: specifically mentions portions/parts",
        noulText: "The answer explicitly refers to portions, parts, or sections of the software product — not the entire system",
        weight: 0.1,
      },
      // Original: "development tool not presentation" (0.2) → keep as one (already soft)
      {
        label: "development tool framing",
        noulText: "The answer frames the prototype as a development or problem-solving tool — not purely a presentation or sales demo for clients",
        weight: 0.2,
      },
    ],
  },
  {
    id: "2.3",
    question: "What is the difference between a constructor and a function?",
    referenceAnswer:
      "A constructor is called whenever an object is created, whereas a function needs to be called explicitly. Constructors do not have return type, but functions have to indicate a return type.",
    rubric: [
      // Original: "called automatically on object creation" (0.4) → split
      {
        label: "coarse: constructors relate to object creation",
        noulText: "The answer connects constructors to the creation or initialization of objects — even if it doesn't specify when or how they are invoked",
        weight: 0.15,
      },
      {
        label: "precision: automatically called, not explicit",
        noulText: "The answer states that constructors are called automatically when an object is created — and are not called explicitly like regular functions",
        weight: 0.25,
      },
      // Original: "no return type" (0.4) → split
      {
        label: "coarse: constructors behave differently with return values",
        noulText: "The answer mentions that constructors and functions differ in how they handle return values or output",
        weight: 0.15,
      },
      {
        label: "precision: constructors have no return type",
        noulText: "The answer specifically states that constructors do not have a return type, while functions must declare a return type",
        weight: 0.25,
      },
      // Original: "comparison not just definitions" (0.2) → keep
      {
        label: "comparison framing",
        noulText: "The answer frames the response as a direct comparison or difference between constructors and functions — not just two separate definitions",
        weight: 0.20,
      },
    ],
  },
  {
    id: "4.2",
    question:
      "What is the main difference between strings declared using the type string versus strings declared using an array of characters?",
    referenceAnswer:
      "The strings declared using an array of characters have a null element added at the end of the array.",
    rubric: [
      // Original: "null terminator mentioned" (0.6) → split into coarse + precision
      {
        label: "coarse: any special ending element in char arrays",
        noulText: "The answer mentions that character arrays have some special element, terminator, or marker at the end — even if not named precisely",
        weight: 0.3,
      },
      {
        label: "precision: specifically null / \\0 / null character",
        noulText: "The answer specifically names the terminating element as null, the null character, or \\0",
        weight: 0.3,
      },
      // Original: "attributed to char arrays not string type" (0.25) → keep
      {
        label: "attributed to char array",
        noulText: "The answer correctly attributes this characteristic to char arrays — not to the string type",
        weight: 0.25,
      },
      // Original: "structural not manipulation" (0.15) → keep
      {
        label: "structural difference focus",
        noulText: "The answer focuses on a structural or memory-level difference — not just ease-of-use or manipulation convenience",
        weight: 0.15,
      },
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

const selected: Array<{ row: Row; qdef: QuestionDef }> = [];
for (const qdef of QUESTIONS) {
  const rows = grouped.get(qdef.id) ?? [];
  rows.slice(0, RESPONSES_PER_Q).forEach((row) => selected.push({ row, qdef }));
}

const fewShotMap = new Map<string, Row[]>();
for (const qdef of QUESTIONS) {
  const rows = grouped.get(qdef.id) ?? [];
  fewShotMap.set(qdef.id, rows.slice(FEW_SHOT_START, FEW_SHOT_START + FEW_SHOT_COUNT));
}

console.log(`\n📋 Exp-04: Jev (partial credit) vs Gemini (few-shot) — ${QUESTIONS.length} questions × ${RESPONSES_PER_Q} responses\n`);
for (const qdef of QUESTIONS) {
  console.log(`  Q${qdef.id}: ${qdef.rubric.length} noul items (weights: ${qdef.rubric.map(r => r.weight).join(", ")})`);
}
console.log();

// ── Clients ───────────────────────────────────────────────────────────────────

const jevClient = new TypeSafeClient({
  defaultModel: process.env.JEV_MODEL || "jev-latest",
  retry: { maxRetries: 0 },
  timeout: 15000,
});

const genai = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_KEY!);
const geminiModel = genai.getGenerativeModel({ model: "gemini-3.8-flash" });

// ── Jev (split noul items) ────────────────────────────────────────────────────

async function evalWithJev(
  row: Row,
  qdef: QuestionDef
): Promise<{ score: number; latencyMs: number; costUsd: number; breakdown: string }> {
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
    quality: choice("Overall quality of this student's answer?", {
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

  const itemScores = qdef.rubric.map((item, i) => {
    const p: number = ans[`rubric_${i}`].noul;
    return { label: item.label, p, contribution: p * item.weight };
  });

  const rawScore = itemScores.reduce((sum, s) => sum + s.contribution, 0);
  const score = Math.round(rawScore * MOHLER_SCALE * 2) / 2;

  const breakdown = itemScores
    .map((s) => `${s.label}: p=${s.p.toFixed(2)} × w=${qdef.rubric[itemScores.indexOf(s)].weight} = ${s.contribution.toFixed(3)}`)
    .join(" | ");

  const estimatedTokens = Math.ceil(JSON.stringify({ state, questions }).length / 4);
  const costUsd = estimatedTokens * (0.042 / 1_000_000);

  return { score, latencyMs, costUsd, breakdown };
}

// ── Gemini (few-shot — unchanged from exp-03) ─────────────────────────────────

function buildFewShotPrompt(qdef: QuestionDef, examples: Row[], studentAnswer: string): string {
  const exampleBlock = examples
    .map((ex, i) => `Example ${i + 1}:\nStudent answer: "${ex.Texts.trim()}"\nScore: ${ex.Score} / 5`)
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
  const costUsd = inputTokens * (0.75 / 1_000_000) + outputTokens * (3.75 / 1_000_000);

  return { score: Math.round(Number(json.score) * 2) / 2, latencyMs, costUsd };
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
  jevBreakdown: string;
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
      jevBreakdown: jev.breakdown,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

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

  function loadMAE(f: string) {
    try {
      const rows: Record<string, string>[] = parse(fs.readFileSync(f, "utf8"), { columns: true });
      const h = rows.map((r) => parseFloat(r.human));
      return { jev: mae(rows.map((r) => parseFloat(r.jev)), h), gemini: mae(rows.map((r) => parseFloat(r.gemini)), h) };
    } catch { return null; }
  }

  const e1 = loadMAE(path.join(__dirname, "../../exp-01-with-simple-prompt/data/results.csv"));
  const e2 = loadMAE(path.join(__dirname, "../../exp-02-with-ai-rubric/data/results.csv"));
  const e3 = loadMAE(path.join(__dirname, "../../exp-03-gemini-few-shot/data/results.csv"));

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RESULTS  (${results.length} responses, ${QUESTIONS.length} questions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

             JEV             GEMINI
 Speed       ${jevAvgMs.toFixed(0)}ms avg          ${geminiAvgMs.toFixed(0)}ms avg
 Cost        $${jevTotalCost.toFixed(6)}        $${geminiTotalCost.toFixed(6)}
 MAE         ${jevMAE.toFixed(2)} / 5              ${geminiMAE.toFixed(2)} / 5

 ── MAE progression ─────────────────────────────────────
             JEV             GEMINI         GEMINI strategy
 Exp-01      ${e1?.jev.toFixed(2) ?? "—"}              ${e1?.gemini.toFixed(2) ?? "—"}             simple prompt
 Exp-02      ${e2?.jev.toFixed(2) ?? "—"}              ${e2?.gemini.toFixed(2) ?? "—"}             rubric
 Exp-03      ${e3?.jev.toFixed(2) ?? "—"}              ${e3?.gemini.toFixed(2) ?? "—"}             few-shot
 Exp-04      ${jevMAE.toFixed(2)}              ${geminiMAE.toFixed(2)}             few-shot   ← this run
             (partial credit)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PER-RESPONSE BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  console.log(
    " Q".padEnd(6) + "Human".padEnd(8) + "Jev".padEnd(8) +
    "Gemini".padEnd(8) + "Jev Δ".padEnd(8) + "Gem Δ".padEnd(8) + "Student (preview)"
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

  // Print Jev breakdown for one question to show partial credit in action
  console.log(`\n── Jev noul breakdown for Q4.2 (null terminator question) ─────────────\n`);
  for (const r of results.filter((r) => r.qid === "4.2")) {
    console.log(` human=${r.humanScore} jev=${r.jevScore}`);
    for (const part of r.jevBreakdown.split(" | ")) {
      console.log(`   ${part}`);
    }
    console.log();
  }

  // ── Save CSV ─────────────────────────────────────────────────────────────

  const outPath = path.join(__dirname, "../data/results.csv");
  const csvOut = [
    "qid,human,jev,gemini,jev_delta,gemini_delta,jev_ms,gemini_ms,jev_cost_usd,gemini_cost_usd",
    ...results.map((r) =>
      [
        r.qid, r.humanScore, r.jevScore, r.geminiScore,
        (r.jevScore - r.humanScore).toFixed(2),
        (r.geminiScore - r.humanScore).toFixed(2),
        r.jevLatencyMs, r.geminiLatencyMs,
        r.jevCostUsd.toFixed(8), r.geminiCostUsd.toFixed(8),
      ].join(",")
    ),
  ].join("\n");

  fs.writeFileSync(outPath, csvOut);
  console.log(`✓ Results saved to bulk-eval/exp-04-jev-partial-credit/data/results.csv\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

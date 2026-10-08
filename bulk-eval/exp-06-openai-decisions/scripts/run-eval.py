"""
Exp-06: OpenAI Decisions (gpt-6-luna) vs Gemini (few-shot)

OpenAI Decisions uses the same split rubric items as exp-04 (coarse + precision).
Predicate = noul equivalent; probability 0–1 weighted same way.
Gemini uses same few-shot prompt as exp-03/04/05.

Usage:
  python3.11 bulk-eval/exp-06-openai-decisions/scripts/run-eval.py
"""

import csv
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from google import genai

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env.local", override=True)
except ImportError:
    pass

gemini_client = genai.Client(api_key=os.environ["GOOGLE_GENERATIVE_AI_KEY"])
GEMINI_MODEL  = "gemini-3.8-flash"
OPENAI_KEY    = os.environ["OPENAI_API_KEY"]
DECISIONS_URL = "https://api.openai.com/v1/decisions"
DECISIONS_MODEL = "gpt-6-luna"

# ── Config ────────────────────────────────────────────────────────────────────

RESPONSES_PER_Q = 5
FEW_SHOT_START  = 5
FEW_SHOT_COUNT  = 3
MOHLER_SCALE    = 5

# ── Question definitions (same split items as exp-04) ────────────────────────

@dataclass
class RubricItem:
    text: str
    weight: float

@dataclass
class QuestionDef:
    id: str
    question: str
    reference_answer: str
    rubric: list[RubricItem]

QUESTIONS = [
    QuestionDef(
        id="1.1",
        question="What is the role of a prototype program in problem solving?",
        reference_answer="To simulate the behaviour of portions of the desired software product.",
        rubric=[
            RubricItem("the answer mentions simulating or modelling — not just showing or demonstrating to users", 0.3),
            RubricItem("the answer specifically uses simulate / model / emulate as the core concept", 0.2),
            RubricItem("the answer refers to portions or parts of the software — not the entire product", 0.2),
            RubricItem("the answer explicitly says 'portions' or 'parts' of the software product", 0.1),
            RubricItem("the answer frames a prototype as a development or problem-solving tool, not a presentation tool", 0.2),
        ],
    ),
    QuestionDef(
        id="2.3",
        question="What is the difference between a constructor and a function?",
        reference_answer="A constructor is called whenever an object is created, whereas a function needs to be called explicitly. Constructors do not have return type, but functions have to indicate a return type.",
        rubric=[
            RubricItem("the answer says constructors are called when an object is created — automatic invocation", 0.2),
            RubricItem("the answer specifically says constructors are called automatically / implicitly on object creation", 0.2),
            RubricItem("the answer says constructors do not have a return type or return void", 0.2),
            RubricItem("the answer specifically contrasts constructor (no return type) vs function (must declare return type)", 0.2),
            RubricItem("the answer frames this as a comparison or difference — not just defining each independently", 0.2),
        ],
    ),
    QuestionDef(
        id="4.2",
        question="What is the main difference between strings declared using the type string versus strings declared using an array of characters?",
        reference_answer="The strings declared using an array of characters have a null element added at the end of the array.",
        rubric=[
            RubricItem("the answer mentions some special ending element or terminator in character arrays", 0.2),
            RubricItem("the answer specifically mentions null terminator, null character, or '\\0' at the end of char arrays", 0.3),
            RubricItem("the answer correctly attributes this null element to char arrays — not to the string type", 0.2),
            RubricItem("the answer says null/terminator is automatically added at the end of char arrays", 0.15),
            RubricItem("the answer focuses on the structural or memory difference — not just ease-of-use or manipulation", 0.15),
        ],
    ),
]

# ── Load dataset ──────────────────────────────────────────────────────────────

DATA_DIR = Path(__file__).parents[2] / "data"
rows_by_qid: dict[str, list[dict]] = {}
with open(DATA_DIR / "mohler.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows_by_qid.setdefault(row["number"], []).append(row)

selected = [
    (row, qdef)
    for qdef in QUESTIONS
    for row in rows_by_qid.get(qdef.id, [])[:RESPONSES_PER_Q]
]

few_shot: dict[str, list[dict]] = {
    qdef.id: rows_by_qid.get(qdef.id, [])[FEW_SHOT_START:FEW_SHOT_START + FEW_SHOT_COUNT]
    for qdef in QUESTIONS
}

print(f"\nExp-06: OpenAI Decisions (gpt-6-luna) vs Gemini (few-shot) — {len(QUESTIONS)} questions × {RESPONSES_PER_Q} responses\n")

# ── OpenAI Decisions evaluator ────────────────────────────────────────────────

def eval_with_decisions(row: dict, qdef: QuestionDef) -> dict:
    started = time.perf_counter()

    state = (
        f"Question: {qdef.question}\n"
        f"Reference answer: {qdef.reference_answer}\n"
        f"Student answer: {row['Texts']}"
    )

    questions = [
        {"type": "predicate", "name": f"rubric_{i}", "instructions": item.text}
        for i, item in enumerate(qdef.rubric)
    ]

    resp = httpx.post(
        DECISIONS_URL,
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
        json={"model": DECISIONS_MODEL, "input": state, "questions": questions},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    latency_ms = round((time.perf_counter() - started) * 1000)

    answers = {a["name"]: a for a in data["answers"]}
    raw = sum(
        answers[f"rubric_{i}"]["probability"] * item.weight
        for i, item in enumerate(qdef.rubric)
    )
    score = round(raw * MOHLER_SCALE * 2) / 2

    usage = data.get("usage", {})
    input_tokens = usage.get("input_tokens", 0)
    # gpt-6-luna pricing (decisions endpoint) — $0.10/1M input, $0/output
    cost_usd = input_tokens * (0.10 / 1_000_000)

    return {"score": score, "latency_ms": latency_ms, "cost_usd": cost_usd, "input_tokens": input_tokens}

# ── Gemini (few-shot) ─────────────────────────────────────────────────────────

def build_few_shot_prompt(qdef: QuestionDef, examples: list[dict], student_answer: str) -> str:
    example_block = "\n\n".join(
        f'Example {i+1}:\nStudent answer: "{ex["Texts"].strip()}"\nScore: {ex["Score"]} / 5'
        for i, ex in enumerate(examples)
    )
    return f"""You are grading a student's short answer on a scale of 0 to 5.

Question: {qdef.question}
Reference answer: {qdef.reference_answer}

Here are {len(examples)} calibration examples showing how a human grader scored this question:

{example_block}

Now grade the following answer using the same standard as the examples above.
Partial credit is allowed — use 0.5 increments.

Student answer: "{student_answer.strip()}"

Respond with ONLY valid JSON, no markdown:
{{"score": <0.0-5.0>, "reasoning": "<one sentence>"}}"""

def eval_with_gemini(row: dict, qdef: QuestionDef) -> dict:
    started = time.perf_counter()
    prompt = build_few_shot_prompt(qdef, few_shot[qdef.id], row["Texts"])

    result = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    text = re.sub(r"```json\n?|```", "", result.text.strip()).strip()
    data = json.loads(text)
    latency_ms = round((time.perf_counter() - started) * 1000)

    usage = result.usage_metadata
    input_tokens  = getattr(usage, "prompt_token_count",     0) or 0
    output_tokens = getattr(usage, "candidates_token_count", 0) or 0
    cost_usd = input_tokens * (0.10 / 1_000_000) + output_tokens * (0.40 / 1_000_000)

    return {"score": round(float(data["score"]) * 2) / 2, "latency_ms": latency_ms, "cost_usd": cost_usd}

# ── Run ───────────────────────────────────────────────────────────────────────

@dataclass
class Result:
    qid: str
    student: str
    human: float
    decisions_score: float
    gemini_score: float
    decisions_ms: int
    gemini_ms: int
    decisions_cost: float
    gemini_cost: float

results: list[Result] = []

for row, qdef in selected:
    human = float(row["Score"])
    print(f"  Q{row['number']} | human={human} | ", end="", flush=True)

    d = eval_with_decisions(row, qdef)
    g = eval_with_gemini(row, qdef)

    print(f"decisions={d['score']} ({d['latency_ms']}ms)  gemini={g['score']} ({g['latency_ms']}ms)")

    results.append(Result(
        qid=row["number"],
        student=row["Texts"][:80],
        human=human,
        decisions_score=d["score"],
        gemini_score=g["score"],
        decisions_ms=d["latency_ms"],
        gemini_ms=g["latency_ms"],
        decisions_cost=d["cost_usd"],
        gemini_cost=g["cost_usd"],
    ))

# ── Summary ───────────────────────────────────────────────────────────────────

avg = lambda xs: sum(xs) / len(xs)
mae = lambda pred, truth: avg([abs(p - t) for p, t in zip(pred, truth)])

humans     = [r.human           for r in results]
decisions  = [r.decisions_score for r in results]
geminis    = [r.gemini_score    for r in results]

decisions_mae = mae(decisions, humans)
gemini_mae    = mae(geminis,   humans)
decisions_avg_ms = avg([r.decisions_ms for r in results])
gemini_avg_ms    = avg([r.gemini_ms    for r in results])
decisions_total_cost = sum(r.decisions_cost for r in results)
gemini_total_cost    = sum(r.gemini_cost    for r in results)

def load_mae_jev_gem(csv_path: str):
    try:
        rows = list(csv.DictReader(open(csv_path)))
        h = [float(r["human"])  for r in rows]
        j = [float(r["jev"])    for r in rows]
        g = [float(r["gemini"]) for r in rows]
        return mae(j, h), mae(g, h)
    except Exception:
        return None, None

e1_jev, e1_gem = load_mae_jev_gem(str(DATA_DIR.parent / "exp-01-with-simple-prompt/data/results.csv"))
e4_jev, e4_gem = load_mae_jev_gem(str(DATA_DIR.parent / "exp-04-jev-partial-credit/data/results.csv"))

print(f"""
{'━'*60}
 RESULTS  ({len(results)} responses, {len(QUESTIONS)} questions)
{'━'*60}

             DECISIONS (gpt-6-luna)   GEMINI (few-shot)
 Speed       {decisions_avg_ms:.0f}ms avg              {gemini_avg_ms:.0f}ms avg
 Cost        ${decisions_total_cost:.6f}          ${gemini_total_cost:.6f}
 MAE         {decisions_mae:.2f} / 5                {gemini_mae:.2f} / 5

 ── MAE across experiments ────────────────────────────────
             JEV / Decisions          GEMINI
 Exp-01      {f'{e1_jev:.2f} (Jev simple prompt)' if e1_jev else '—':30s} {f'{e1_gem:.2f} (simple)' if e1_gem else '—'}
 Exp-04      {f'{e4_jev:.2f} (Jev split rubric)' if e4_jev else '—':30s} {f'{e4_gem:.2f} (few-shot)' if e4_gem else '—'}
 Exp-06      {f'{decisions_mae:.2f} (Decisions split rubric)':30s} {gemini_mae:.2f} (few-shot)   <- this run

 (lower MAE = closer to human score)

{'━'*60}
 PER-RESPONSE BREAKDOWN
{'━'*60}
""")

print(" Q".ljust(6) + "Human".ljust(8) + "Dec".ljust(8) + "Gemini".ljust(8) + "Dec Δ".ljust(8) + "Gem Δ".ljust(8) + "Student (preview)")
print("─" * 100)
for r in results:
    dd = r.decisions_score - r.human
    gd = r.gemini_score    - r.human
    print(
        f" {r.qid}".ljust(6) +
        f"{r.human}".ljust(8) +
        f"{r.decisions_score}".ljust(8) +
        f"{r.gemini_score}".ljust(8) +
        f"{'+' if dd >= 0 else ''}{dd:.1f}".ljust(8) +
        f"{'+' if gd >= 0 else ''}{gd:.1f}".ljust(8) +
        r.student.strip().replace("\n", " ")
    )

# ── Save CSV ──────────────────────────────────────────────────────────────────

out_path = Path(__file__).parents[1] / "data" / "results.csv"
with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["qid", "human", "decisions", "gemini", "decisions_delta", "gemini_delta",
                "decisions_ms", "gemini_ms", "decisions_cost_usd", "gemini_cost_usd"])
    for r in results:
        w.writerow([
            r.qid, r.human, r.decisions_score, r.gemini_score,
            f"{r.decisions_score - r.human:.2f}", f"{r.gemini_score - r.human:.2f}",
            r.decisions_ms, r.gemini_ms,
            f"{r.decisions_cost:.8f}", f"{r.gemini_cost:.8f}",
        ])

print(f"\nResults saved to bulk-eval/exp-06-openai-decisions/data/results.csv\n")

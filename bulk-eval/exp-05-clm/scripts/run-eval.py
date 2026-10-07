"""
Exp-05: CLM (local, Qwen3-8B + heads) vs Gemini (few-shot, exp-03 baseline)

CLM replaces Jev:
  - Same split noul items from exp-04 (coarse + precision)
  - Same weighted scoring: sum(noul_i × weight_i) × 5, rounded to nearest 0.5
  - CLM server must be running on port 8700
  - llama-server embedding endpoint must be running on port 8090

Usage:
  # Start servers first:
  #   llama-server --model ~/.cache/gguf/Qwen3-8B-Q4_K_M.gguf --port 8090 \\
  #     --embeddings --pooling last --n-gpu-layers 99
  #   clm-serve --port 8700 --emb-url http://127.0.0.1:8090/v1/embeddings \\
  #     --ckpt ~/.cache/clm/CLM_v0.1-8B.pt --device cpu --no-ui
  #
  python3.11 bulk-eval/exp-05-clm/scripts/run-eval.py
"""

import csv
import os
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Any

import requests
from clm import CLMClient, Noul, Choice
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[3] / ".env.local")
except ImportError:
    pass

from google import genai
from google.genai import types as genai_types

# ── Config ────────────────────────────────────────────────────────────────────

RESPONSES_PER_Q = 5
FEW_SHOT_START  = 5
FEW_SHOT_COUNT  = 3
MOHLER_SCALE    = 5

# ── Question definitions (same split items as exp-04) ────────────────────────

@dataclass
class RubricItem:
    noul_text: str
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

# Test set: first 5 rows per question
selected = [
    (row, qdef)
    for qdef in QUESTIONS
    for row in rows_by_qid.get(qdef.id, [])[:RESPONSES_PER_Q]
]

# Few-shot examples: rows 6–8 per question
few_shot: dict[str, list[dict]] = {
    qdef.id: rows_by_qid.get(qdef.id, [])[FEW_SHOT_START:FEW_SHOT_START + FEW_SHOT_COUNT]
    for qdef in QUESTIONS
}

print(f"\nExp-05: CLM (local) vs Gemini (few-shot) — {len(QUESTIONS)} questions × {RESPONSES_PER_Q} responses\n")

# ── Clients ───────────────────────────────────────────────────────────────────

clm_client = CLMClient(base_url="http://127.0.0.1:8700")
gemini_client = genai.Client(api_key=os.environ["GOOGLE_GENERATIVE_AI_KEY"])
GEMINI_MODEL = "gemini-3.8-flash"

# ── CLM evaluator ─────────────────────────────────────────────────────────────

def eval_with_clm(row: dict, qdef: QuestionDef) -> dict:
    started = time.perf_counter()

    state = {
        "question": qdef.question,
        "referenceAnswer": qdef.reference_answer,
        "studentAnswer": row["Texts"],
    }

    questions: dict[str, Any] = {
        f"rubric_{i}": Noul(instructions=item.noul_text)
        for i, item in enumerate(qdef.rubric)
    }
    questions["quality"] = Choice(
        instructions="What is the overall quality of this student's answer?",
        criteria={
            "excellent": "Fully correct, clear, and complete",
            "good": "Mostly correct with minor gaps",
            "partial": "Partially correct or incomplete",
            "poor": "Mostly incorrect or missing the key point",
        },
    )

    r = clm_client.system_one(state, questions)
    latency_ms = round((time.perf_counter() - started) * 1000)

    raw = sum(
        r.answers[f"rubric_{i}"].noul * item.weight
        for i, item in enumerate(qdef.rubric)
    )
    score = round(raw * MOHLER_SCALE * 2) / 2

    return {
        "score": score,
        "latency_ms": latency_ms,
        "input_tokens": r.usage.input_tokens if r.usage else 0,
    }

# ── Gemini (few-shot, same as exp-03/04) ─────────────────────────────────────

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
    import json, re
    started = time.perf_counter()
    examples = few_shot[qdef.id]
    prompt = build_few_shot_prompt(qdef, examples, row["Texts"])

    result = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    text = result.text.strip()
    text = re.sub(r"```json\n?|```", "", text).strip()
    data = json.loads(text)
    latency_ms = round((time.perf_counter() - started) * 1000)

    usage = result.usage_metadata
    input_tokens  = getattr(usage, "prompt_token_count",      0) or 0
    output_tokens = getattr(usage, "candidates_token_count",  0) or 0
    cost_usd = input_tokens * (0.10 / 1_000_000) + output_tokens * (0.40 / 1_000_000)

    score = round(float(data["score"]) * 2) / 2
    return {"score": score, "latency_ms": latency_ms, "cost_usd": cost_usd}

# ── Run ───────────────────────────────────────────────────────────────────────

@dataclass
class Result:
    qid: str
    student: str
    human: float
    clm_score: float
    gemini_score: float
    clm_ms: int
    gemini_ms: int
    clm_tokens: int
    gemini_cost: float

results: list[Result] = []

for row, qdef in selected:
    human = float(row["Score"])
    print(f"  Q{row['number']} | human={human} | ", end="", flush=True)

    clm    = eval_with_clm(row, qdef)
    gemini = eval_with_gemini(row, qdef)

    print(f"clm={clm['score']} ({clm['latency_ms']}ms)  gemini={gemini['score']} ({gemini['latency_ms']}ms)")

    results.append(Result(
        qid=row["number"],
        student=row["Texts"][:80],
        human=human,
        clm_score=clm["score"],
        gemini_score=gemini["score"],
        clm_ms=clm["latency_ms"],
        gemini_ms=gemini["latency_ms"],
        clm_tokens=clm["input_tokens"],
        gemini_cost=gemini["cost_usd"],
    ))

# ── Summary ───────────────────────────────────────────────────────────────────

n = len(results)
avg = lambda xs: sum(xs) / len(xs)
mae = lambda pred, truth: avg([abs(p - t) for p, t in zip(pred, truth)])

humans  = [r.human       for r in results]
clms    = [r.clm_score   for r in results]
geminis = [r.gemini_score for r in results]

clm_mae    = mae(clms, humans)
gemini_mae = mae(geminis, humans)
clm_avg_ms    = avg([r.clm_ms    for r in results])
gemini_avg_ms = avg([r.gemini_ms for r in results])

# Load prior experiments for comparison
def load_mae(csv_path: str):
    try:
        rows = list(csv.DictReader(open(csv_path)))
        h = [float(r["human"]) for r in rows]
        j = [float(r["jev"])   for r in rows]
        g = [float(r["gemini"]) for r in rows]
        return mae(j, h), mae(g, h)
    except Exception:
        return None, None

e1_jev, e1_gem = load_mae(str(DATA_DIR.parent / "exp-01-with-simple-prompt/data/results.csv"))
e4_jev, e4_gem = load_mae(str(DATA_DIR.parent / "exp-04-jev-partial-credit/data/results.csv"))

print(f"""
{'━'*58}
 RESULTS  ({n} responses, {len(QUESTIONS)} questions)
{'━'*58}

             CLM (local)      GEMINI (few-shot)
 Speed       {clm_avg_ms:.0f}ms avg          {gemini_avg_ms:.0f}ms avg
 MAE         {clm_mae:.2f} / 5              {gemini_mae:.2f} / 5

 ── MAE across experiments ──────────────────────────────
             JEV / CLM        GEMINI
 Exp-01      {f'{e1_jev:.2f} (simple prompt)' if e1_jev else '—  ':25s}  {f'{e1_gem:.2f} (simple prompt)' if e1_gem else '—'}
 Exp-04      {f'{e4_jev:.2f} (split rubric)' if e4_jev else '—  ':25s}  {f'{e4_gem:.2f} (few-shot)' if e4_gem else '—'}
 Exp-05      {f'{clm_mae:.2f} (CLM local)':25s}  {gemini_mae:.2f} (few-shot)   <- this run

 (lower MAE = closer to human score)

{'━'*58}
 PER-RESPONSE BREAKDOWN
{'━'*58}
""")

header = " Q".ljust(6) + "Human".ljust(8) + "CLM".ljust(8) + "Gemini".ljust(8) + "CLM Δ".ljust(8) + "Gem Δ".ljust(8) + "Student (preview)"
print(header)
print("─" * 100)
for r in results:
    cd = r.clm_score   - r.human
    gd = r.gemini_score - r.human
    print(
        f" {r.qid}".ljust(6) +
        f"{r.human}".ljust(8) +
        f"{r.clm_score}".ljust(8) +
        f"{r.gemini_score}".ljust(8) +
        f"{'+' if cd >= 0 else ''}{cd:.1f}".ljust(8) +
        f"{'+' if gd >= 0 else ''}{gd:.1f}".ljust(8) +
        r.student.strip().replace("\n", " ")
    )

# ── Save CSV ──────────────────────────────────────────────────────────────────

out_path = Path(__file__).parents[1] / "data" / "results.csv"
with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["qid", "human", "clm", "gemini", "clm_delta", "gemini_delta", "clm_ms", "gemini_ms"])
    for r in results:
        w.writerow([
            r.qid, r.human, r.clm_score, r.gemini_score,
            f"{r.clm_score - r.human:.2f}", f"{r.gemini_score - r.human:.2f}",
            r.clm_ms, r.gemini_ms,
        ])

print(f"\nResults saved to bulk-eval/exp-05-clm/data/results.csv\n")

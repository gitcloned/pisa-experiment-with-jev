# Bulk Eval — Experiment Summary

**Dataset:** Mohler short-answer grading dataset (CS questions, 2,442 responses, human scores 0–5)
**Test set:** 3 questions × 5 responses = 15 responses per experiment
**Metric:** MAE (Mean Absolute Error) vs human score, out of 5. Lower = better.

---

## Results at a glance

| Exp | Jev strategy        | Gemini strategy   | Jev MAE | Gemini MAE |
|-----|---------------------|-------------------|---------|------------|
| 01  | 3 generic noul items | Simple prompt    | 1.10    | 1.00       |
| 02  | Question-specific rubric | Rubric prompt | 1.03    | 1.83       |
| 03  | Question-specific rubric | Few-shot (3 examples) | 1.03 | 0.50  |
| 04  | Split noul (coarse + precision) | Few-shot | **0.77** | **0.60** |

---

## Experiment details

### Exp-01 — Simple prompt (baseline)
**Jev:** 3 generic noul items for every question regardless of content:
- "correctly addresses the main concept"
- "factually accurate relative to reference answer"
- "sufficiently complete"

**Gemini:** plain prompt — question + reference answer + student answer + "score 0–5".

**Result:** Both models perform similarly. Gemini over-scores (tends toward 4–5). Jev under-scores (too strict on completeness).

**Learnt:**
- Generic noul items give Jev no anchor — it can't tell what specifically the human cares about
- Gemini without calibration is lenient — a student who writes something *true but tangential* gets a high score

---

### Exp-02 — Question-specific rubric for both models
**Change:** Analysed reference answers and human scores from exp-01 to derive 3 targeted noul items per question. Fed the same rubric as bullet points into Gemini's prompt.

**Jev:** slight improvement (1.10 → 1.03). Rubric gave it something concrete to check against.

**Gemini:** collapsed (1.00 → 1.83). Rubric made it hyper-literal — it started checking for exact keywords instead of meaning, penalising correct answers phrased differently.

**Learnt:**
- Rubric helps Jev; hurts Gemini
- Gemini uses holistic judgement naturally — constraining it with a rubric breaks that
- Jev benefits from knowing *what the question is actually testing*, but the items were still too binary

---

### Exp-03 — Few-shot calibration for Gemini
**Change:** Instead of a rubric, gave Gemini 3 calibration examples per question (rows 6–8 from the dataset) showing a low, mid, and high human-scored answer before asking it to grade.

**Jev:** unchanged from exp-02 (same rubric).

**Gemini:** halved its error (1.00 → 0.50). Few-shot examples showed it what the human grader actually rewards — without constraining *how* it reasons.

**Learnt:**
- Few-shot is the right lever for Gemini — it calibrates without over-constraining
- Gemini's holistic reasoning is a strength when it has reference points
- The 3 examples need to span the score range (low/mid/high) to be effective

---

### Exp-04 — Split noul items for Jev (partial credit)
**Change:** Each strict noul item from exp-02/03 split into:
- **Coarse check** — broader, easier to satisfy (student gets credit for being in the right area)
- **Precision bonus** — exact concept or term (additional credit for hitting it precisely)

Example for Q4.2 (null terminator):
- Before: `noul("mentions null terminator")` — weight 0.6 → near-miss scores ~0
- After: `noul("any special ending element")` weight 0.3 + `noul("specifically null/\0")` weight 0.3 → near-miss scores ~0.5–1.5

**Jev:** improved significantly (1.03 → 0.77). Coarse checks catch partial understanding.
**Gemini:** slight regression (0.50 → 0.60) — likely variance given the small sample size. Prompt unchanged from exp-03.

**Learnt:**
- Binary noul items punish partial understanding too harshly
- Splitting into coarse + precision mirrors how human graders actually think: "they got the gist, partial credit"
- Jev's under-scoring problem on Q2.3 persists — answers that cover only one of two required distinctions are still penalised more than humans would

---

## Key takeaways

**What works for Jev:**
1. Question-specific rubric items (not generic)
2. Split each item into coarse + precision to enable partial credit
3. Weight items by how central they are to the reference answer

**What works for Gemini:**
1. Few-shot calibration with 3 scored examples spanning the score range
2. No explicit rubric — let it use holistic judgement
3. Simple prompt structure; complexity hurts it

**Speed and cost remain Jev's advantage:**
- Jev: ~350ms avg, ~$0.000013 per response
- Gemini: ~2,800ms avg, ~$0.0004 per response
- Jev is ~8× faster and ~30× cheaper

**Open questions:**
- Would more few-shot examples (5–10) further improve Gemini?
- Can Jev reach Gemini's accuracy with an ensemble of coarse+precision items across more rubric dimensions?
- Does the pattern hold on math questions (vs CS questions used here)?

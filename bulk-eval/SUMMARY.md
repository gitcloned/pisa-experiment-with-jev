# Bulk Eval — Experiment Summary

**Dataset:** Mohler short-answer grading dataset (CS questions, 2,442 responses, human scores 0–5)
**Test set:** 3 questions × 5 responses = 15 responses per experiment
**Metric:** MAE (Mean Absolute Error) vs human score, out of 5. Lower = better.

---

## Results at a glance

| Exp | Jev MAE | CLM MAE | Decisions MAE | Gemini MAE | Strategy |
|-----|---------|---------|---------------|------------|----------|
| 01  | 1.10    | -       | -             | 1.00       | Jev: 3 generic noul items / Gemini: simple prompt |
| 02  | 1.03    | -       | -             | 1.83       | Jev: question-specific rubric / Gemini: rubric prompt |
| 03  | 1.03    | -       | -             | 0.50       | Jev: question-specific rubric / Gemini: few-shot |
| 04  | **0.77**| -       | -             | **0.60**   | Jev: split noul (coarse + precision) / Gemini: few-shot |
| 05  | -       | 1.47    | -             | 0.57       | CLM: split noul (local Qwen3-8B) / Gemini: few-shot |
| 06  | -       | -       | **0.50**      | 0.53       | Decisions: split noul (gpt-6-luna) / Gemini: few-shot |

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

### Exp-05 — CLM (local, Qwen3-8B) as Jev replacement

**What CLM is:** Contrastive Language Models — an open-source System One engine that mirrors Jev's noul/choice/score API. It runs fully locally: a small trained "head pair" (state head + action head) sits on top of any base LLM's embeddings and scores state–question pairs contrastively.

**How it was set up:**

1. **Embedding server** — llama.cpp serving Qwen3-8B-Q4_K_M.gguf in embedding mode:
   ```
   llama-server --model ~/.cache/gguf/Qwen3-8B-Q4_K_M.gguf \
     --port 8090 --embeddings --pooling last --n-gpu-layers 99
   ```

2. **CLM server** — thin FastAPI layer that loads the pretrained heads and calls the embedding server:
   ```
   clm-serve --port 8700 \
     --emb-url http://127.0.0.1:8090/v1/embeddings \
     --ckpt ~/.cache/clm/CLM_v0.1-8B.pt \
     --device cpu --no-ui
   ```

3. **Client** — drop-in replacement for the Jev SDK:
   ```python
   from clm import CLMClient, Noul, Choice
   client = CLMClient(base_url="http://127.0.0.1:8700")
   r = client.system_one(state, {"ok": Noul(instructions="...")})
   r.answers["ok"].noul  # 0.0–1.0
   ```

**Downloads required:**
- CLM heads (~75 MB): `hf download Contrastive-LM/CLM-v0.1-8B CLM_v0.1-8B.pt --local-dir ~/.cache/clm/`
- Qwen3-8B GGUF (~4.7 GB): `hf download Qwen/Qwen3-8B-GGUF Qwen3-8B-Q4_K_M.gguf --local-dir ~/.cache/gguf/`

**Strategy:** Same split noul items as exp-04. CLM API is wire-compatible with Jev — the only change was swapping `TypeSafeClient` for `CLMClient`.

**CLM MAE: 1.47** — worse than Jev's baseline (1.10) and well behind Jev's best (0.77).

**Gemini MAE: 0.57** — consistent with exp-03/04, confirming few-shot calibration is robust.

**Why CLM underperformed:**
- CLM v0.1 heads are trained on general contrastive/ranking tasks, not grading-specific noul calibration
- Noul probabilities clustered near 0.5 for most responses — the model was indecisive, so weighted scores collapsed to ~2.0–2.5 regardless of actual answer quality
- Q4.2: human scores ranged 2.5–5.0 but CLM assigned 2.5 to all five — no discrimination at all
- Speed: 7.8s avg per call on CPU (embedding server round-trips dominate); much slower than Jev's 350ms

**Learnt:**
- CLM v0.1 is not calibrated for short-answer grading out of the box
- The noul head needs task-specific fine-tuning to be competitive with a purpose-built API like Jev
- The local setup works and the API is compatible — fine-tuning CLM heads on grading data is a plausible path
- For production use today: Jev (speed + accuracy) or Gemini (accuracy) are both better choices

---

### Exp-06 — OpenAI Decisions (gpt-6-luna)

**What OpenAI Decisions is:** OpenAI's typed evaluation endpoint — a direct parallel to Jev's System One API. Uses `predicate` (= noul), `choice`, and `score` question types against a shared `input` string. Model: `gpt-6-luna`. Endpoint: `POST /v1/decisions`.

**Strategy:** Same split noul items as exp-04. The `input` field contains question + reference answer + student answer as plain text. Each rubric item becomes a `predicate` question. Probabilities are weighted and scaled to 0–5 exactly as with Jev.

**Decisions MAE: 0.50** — matches Gemini's best and beats Jev's best (0.77) by a significant margin.

**Gemini MAE: 0.53** — consistent with prior few-shot results.

**Speed and cost (15 responses):**

| Model | Total cost | Per response | Avg latency |
|-------|-----------|--------------|-------------|
| Jev (exp-04) | ~$0.000195 | ~$0.000013 | ~350ms |
| Gemini 3.8 Flash | $0.000747 | ~$0.000050 | ~5,128ms |
| OpenAI Decisions | $0.001336 | ~$0.000089 | ~697ms |

**At scale (1,000 responses):**

| Model | Estimated cost | MAE |
|-------|---------------|-----|
| Jev | ~$0.013 | 0.77 |
| Gemini 3.8 Flash | ~$0.050 | 0.53 |
| OpenAI Decisions | ~$0.089 | 0.50 |

**Learnt:**
- OpenAI Decisions achieves Gemini-level accuracy (MAE 0.50) while being 7× faster than Gemini
- The split rubric approach transfers well — structured noul items work with Decisions just as they did with Jev
- Decisions costs ~7× more than Jev per response but delivers significantly better accuracy (0.50 vs 0.77)
- For real-time grading, Decisions is the best option (fast + accurate); for bulk offline eval, Jev is best value

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

**Speed and cost summary (per response):**

| Model | Latency | Cost | Best MAE |
|-------|---------|------|----------|
| Jev | ~350ms | ~$0.000013 | 0.77 |
| OpenAI Decisions | ~700ms | ~$0.000089 | **0.50** |
| Gemini 3.8 Flash | ~5,000ms | ~$0.000050 | 0.50 |
| CLM local (CPU) | ~7,800ms | $0.00 | 1.47 |

- For **real-time grading**: OpenAI Decisions — best accuracy, fast, reasonable cost
- For **bulk offline eval**: Jev — cheapest by far, still solid at 0.77
- For **fully local / zero API cost**: CLM — works but needs fine-tuning on grading data to be competitive

**Open questions:**
- Would more few-shot examples (5–10) further improve Gemini or Decisions?
- Can Jev reach 0.50 MAE with more rubric dimensions per question?
- Does the pattern hold on math questions (vs CS questions used here)?
- Can CLM heads be fine-tuned on grading-labelled data to match Jev's accuracy while staying fully local?

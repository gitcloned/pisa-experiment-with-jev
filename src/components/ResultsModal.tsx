"use client";

import { useState } from "react";
import type { Question, EvaluationResponse } from "@/types";

interface Props {
  question: Question;
  results: EvaluationResponse;
  onNext: () => void;
  isLast: boolean;
}

const RATING_COLOR: Record<string, string> = {
  proficient: "bg-green-100 text-green-700 border-green-200",
  learning: "bg-yellow-100 text-yellow-700 border-yellow-200",
  need_attention: "bg-red-100 text-red-700 border-red-200",
};

function RatingBadge({ rating }: { rating?: string }) {
  if (!rating) return <span className="text-xs text-gray-300">—</span>;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${RATING_COLOR[rating] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
      {rating.replace(/_/g, " ")}
    </span>
  );
}

function ProbabilityDot({ probability, earned }: { probability: number; earned: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`font-semibold text-xs ${earned ? "text-green-600" : "text-red-400"}`}>
        {earned ? "✓" : "✗"}
      </span>
      <span className="text-xs text-gray-400">{Math.round(probability * 100)}%</span>
    </div>
  );
}

export default function ResultsModal({ question, results, onNext, isLast }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  const jev = results.jev;
  const gemini = results.gemini;
  const maxLatency = Math.max(jev.latencyMs, gemini.latencyMs);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white w-full md:max-w-xl md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-1">Results</p>
            <p className="text-sm font-semibold text-gray-800 line-clamp-2">{question.stem}</p>
          </div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              showRaw
                ? "bg-gray-800 text-white border-gray-800"
                : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            {showRaw ? "Hide raw" : "Raw ↗"}
          </button>
        </div>

        <div className="overflow-y-auto flex-1">

          {showRaw ? (
            /* ── Raw response view ── */
            <div className="p-5 flex flex-col gap-4">
              {(["jev", "gemini"] as const).map((model) => {
                const r = results[model];
                return (
                  <div key={model}>
                    <p className={`text-xs font-bold tracking-wider mb-2 ${model === "jev" ? "text-purple-600" : "text-teal-600"}`}>
                      {model.toUpperCase()} — {r.raw?.model}
                    </p>
                    <div className="mb-2">
                      <p className="text-xs text-gray-400 font-medium mb-1">INPUT</p>
                      <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                        {JSON.stringify(r.raw?.input, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-1">OUTPUT</p>
                      <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto text-gray-700 leading-relaxed whitespace-pre-wrap break-words">
                        {JSON.stringify(r.raw?.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Results view ── */
            <div className="p-5 flex flex-col gap-4">

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_80px_80px] gap-2 items-center">
                <span className="text-xs text-gray-400 font-medium">Rubric criterion</span>
                <span className="text-xs font-bold text-purple-600 text-center">JEV</span>
                <span className="text-xs font-bold text-teal-600 text-center">GEMINI</span>
              </div>

              {/* Per-rubric rows */}
              <div className="flex flex-col gap-2">
                {question.rubric.map((item, i) => {
                  const jevR = jev.rubricBreakdown?.[i];
                  const gemR = gemini.rubricBreakdown?.[i];
                  return (
                    <div key={i} className="grid grid-cols-[1fr_80px_80px] gap-2 items-center bg-gray-50 rounded-xl px-3 py-2.5">
                      <div>
                        <p className="text-xs text-gray-700 leading-snug">{item.description}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.score} pt</p>
                      </div>
                      <div className="flex justify-center">
                        {jevR ? (
                          <ProbabilityDot probability={jevR.probability} earned={jevR.earned} />
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        {gemR ? (
                          <ProbabilityDot probability={gemR.probability} earned={gemR.earned} />
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Total score row */}
              <div className="grid grid-cols-[1fr_80px_80px] gap-2 items-center border-t border-gray-100 pt-3">
                <span className="text-xs font-semibold text-gray-700">Total score</span>
                <div className="flex justify-center">
                  <span className={`text-sm font-bold ${jev.error ? "text-gray-300" : "text-purple-600"}`}>
                    {jev.error ? "—" : `${jev.score}/${jev.maxScore}`}
                  </span>
                </div>
                <div className="flex justify-center">
                  <span className={`text-sm font-bold ${gemini.error ? "text-gray-300" : "text-teal-600"}`}>
                    {gemini.error ? "—" : `${gemini.score}/${gemini.maxScore}`}
                  </span>
                </div>
              </div>

              {/* Rating row */}
              <div className="grid grid-cols-[1fr_80px_80px] gap-2 items-center">
                <span className="text-xs font-semibold text-gray-700">Rating</span>
                <div className="flex justify-center">
                  <RatingBadge rating={jev.error ? undefined : jev.rating} />
                </div>
                <div className="flex justify-center">
                  <RatingBadge rating={gemini.error ? undefined : gemini.rating} />
                </div>
              </div>

              {/* Speed */}
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-gray-400 mb-2">Speed</p>
                {(["jev", "gemini"] as const).map((model) => {
                  const r = results[model];
                  return (
                    <div key={model} className="flex items-center gap-2 mb-1.5 last:mb-0">
                      <span className={`text-xs font-medium w-14 ${model === "jev" ? "text-purple-600" : "text-teal-600"}`}>
                        {model.toUpperCase()}
                      </span>
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${model === "jev" ? "bg-purple-400" : "bg-teal-400"}`}
                          style={{ width: `${maxLatency ? Math.min(100, (r.latencyMs / maxLatency) * 100) : 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-14 text-right">{r.latencyMs}ms</span>
                    </div>
                  );
                })}
              </div>

              {/* Cost */}
              {(jev.cost || gemini.cost) && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-400 mb-2">Cost</p>
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-xs text-gray-500 mb-1.5">
                    <span>Input tokens</span>
                    <span className="text-center text-purple-600 font-medium">{jev.cost?.tokens.inputTokens ?? "—"}</span>
                    <span className="text-center text-teal-600 font-medium">{gemini.cost?.tokens.inputTokens ?? "—"}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-xs text-gray-500 mb-1.5">
                    <span>Output tokens</span>
                    <span className="text-center text-purple-600 font-medium">{jev.cost?.tokens.outputTokens ?? "—"} (free)</span>
                    <span className="text-center text-teal-600 font-medium">{gemini.cost?.tokens.outputTokens ?? "—"}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-xs text-gray-500 mb-1.5">
                    <span>Eval cost</span>
                    <span className="text-center text-purple-600 font-medium">{jev.cost ? `$${jev.cost.costUsd.toFixed(7)}` : "—"}</span>
                    <span className="text-center text-teal-600 font-medium">{gemini.cost ? `$${gemini.cost.costUsd.toFixed(7)}` : "—"}</span>
                  </div>
                  {jev.ocrCost && (
                    <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-xs text-gray-500 mb-1.5">
                      <span>OCR (Flash Lite)</span>
                      <span className="text-center text-purple-600 font-medium">${jev.ocrCost.costUsd.toFixed(7)}</span>
                      <span className="text-center text-gray-300">—</span>
                    </div>
                  )}
                  <div className="grid grid-cols-[1fr_80px_80px] gap-2 text-xs border-t border-gray-200 pt-2 mt-1">
                    <span className="font-semibold text-gray-700">Total cost</span>
                    <span className="text-center text-purple-700 font-bold">
                      {jev.cost ? `$${((jev.cost.costUsd) + (jev.ocrCost?.costUsd ?? 0)).toFixed(7)}` : "—"}
                    </span>
                    <span className="text-center text-teal-700 font-bold">{gemini.cost ? `$${gemini.cost.costUsd.toFixed(7)}` : "—"}</span>
                  </div>
                  {(jev.cost?.note || gemini.cost?.note) && (
                    <div className="border-t border-gray-200 pt-2 mt-2 flex flex-col gap-1">
                      {jev.cost?.note && <p className="text-xs text-purple-500">Jev: {jev.cost.note}</p>}
                      {gemini.cost?.note && <p className="text-xs text-teal-500">Gemini: {gemini.cost.note}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Correct answer */}
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs font-semibold text-green-700 mb-1">Correct answer</p>
                <p className="text-sm text-gray-700">{question.correctAnswer}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 pt-0 border-t border-gray-100">
          <button
            onClick={onNext}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-semibold text-sm transition-colors"
          >
            {isLast ? "Done" : "Next Question →"}
          </button>
        </div>
      </div>
    </div>
  );
}

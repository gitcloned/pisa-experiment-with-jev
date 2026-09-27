"use client";

import type { Question, EvaluationResponse } from "@/types";

interface Props {
  question: Question;
  results: EvaluationResponse;
  onNext: () => void;
  isLast: boolean;
}

function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const color = pct >= 100 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 shrink-0">
        {score}/{maxScore}
      </span>
    </div>
  );
}

function EvalCard({
  label,
  color,
  result,
}: {
  label: string;
  color: string;
  result: { score: number; maxScore: number; reasoning: string; latencyMs: number; error?: boolean };
}) {
  return (
    <div className="flex-1 bg-gray-50 rounded-xl p-4 flex flex-col gap-2">
      <div className={`text-xs font-bold tracking-wider ${color}`}>{label}</div>
      {result.error ? (
        <p className="text-xs text-gray-400 italic">Not configured — add API key to .env.local</p>
      ) : (
        <>
          <ScoreBar score={result.score} maxScore={result.maxScore} />
          <p className="text-xs text-gray-600 leading-relaxed">{result.reasoning}</p>
          <p className="text-xs text-gray-400 mt-auto pt-1">
            Latency: <span className="font-semibold text-gray-600">{result.latencyMs}ms</span>
          </p>
        </>
      )}
    </div>
  );
}

export default function ResultsModal({ question, results, onNext, isLast }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Results</p>
          <p className="text-sm font-semibold text-gray-800 line-clamp-2">{question.stem}</p>
        </div>

        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Model comparison */}
          <div className="flex gap-3">
            <EvalCard label="JEV" color="text-purple-600" result={results.jev} />
            <EvalCard label="GEMINI" color="text-teal-600" result={results.gemini} />
          </div>

          {/* Speed comparison */}
          {!results.jev.error && !results.gemini.error && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs font-semibold text-gray-500 mb-2">Speed comparison</p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium text-purple-600">Jev</span>
                    <span>{results.jev.latencyMs}ms</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-400 rounded-full"
                      style={{
                        width: `${Math.min(100, (results.jev.latencyMs / Math.max(results.jev.latencyMs, results.gemini.latencyMs)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium text-teal-600">Gemini</span>
                    <span>{results.gemini.latencyMs}ms</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-400 rounded-full"
                      style={{
                        width: `${Math.min(100, (results.gemini.latencyMs / Math.max(results.jev.latencyMs, results.gemini.latencyMs)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Correct answer reveal */}
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-green-700 mb-1">Correct answer</p>
            <p className="text-sm text-gray-700">{question.correctAnswer}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-0">
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

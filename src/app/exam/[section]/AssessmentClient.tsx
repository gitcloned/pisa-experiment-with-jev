"use client";

import { useState, useRef, useEffect } from "react";
import type { Section, Question, EvaluationResponse } from "@/types";
import StimulusPanel from "@/components/StimulusPanel";
import QuestionPanel from "@/components/QuestionPanel";
import AnswerModal from "@/components/AnswerModal";
import ResultsModal from "@/components/ResultsModal";

type View = "stimulus" | "question";

interface Props {
  section: Section;
  questions: Question[];
}

export default function AssessmentClient({ section, questions }: Props) {
  const [view, setView] = useState<View>("stimulus");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerModalOpen, setAnswerModalOpen] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [results, setResults] = useState<EvaluationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [stimulusOpen, setStimulusOpen] = useState(false); // mobile re-open
  const questionStartRef = useRef<number>(Date.now());

  // Reset timer whenever the question changes
  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [currentIdx]);

  const question = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;

  async function handleSubmit(answerText: string, answerImage?: string) {
    const timeSolveSec = Math.round((Date.now() - questionStartRef.current) / 1000);
    setLoading(true);
    setAnswerModalOpen(false);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: section.id,
          questionId: question.id,
          answerText,
          answerImage,
          timeSolveSec,
        }),
      });
      const data = await res.json();
      setResults(data);
      setResultsModalOpen(true);
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    setResultsModalOpen(false);
    setResults(null);
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
    }
  }

  // ── Desktop: always show split layout ──────────────────────────────────
  // ── Mobile: show stimulus first, then question ─────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop split layout */}
      <div className="hidden md:flex h-screen">
        {/* Left: Stimulus (fixed) */}
        <div className="w-1/2 bg-white border-r border-gray-200 overflow-y-auto">
          <StimulusPanel section={section} />
        </div>
        {/* Right: Question */}
        <div className="w-1/2 flex flex-col">
          <QuestionPanel
            question={question}
            currentIdx={currentIdx}
            total={questions.length}
            loading={loading}
            onAnswer={() => setAnswerModalOpen(true)}
          />
        </div>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden h-dvh flex flex-col overflow-hidden">
        {view === "stimulus" ? (
          <>
            <div className="flex-1 overflow-y-auto">
              <StimulusPanel section={section} />
            </div>
            <div className="shrink-0 p-4 bg-white border-t border-gray-200">
              <button
                onClick={() => setView("question")}
                className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold text-base"
              >
                Start Questions →
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Stimulus re-open drawer */}
            {stimulusOpen && (
              <div className="shrink-0 bg-white border-b border-gray-200 p-4 max-h-64 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-gray-700">Stimulus</span>
                  <button onClick={() => setStimulusOpen(false)} className="text-gray-400 text-lg">✕</button>
                </div>
                <StimulusPanel section={section} compact />
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Progress header */}
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs text-gray-400 font-medium">
                  Question {currentIdx + 1} of {questions.length}
                </span>
                <div className="flex gap-1.5">
                  {Array.from({ length: questions.length }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 w-5 rounded-full transition-colors ${
                        i === currentIdx ? "bg-blue-600" : i < currentIdx ? "bg-blue-300" : "bg-gray-200"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={() => setStimulusOpen((v) => !v)}
                className="mb-4 inline-flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 bg-blue-50 rounded-full px-3 py-1 font-medium"
              >
                <span>📖</span> Read stimulus
              </button>
              <p className="text-base font-semibold text-gray-900 leading-relaxed">
                {question.stem}
              </p>
            </div>
            <div className="shrink-0 p-4 bg-white border-t border-gray-100">
              <button
                onClick={() => setAnswerModalOpen(true)}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl py-3.5 font-semibold text-base transition-colors"
              >
                {loading ? "Evaluating…" : "Answer"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {answerModalOpen && (
        <AnswerModal
          question={question}
          onSubmit={handleSubmit}
          onClose={() => setAnswerModalOpen(false)}
        />
      )}

      {resultsModalOpen && results && (
        <ResultsModal
          question={question}
          results={results}
          onNext={handleNext}
          isLast={isLast}
        />
      )}
    </div>
  );
}

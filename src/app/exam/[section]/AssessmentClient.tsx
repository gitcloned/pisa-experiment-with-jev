"use client";

import { useState } from "react";
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

  const question = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;

  async function handleSubmit(answerText: string, answerImage?: string) {
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
      <div className="md:hidden min-h-screen flex flex-col">
        {view === "stimulus" ? (
          <div className="flex flex-col flex-1">
            <StimulusPanel section={section} />
            <div className="p-4 bg-white border-t border-gray-200">
              <button
                onClick={() => setView("question")}
                className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold text-base"
              >
                Start Questions →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            {/* Stimulus re-open drawer */}
            {stimulusOpen && (
              <div className="bg-white border-b border-gray-200 p-4 max-h-64 overflow-y-auto">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold text-gray-700">Stimulus</span>
                  <button onClick={() => setStimulusOpen(false)} className="text-gray-400 text-lg">✕</button>
                </div>
                <StimulusPanel section={section} compact />
              </div>
            )}
            <QuestionPanel
              question={question}
              currentIdx={currentIdx}
              total={questions.length}
              loading={loading}
              onAnswer={() => setAnswerModalOpen(true)}
              onReadStimulus={() => setStimulusOpen((v) => !v)}
            />
          </div>
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

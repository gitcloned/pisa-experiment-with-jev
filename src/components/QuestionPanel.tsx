import type { Question } from "@/types";

interface Props {
  question: Question;
  currentIdx: number;
  total: number;
  loading: boolean;
  onAnswer: () => void;
  onReadStimulus?: () => void;
}

export default function QuestionPanel({
  question,
  currentIdx,
  total,
  loading,
  onAnswer,
  onReadStimulus,
}: Props) {
  return (
    <div className="flex flex-col justify-between flex-1 p-6 md:p-8">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <span className="text-xs text-gray-400 font-medium">
            Question {currentIdx + 1} of {total}
          </span>
          <div className="flex gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div
                key={i}
                className={`h-1 w-5 rounded-full transition-colors ${
                  i === currentIdx ? "bg-blue-600" : i < currentIdx ? "bg-blue-300" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Stimulus re-open pill — mobile only */}
        {onReadStimulus && (
          <button
            onClick={onReadStimulus}
            className="mb-4 inline-flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 bg-blue-50 rounded-full px-3 py-1 font-medium"
          >
            <span>📖</span> Read stimulus
          </button>
        )}

        <p className="text-base md:text-lg font-semibold text-gray-900 leading-relaxed">
          {question.stem}
        </p>
      </div>

      {/* Answer CTA */}
      <div className="mt-8">
        <button
          onClick={onAnswer}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl py-3.5 font-semibold text-base transition-colors"
        >
          {loading ? "Evaluating…" : "Answer"}
        </button>
      </div>
    </div>
  );
}

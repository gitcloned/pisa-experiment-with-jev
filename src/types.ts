export interface RubricItem {
  score: number;
  description: string;
}

export interface RatingLevel {
  level: string;
  description: string;
}

export interface Question {
  id: number;
  stem: string;
  correctAnswer: string;
  avg_time_to_solve_sec: number;
  steps: string[];
  rubric: RubricItem[];
  rating: RatingLevel[];
  maxScore: number;
}

export interface Section {
  id: string;
  title: string;
  description: string;
  imageFile?: string;
  imageAlt?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostBreakdown {
  tokens: TokenUsage;
  costUsd: number;
  note?: string; // e.g. "includes OCR step"
}

export interface EvalResult {
  score: number;
  maxScore: number;
  rubricBreakdown?: { description: string; earned: boolean; probability: number }[];
  rating?: string;
  reasoning: string;
  latencyMs: number;
  cost?: CostBreakdown;
  ocrCost?: CostBreakdown; // set when image was OCR'd before Jev eval
  ocrLatencyMs?: number;  // OCR step latency (included in latencyMs total)
  error?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: Record<string, any>;
}

export interface EvaluationResponse {
  jev: EvalResult;
  gemini: EvalResult;
}

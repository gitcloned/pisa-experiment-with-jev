export interface RubricTier {
  score: number;
  description: string;
}

export interface Question {
  id: number;
  stem: string;
  correctAnswer: string;
  steps: string[];
  rubric: {
    full: RubricTier;
    partial?: RubricTier;
    none: RubricTier;
  };
  maxScore: number;
}

export interface Section {
  id: string;
  title: string;
  description: string;
  imageFile?: string;
  imageAlt?: string;
}

export interface EvalResult {
  score: number;
  maxScore: number;
  reasoning: string;
  latencyMs: number;
  error?: boolean;
}

export interface EvaluationResponse {
  jev: EvalResult;
  gemini: EvalResult;
  extractedText?: string;
}

export type EvaluationScoreValue = 1 | 2 | 3 | 4 | 5;

export type AiGenerationEvaluation = {
  promptMatch: EvaluationScoreValue;
  subjectMatch: EvaluationScoreValue;
  sceneMatch: EvaluationScoreValue;
  styleMatch: EvaluationScoreValue;
  qualityMatch: EvaluationScoreValue;
  comment: string;
  evaluatedAt: string;
  reviewSource: "ai";
  reviewModel: string | null;
};

export type GenerationReviewRequest = {
  imageDataUrl: string;
  effectivePrompt: string;
  userPrompt: string;
  references: Array<{
    role: string | null;
    label: string | null;
    strength: number | null;
    strengthBand: string | null;
    dataUrl: string;
  }>;
};

export async function requestGenerationEvaluation(input: GenerationReviewRequest): Promise<AiGenerationEvaluation> {
  const response = await fetch("/api/evaluations/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Generation evaluation failed.");
  }
  return data.evaluation as AiGenerationEvaluation;
}

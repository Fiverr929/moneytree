export type ReviewScore = 1 | 2 | 3 | 4 | 5;

export type GenerationAgentReview = {
  promptMatch: ReviewScore;
  subjectMatch: ReviewScore;
  sceneMatch: ReviewScore;
  styleMatch: ReviewScore;
  qualityMatch: ReviewScore;
  summary: string;
  issues: string[];
  suggestions: string[];
  reviewedAt: string;
  model: string | null;
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

export async function requestGenerationReview(input: GenerationReviewRequest): Promise<GenerationAgentReview> {
  const response = await fetch("/api/evaluations/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Generation review failed.");
  }
  return data.review as GenerationAgentReview;
}

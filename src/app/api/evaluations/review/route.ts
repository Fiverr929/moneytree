import { NextResponse } from "next/server";
import { GENERATION_SAFETY_SETTINGS, type Part } from "@/lib/pipeline/genai-client";
import type { AiGenerationEvaluation, EvaluationScoreValue } from "@/lib/evaluationReview";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { MODEL_REGISTRY } from "@/lib/modelRegistry";

export const runtime = "nodejs";
export const maxDuration = 90;

const DEFAULT_REVIEW_MODEL = MODEL_REGISTRY.generationReview;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCES = 4;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ReviewReference = {
  role: string | null;
  label: string | null;
  strength: number | null;
  strengthBand: string | null;
  dataUrl: string;
};

type ReviewRequest = {
  imageDataUrl: string;
  effectivePrompt: string;
  userPrompt: string;
  references: ReviewReference[];
};

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error("Images must be JPEG, PNG, or WebP.");
  const data = match[2];
  if (Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES) {
    throw new Error("Each image must be 10 MB or smaller.");
  }
  return { mimeType, data };
}

function validReference(reference: unknown): ReviewReference | null {
  if (!reference || typeof reference !== "object") return null;
  const candidate = reference as Partial<ReviewReference>;
  if (typeof candidate.dataUrl !== "string") return null;
  try {
    parseDataUrl(candidate.dataUrl);
  } catch {
    return null;
  }
  return {
    role: typeof candidate.role === "string" ? candidate.role : null,
    label: typeof candidate.label === "string" ? candidate.label : null,
    strength: typeof candidate.strength === "number" ? candidate.strength : null,
    strengthBand: typeof candidate.strengthBand === "string" ? candidate.strengthBand : null,
    dataUrl: candidate.dataUrl,
  };
}

function validateRequest(request: Request, value: unknown): ReviewRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Review requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin review requests are not allowed.");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid review request.");
  const input = value as Partial<ReviewRequest>;
  if (typeof input.imageDataUrl !== "string") throw new Error("Generated image is required.");
  parseDataUrl(input.imageDataUrl);
  return {
    imageDataUrl: input.imageDataUrl,
    effectivePrompt: typeof input.effectivePrompt === "string" ? input.effectivePrompt.slice(0, 4_000) : "",
    userPrompt: typeof input.userPrompt === "string" ? input.userPrompt.slice(0, 2_000) : "",
    references: Array.isArray(input.references)
      ? input.references.map(validReference).filter((reference): reference is ReviewReference => !!reference).slice(0, MAX_REFERENCES)
      : [],
  };
}

function score(value: unknown): EvaluationScoreValue {
  const numeric = Math.round(Number(value));
  if (numeric <= 1) return 1;
  if (numeric === 2) return 2;
  if (numeric === 3) return 3;
  if (numeric === 4) return 4;
  return 5;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 700) : fallback;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim().slice(0, 300))
    .slice(0, 5);
}

function extractResponseText(result: unknown) {
  if (result && typeof result === "object" && "text" in result && typeof result.text === "string") {
    return result.text;
  }
  return (result as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  })?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim() || "";
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Review model did not return JSON.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function normalizeEvaluation(value: Record<string, unknown>, model: string): AiGenerationEvaluation {
  const summary = stringValue(value.summary, "Evaluation completed.");
  const issues = stringArray(value.issues);
  const suggestions = stringArray(value.suggestions);
  const commentParts = [
    summary,
    ...issues.map((issue) => `Issue: ${issue}`),
    ...suggestions.map((suggestion) => `Next: ${suggestion}`),
  ].filter(Boolean);

  return {
    promptMatch: score(value.promptMatch),
    subjectMatch: score(value.subjectMatch),
    sceneMatch: score(value.sceneMatch),
    styleMatch: score(value.styleMatch),
    qualityMatch: score(value.qualityMatch),
    comment: commentParts.join("\n"),
    summary,
    issues,
    suggestions,
    evaluatedAt: new Date().toISOString(),
    reviewSource: "ai",
    reviewModel: model,
  };
}

function buildInstruction(input: ReviewRequest) {
  return [
    "You are CafeHTML Generation Reviewer.",
    "Evaluate the generated image against the user's request, final prompt, and provided reference images.",
    "Be practical: this review is for improving the next generation, not judging art taste.",
    "Score each dimension from 1 to 5, where 5 means strong match and 1 means severe mismatch.",
    "promptMatch: does the result follow the final prompt and user request?",
    "subjectMatch: if subject references exist, does the result keep or transform the subject according to the prompt?",
    "sceneMatch: if scene references exist, does the result use or transform the scene according to the prompt?",
    "styleMatch: if style references exist, does the result reflect the intended visual treatment without unwanted content bleed?",
    "qualityMatch: visual quality, coherence, lighting, composition, artifacts, and polish.",
    "Return JSON only:",
    "{\"promptMatch\":1,\"subjectMatch\":1,\"sceneMatch\":1,\"styleMatch\":1,\"qualityMatch\":1,\"summary\":\"string\",\"issues\":[\"string\"],\"suggestions\":[\"string\"]}",
    "",
    `User request: ${JSON.stringify(input.userPrompt)}`,
    `Final prompt: ${JSON.stringify(input.effectivePrompt)}`,
    `References: ${JSON.stringify(input.references.map((reference, index) => ({
      index: index + 1,
      role: reference.role,
      label: reference.label,
      strength: reference.strength,
      strengthBand: reference.strengthBand,
    })))}`,
  ].join("\n");
}

async function reviewGeneration(input: ReviewRequest) {
  const model = process.env.EVALUATION_REVIEW_MODEL?.trim()
    || process.env.BRIEF_AGENT_MODEL?.trim()
    || DEFAULT_REVIEW_MODEL;

  const parts: Part[] = [{ text: buildInstruction(input) }];
  input.references.forEach((reference, index) => {
    const parsed = parseDataUrl(reference.dataUrl);
    parts.push({ text: `Reference ${index + 1}: ${reference.role || "UNASSIGNED"} / ${reference.label || "UNLABELED"}` });
    parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
  });
  const generated = parseDataUrl(input.imageDataUrl);
  parts.push({ text: "Generated image to evaluate:" });
  parts.push({ inlineData: { mimeType: generated.mimeType, data: generated.data } });

  const ai = createGoogleGenAI();
  const result = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: 0.15,
      responseMimeType: "application/json",
      safetySettings: GENERATION_SAFETY_SETTINGS,
    },
  });
  return normalizeEvaluation(parseJsonObject(extractResponseText(result)), model);
}

export async function POST(request: Request) {
  try {
    const input = validateRequest(request, await request.json());
    const evaluation = await reviewGeneration(input);
    return NextResponse.json({ evaluation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation evaluation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

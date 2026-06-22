import {
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";

export type GenAIRequest = {
  model: string;
  contents: Array<{ role: string; parts: Part[] }>;
  config: GenerateContentConfig;
};

export const GENERATION_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

class VertexGenerationError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "VertexGenerationError";
    this.status = status;
    this.details = details;
  }
}

export function toThinkingLevel(value?: string) {
  const levels: Record<string, ThinkingLevel> = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };
  return value ? levels[value.toLowerCase()] : undefined;
}

export async function sendGenerationRequest(
  request: GenAIRequest,
  timeoutMs = 95_000,
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new VertexGenerationError(
        typeof data.error === "string" ? data.error : `Vertex image generation failed (${response.status}).`,
        response.status,
        data.details,
      );
    }
    return data as GenerateContentResponse;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function findImagePrediction(result: GenerateContentResponse) {
  for (const candidate of result.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData?.data) {
        return {
          mimeType: part.inlineData.mimeType || "image/png",
          bytesBase64Encoded: part.inlineData.data,
        };
      }
    }
  }
  return null;
}

export function describeGenAIError(error: unknown) {
  if (error instanceof VertexGenerationError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }

  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isQuotaError(error: unknown) {
  return error instanceof VertexGenerationError && error.status === 429;
}

export type { GenerateContentConfig, Part };

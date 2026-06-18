import {
  ApiError,
  GoogleGenAI,
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

export function createGenAIClient(apiKey: string) {
  return new GoogleGenAI({
    vertexai: true,
    apiKey,
    apiVersion: "v1",
  });
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
  ai: GoogleGenAI,
  request: GenAIRequest,
  timeoutMs = 90_000,
) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await ai.models.generateContent({
      ...request,
      config: {
        ...request.config,
        abortSignal: controller.signal,
      },
    });
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
  if (error instanceof ApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      details: Object.fromEntries(
        Object.entries(error).filter(([key]) => !["name", "message", "stack"].includes(key)),
      ),
    };
  }

  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isQuotaError(error: unknown) {
  return error instanceof ApiError && error.status === 429;
}

export type { GenerateContentConfig, Part };

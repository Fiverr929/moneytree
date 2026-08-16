import { GoogleGenAI } from "@google/genai";

type GoogleGenAIOptions = {
  enterprise?: boolean;
  apiKey?: string | null;
};

export function createGoogleGenAI(options: GoogleGenAIOptions = {}) {
  const apiKey = options.apiKey?.trim()
    || process.env.GEMINI_API_KEY?.trim()
    || process.env.GOOGLE_API_KEY?.trim();
  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
  if (!project || !location) {
    throw new Error("Google AI is not configured. Set GEMINI_API_KEY, or set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION for Vertex AI.");
  }

  return new GoogleGenAI({
    ...(options.enterprise ? { enterprise: true } : { vertexai: true }),
    project,
    location,
    apiVersion: "v1",
  });
}

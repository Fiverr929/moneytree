import { ApiError, GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import type { GenAIRequest } from "@/lib/pipeline/genai-client";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REQUEST_BYTES = 60 * 1024 * 1024;
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);

function validateRequest(request: Request, value: unknown): GenAIRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Image generation requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin image generation requests are not allowed.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid image generation request.");
  }

  const input = value as Partial<GenAIRequest>;
  if (typeof input.model !== "string" || !ALLOWED_MODELS.has(input.model)) {
    throw new Error("Unsupported image model.");
  }
  if (!Array.isArray(input.contents) || input.contents.length !== 1) {
    throw new Error("Image generation requires one user message.");
  }
  const content = input.contents[0];
  if (content?.role !== "user" || !Array.isArray(content.parts) || !content.parts.length) {
    throw new Error("Image generation requires user content.");
  }
  if (!input.config || typeof input.config !== "object") {
    throw new Error("Image generation config is required.");
  }
  return input as GenAIRequest;
}

function describeError(error: unknown) {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      status: error.status || 500,
      details: Object.fromEntries(
        Object.entries(error).filter(([key]) => !["name", "message", "stack"].includes(key)),
      ),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("default credentials")
    || message.includes("Could not load the default credentials")
    || message.includes("UNAUTHENTICATED")
  ) {
    return {
      message: "Vertex authentication is not configured. Run gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS for the Next.js server.",
      status: 401,
    };
  }
  return { message, status: 500 };
}

export async function POST(request: Request) {
  try {
    const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
    if (!project || !location) {
      return NextResponse.json(
        { error: "Vertex image generation is not configured. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION on the server." },
        { status: 503 },
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Image generation request is too large." }, { status: 413 });
    }

    const input = validateRequest(request, await request.json());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);

    try {
      const ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
        apiVersion: "v1",
      });
      const result = await ai.models.generateContent({
        ...input,
        config: {
          ...input.config,
          abortSignal: controller.signal,
        },
      });
      return NextResponse.json(result);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const described = describeError(error);
    return NextResponse.json(
      { error: described.message, details: described.details },
      { status: described.status },
    );
  }
}
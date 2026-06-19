import {
  GoogleGenAI,
  VideoGenerationReferenceType,
  type GenerateVideosConfig,
  type Image,
} from "@google/genai";
import { NextResponse } from "next/server";
import type { VeoGenerationRequest } from "@/lib/video/api";

export const runtime = "nodejs";
export const maxDuration = 1200;

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_TIME_MS = 20 * 60 * 1000;
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 4_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MODELS = {
  "veo-3.1-generate-001": { supportsReferences: true },
  "veo-3.1-fast-generate-001": { supportsReferences: true },
  "veo-3.1-lite-generate-001": { supportsReferences: false },
} as const;

function toVeoImage(dataUrl: string): Image {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("Video inputs must be JPEG, PNG, or WebP images.");
  }
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error("Each video input image must be 10 MB or smaller.");
  }
  return {
    mimeType,
    imageBytes: match[2],
  };
}

function validateRequest(request: Request, value: unknown): VeoGenerationRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid video generation request.");
  const input = value as Partial<VeoGenerationRequest>;
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Video generation requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin video generation requests are not allowed.");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Video generation request is too large.");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    throw new Error("A video prompt is required.");
  }
  if (input.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Video prompts must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
  }
  if (typeof input.modelId !== "string" || !(input.modelId in VIDEO_MODELS)) {
    throw new Error("Unsupported Veo model.");
  }
  if (typeof input.aspectRatio !== "string" || !["16:9", "9:16"].includes(input.aspectRatio)) {
    throw new Error("Unsupported aspect ratio.");
  }
  if (typeof input.durationSeconds !== "number" || ![4, 6, 8].includes(input.durationSeconds)) {
    throw new Error("Unsupported video duration.");
  }
  if (typeof input.resolution !== "string" || !["720p", "1080p"].includes(input.resolution)) {
    throw new Error("Unsupported resolution.");
  }
  if (input.seed !== undefined && (!Number.isSafeInteger(input.seed) || input.seed < 0)) {
    throw new Error("Seed must be a non-negative integer.");
  }
  if (input.endFrame && !input.startFrame) {
    throw new Error("A start frame is required when an end frame is provided.");
  }
  if (input.referenceImages?.length) {
    const model = VIDEO_MODELS[input.modelId as keyof typeof VIDEO_MODELS];
    if (!model.supportsReferences) throw new Error("The selected Veo model does not support references.");
    if (input.referenceImages.length > 3) throw new Error("Veo supports up to three reference images.");
    if (input.startFrame || input.endFrame) {
      throw new Error("Reference images cannot be combined with start or end frames.");
    }
    if (input.durationSeconds !== 8) throw new Error("Reference-image generation requires 8 seconds.");
  }
  if (input.resolution === "1080p" && input.durationSeconds !== 8) {
    throw new Error("1080p generation requires an 8-second duration.");
  }
  return input as VeoGenerationRequest;
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message.includes("default credentials")
      || error.message.includes("Could not load the default credentials")
      || error.message.includes("UNAUTHENTICATED")
    ) {
      return "Vertex authentication is not configured. Set up Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS for the Next.js server.";
    }
    return error.message;
  }
  return String(error);
}

export async function POST(request: Request) {
  try {
    const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
    if (!project || !location) {
      return NextResponse.json(
        {
          error: "Vertex video generation is not configured. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION on the server.",
        },
        { status: 503 },
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Video generation request is too large." }, { status: 413 });
    }
    const input = validateRequest(request, await request.json());

    const ai = new GoogleGenAI({
      enterprise: true,
      project,
      location,
      apiVersion: "v1",
    });
    const config: GenerateVideosConfig = {
      numberOfVideos: 1,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
      generateAudio: true,
    };

    if (input.seed !== undefined) config.seed = input.seed;
    if (input.endFrame) config.lastFrame = toVeoImage(input.endFrame);
    if (input.referenceImages?.length) {
      config.referenceImages = input.referenceImages.map((dataUrl) => ({
        image: toVeoImage(dataUrl),
        referenceType: VideoGenerationReferenceType.ASSET,
      }));
    }

    let operation = await ai.models.generateVideos({
      model: input.modelId,
      prompt: input.prompt,
      image: input.startFrame ? toVeoImage(input.startFrame) : undefined,
      config,
    });

    const startedAt = Date.now();
    while (!operation.done) {
      if (Date.now() - startedAt > MAX_POLL_TIME_MS) {
        throw new Error("Video generation timed out after 20 minutes.");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(
        typeof operation.error.message === "string"
          ? operation.error.message
          : "Vertex video generation failed.",
      );
    }

    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video?.videoBytes) {
      throw new Error(
        video?.uri
          ? `Vertex returned a storage URI (${video.uri}) instead of inline video bytes.`
          : "Vertex completed without returning a video.",
      );
    }

    return new Response(Buffer.from(video.videoBytes, "base64"), {
      headers: {
        "Content-Type": video.mimeType || "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Veo Vertex] Generation failed:", error);
    const message = describeError(error);
    const isClientError = error instanceof SyntaxError
      || message.includes("required")
      || message.includes("requires")
      || message.includes("Unsupported")
      || message.includes("Invalid")
      || message.includes("must be")
      || message.includes("cannot be")
      || message.includes("does not support")
      || message.includes("too large")
      || message.includes("not allowed");
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
}

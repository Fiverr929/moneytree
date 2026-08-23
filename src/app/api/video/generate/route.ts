import {
  VideoGenerationReferenceType,
  type GenerateVideosConfig,
  type Image,
  type Video,
} from "@google/genai";
import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VeoGenerationRequest } from "@/lib/video/api";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";

export const runtime = "nodejs";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_TIME_MS = 4.5 * 60 * 1000;
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;
const MAX_VERCEL_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 4_000;
const MAX_NEGATIVE_PROMPT_LENGTH = 1_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MODELS = {
  "veo-3.1-generate-preview": {
    api: "veo",
    supportsReferences: true,
    supportsEndFrame: true,
    referencesRequireEightSeconds: true,
    resolutions: ["720p", "1080p", "4k"],
  },
  "veo-3.1-fast-generate-preview": {
    api: "veo",
    supportsReferences: true,
    supportsEndFrame: true,
    referencesRequireEightSeconds: true,
    resolutions: ["720p", "1080p", "4k"],
  },
  "veo-3.1-lite-generate-preview": {
    api: "veo",
    supportsReferences: false,
    supportsEndFrame: true,
    referencesRequireEightSeconds: false,
    resolutions: ["720p", "1080p"],
  },
  "gemini-omni-flash-preview": {
    api: "omni",
    supportsReferences: true,
    supportsEndFrame: false,
    referencesRequireEightSeconds: false,
    resolutions: ["720p"],
  },
} as const;

function isVercelDownloadProxyDisabled() {
  return process.env.VERCEL === "1" && process.env.ENABLE_VERCEL_VIDEO_DOWNLOAD !== "true";
}

function getMaxRequestBytes() {
  return process.env.VERCEL === "1" ? MAX_VERCEL_REQUEST_BYTES : MAX_REQUEST_BYTES;
}

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
  if (contentLength > getMaxRequestBytes()) {
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
  if (typeof input.resolution !== "string" || !["720p", "1080p", "4k"].includes(input.resolution)) {
    throw new Error("Unsupported resolution.");
  }
  if (input.seed !== undefined && (!Number.isSafeInteger(input.seed) || input.seed < 0)) {
    throw new Error("Seed must be a non-negative integer.");
  }
  if (input.endFrame && !input.startFrame) {
    throw new Error("A start frame is required when an end frame is provided.");
  }
  const model = VIDEO_MODELS[input.modelId as keyof typeof VIDEO_MODELS];
  if (!(model.resolutions as readonly string[]).includes(input.resolution)) {
    throw new Error("The selected video model does not support this resolution.");
  }
  if (input.negativePrompt !== undefined && (typeof input.negativePrompt !== "string" || input.negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH)) {
    throw new Error(`Negative prompts must be ${MAX_NEGATIVE_PROMPT_LENGTH} characters or fewer.`);
  }
  if (input.motionProfile !== undefined && !["subtle", "natural", "dynamic"].includes(input.motionProfile)) {
    throw new Error("Unsupported motion profile.");
  }
  if (input.cameraMotion !== undefined && !["auto", "locked", "push-in", "pull-out", "pan-left", "pan-right", "orbit", "tracking"].includes(input.cameraMotion)) {
    throw new Error("Unsupported camera motion.");
  }
  if (input.enhancePrompt !== undefined && typeof input.enhancePrompt !== "boolean") {
    throw new Error("Invalid prompt enhancement setting.");
  }
  if (input.endFrame && !model.supportsEndFrame) {
    throw new Error("The selected video model does not support an end frame.");
  }
  if (input.referenceImages?.length) {
    if (!model.supportsReferences) throw new Error("The selected Veo model does not support references.");
    const maxReferences = model.api === "omni" ? 6 : 3;
    if (input.referenceImages.length > maxReferences) {
      throw new Error(`The selected video model supports up to ${maxReferences} reference images.`);
    }
    if (input.startFrame || input.endFrame) {
      throw new Error("Reference images cannot be combined with start or end frames.");
    }
    if (model.referencesRequireEightSeconds && input.durationSeconds !== 8) {
      throw new Error("Reference-image generation requires 8 seconds with the selected Veo model.");
    }
  }
  if (model.api === "omni" && input.seed !== undefined) {
    throw new Error("Gemini Omni Flash does not support the seed setting.");
  }
  if (["1080p", "4k"].includes(input.resolution) && input.durationSeconds !== 8) {
    throw new Error("1080p and 4K generation require an 8-second duration.");
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
      return "Google AI Studio authentication is not configured. Set GEMINI_API_KEY as a server secret.";
    }
    return error.message;
  }
  return String(error);
}

function summarizeVideoOperation(operation: unknown) {
  const value = operation as {
    name?: string;
    done?: boolean;
    response?: { generatedVideos?: Array<{ video?: Video }> };
  };
  return {
    name: value.name,
    done: value.done,
    generatedVideoCount: value.response?.generatedVideos?.length || 0,
    firstVideo: value.response?.generatedVideos?.[0]?.video
      ? {
        hasVideoBytes: !!value.response.generatedVideos[0].video?.videoBytes,
        hasUri: !!value.response.generatedVideos[0].video?.uri,
        mimeType: value.response.generatedVideos[0].video?.mimeType,
        uriPrefix: value.response.generatedVideos[0].video?.uri?.slice(0, 48),
      }
      : null,
  };
}

async function downloadGeneratedVideo(ai: ReturnType<typeof createGoogleGenAI>, video: Video) {
  if (!video.uri) return null;

  const dir = await mkdtemp(join(tmpdir(), "cafehtml-veo-"));
  const filePath = join(dir, "generated-video");
  try {
    await ai.files.download({ file: video, downloadPath: filePath });
    const bytes = await readFile(filePath);
    if (!bytes.byteLength) {
      throw new Error("Downloaded video file was empty.");
    }
    return bytes;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Vertex returned a video URI, but the server could not download it: ${message}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function toOmniImage(dataUrl: string) {
  const image = toVeoImage(dataUrl);
  return {
    type: "image" as const,
    data: image.imageBytes,
    mime_type: image.mimeType as "image/jpeg" | "image/png" | "image/webp",
  };
}

const MOTION_DIRECTIONS = {
  subtle: "Use restrained, fine-grained subject motion with a stable silhouette and minimal deformation.",
  natural: "Use physically plausible, fluid subject motion with coherent timing and stable scene geometry.",
  dynamic: "Use energetic, clearly readable subject motion with strong depth cues while preserving identity and structure.",
} as const;

const CAMERA_DIRECTIONS = {
  auto: "Choose one coherent camera move that best supports the action; avoid unnecessary camera changes.",
  locked: "Use a locked-off tripod shot with no camera translation, zoom, roll, or shake.",
  "push-in": "Use a slow, smooth cinematic dolly push toward the subject.",
  "pull-out": "Use a slow, smooth cinematic dolly pull away from the subject.",
  "pan-left": "Use one smooth, controlled pan to the left.",
  "pan-right": "Use one smooth, controlled pan to the right.",
  orbit: "Use a smooth, controlled partial orbit around the primary subject with believable parallax.",
  tracking: "Track the primary subject smoothly while maintaining consistent framing.",
} as const;

function buildDirectedPrompt(input: VeoGenerationRequest, hasSourceImages: boolean) {
  const directions = [input.prompt.trim()];
  if (input.motionProfile) directions.push(MOTION_DIRECTIONS[input.motionProfile]);
  if (input.cameraMotion) directions.push(CAMERA_DIRECTIONS[input.cameraMotion]);
  if (hasSourceImages && input.enhancePrompt !== false) {
    directions.push("Preserve the source subject's identity, proportions, materials, lighting, and scene continuity across every frame.");
  }
  if (input.enhancePrompt !== false) {
    directions.push("Stage this as one continuous, temporally coherent shot with natural acceleration, clean details, and audio synchronized to visible events.");
  }
  return directions.join(" ");
}

async function generateOmniVideo(
  ai: ReturnType<typeof createGoogleGenAI>,
  input: VeoGenerationRequest,
) {
  const sourceImages = input.referenceImages?.length
    ? input.referenceImages
    : input.startFrame
      ? [input.startFrame]
      : [];
  const rolePrompt = input.referenceImages?.length
    ? `${sourceImages.map((_, index) => `<IMAGE_REF_${index}>`).join(" ")} Use the supplied images as references.`
    : input.startFrame
      ? "<FIRST_FRAME> Use the supplied image as the starting frame."
      : "";
  const directedPrompt = buildDirectedPrompt(input, sourceImages.length > 0);
  const negativeDirection = input.negativePrompt?.trim()
    ? ` Avoid these visual outcomes: ${input.negativePrompt.trim()}.`
    : "";
  const prompt = `${rolePrompt} ${directedPrompt}${negativeDirection} Create a ${input.durationSeconds}-second video with synchronized audio.`.trim();
  const interaction = await ai.interactions.create({
    model: input.modelId,
    input: sourceImages.length
      ? [
        ...sourceImages.map(toOmniImage),
        { type: "text" as const, text: prompt },
      ]
      : prompt,
    response_format: {
      type: "video",
      aspect_ratio: input.aspectRatio,
    },
    background: false,
    store: false,
    stream: false,
  });

  const video = interaction.output_video;
  if (!video?.data) {
    throw new Error("Gemini Omni Flash completed without returning inline video data.");
  }
  const buffer = Buffer.from(video.data, "base64");
  if (!buffer.byteLength) throw new Error("Gemini Omni Flash returned an empty video.");
  return { buffer, mimeType: video.mime_type || "video/mp4" };
}

export async function POST(request: Request) {
  try {
    if (isVercelDownloadProxyDisabled()) {
      return NextResponse.json(
        {
          error: "Video generation is disabled on Vercel until direct cloud storage downloads are configured. This avoids sending large video files through Vercel's free-tier functions.",
        },
        { status: 503 },
      );
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > getMaxRequestBytes()) {
      return NextResponse.json({ error: "Video generation request is too large." }, { status: 413 });
    }
    const input = validateRequest(request, await request.json());

    const model = VIDEO_MODELS[input.modelId as keyof typeof VIDEO_MODELS];
    const localApiKey = process.env.NODE_ENV === "production"
      ? null
      : request.headers.get("x-cafehtml-local-gemini-key")?.trim();
    const apiKey = localApiKey
      || process.env.GEMINI_API_KEY?.trim()
      || process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Google AI Studio is not configured. Set GEMINI_API_KEY as a server secret.");
    }
    const ai = createGoogleGenAI({ apiKey });

    if (model.api === "omni") {
      const result = await generateOmniVideo(ai, input);
      return new Response(result.buffer, {
        headers: {
          "Content-Type": result.mimeType,
          "Cache-Control": "no-store",
        },
      });
    }

    const config: GenerateVideosConfig = {
      numberOfVideos: 1,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      resolution: input.resolution,
    };

    if (input.negativePrompt?.trim()) config.negativePrompt = input.negativePrompt.trim();
    config.personGeneration = input.startFrame || input.referenceImages?.length ? "allow_adult" : "allow_all";

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
      prompt: buildDirectedPrompt(input, !!input.startFrame || !!input.referenceImages?.length),
      image: input.startFrame ? toVeoImage(input.startFrame) : undefined,
      config,
    });

    const startedAt = Date.now();
    while (!operation.done) {
      if (Date.now() - startedAt > MAX_POLL_TIME_MS) {
        throw new Error("Video generation timed out before the serverless function limit. Use direct cloud storage downloads for production video generation.");
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      operation = await ai.operations.getVideosOperation({ operation });
    }

    if (operation.error) {
      throw new Error(
        typeof operation.error.message === "string"
          ? operation.error.message
          : "Veo video generation failed.",
      );
    }

    const video = operation.response?.generatedVideos?.[0]?.video;
    let videoBuffer = video?.videoBytes ? Buffer.from(video.videoBytes, "base64") : null;

    if (!videoBuffer && video?.uri) {
      videoBuffer = await downloadGeneratedVideo(ai, video);
    }

    if (!videoBuffer?.byteLength) {
      console.error("[Google AI Studio Veo] Completed without video payload:", summarizeVideoOperation(operation));
      throw new Error("Veo completed without returning a downloadable video.");
    }

    return new Response(videoBuffer, {
      headers: {
        "Content-Type": video?.mimeType || "video/mp4",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Google video] Generation failed:", error);
    const message = describeError(error);
    const isAuthError = message.includes("not configured")
      || message.includes("authentication")
      || message.includes("UNAUTHENTICATED");
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
    return NextResponse.json({ error: message }, { status: isAuthError ? 401 : isClientError ? 400 : 500 });
  }
}

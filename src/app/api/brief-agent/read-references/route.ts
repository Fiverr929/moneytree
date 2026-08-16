import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { BRIEF_AGENT_SKILL_CONTRACT } from "@/lib/brief-agent/skillContract";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { logCachedModelUsage, logModelUsage, modelUsage, traceReferenceFingerprint, type UsageMetadata } from "@/lib/server/modelUsage";
import { cacheReferenceRead } from "@/lib/server/referenceReadCache";
import type {
  BriefReferenceImageInput,
  BriefReferenceReadRequest,
  BriefReferenceReadResponse,
  BriefReferenceRole,
  ReferenceObservation,
} from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const DEFAULT_REFERENCE_READER_MODEL = "gemini-3.1-flash-lite";
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid reference image data.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error("Reference images must be JPEG, PNG, or WebP.");
  const data = match[2];
  if (Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES) {
    throw new Error("Each reference image must be 10 MB or smaller.");
  }
  return { mimeType, data };
}

function normalizeRole(value: unknown): BriefReferenceRole {
  const role = String(value || "").toUpperCase();
  if (role === "SUBJECT" || role === "SCENE" || role === "STYLE") return role;
  return "UNASSIGNED";
}

function validateRequest(request: Request, value: unknown): BriefReferenceReadRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Reference reader requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin reference reader requests are not allowed.");
  }
  if (!value || typeof value !== "object") throw new Error("Invalid reference reader request.");

  const input = value as Partial<BriefReferenceReadRequest>;
  if (typeof input.sourceFingerprint !== "string") throw new Error("Reference fingerprint is required.");
  if (!Array.isArray(input.images)) throw new Error("Reference images are required.");

  return {
    sourceFingerprint: input.sourceFingerprint,
    images: input.images.slice(0, MAX_IMAGES).map((image) => {
      if (!image || typeof image !== "object") throw new Error("Invalid reference image.");
      const candidate = image as Partial<BriefReferenceImageInput>;
      if (typeof candidate.imageId !== "string" || typeof candidate.label !== "string" || typeof candidate.dataUrl !== "string") {
        throw new Error("Invalid reference image.");
      }
      parseDataUrl(candidate.dataUrl);
      return {
        imageId: candidate.imageId,
        role: normalizeRole(candidate.role),
        label: candidate.label,
        strength: typeof candidate.strength === "number" ? candidate.strength : 0,
        dataUrl: candidate.dataUrl,
      };
    }),
  };
}

function defaultObservation(image: BriefReferenceImageInput): ReferenceObservation {
  return {
    imageId: image.imageId,
    role: image.role,
    label: image.label,
    strength: image.strength,
    visualRead: "",
    readSource: "local",
  };
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 1200) : fallback;
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
    if (!match) throw new Error("Reference reader did not return JSON.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function mergeObservation(image: BriefReferenceImageInput, value: unknown): ReferenceObservation {
  const fallback = defaultObservation(image);
  if (!value || typeof value !== "object") return fallback;
  const observation = value as Partial<ReferenceObservation>;
  return {
    ...fallback,
    visualRead: stringValue(observation.visualRead, fallback.visualRead),
    readSource: "vision",
  };
}

function buildInstruction(images: BriefReferenceImageInput[]) {
  return [
    "Inspect each reference image for CafeHTML's modular image generation agent.",
    "Return a neutral prose visual read only. Do not decide what to preserve, what can change, or how strong the reference should be used.",
    `Skill contract: ${JSON.stringify(BRIEF_AGENT_SKILL_CONTRACT)}`,
    "Write 2-5 concrete sentences about what is visibly present: subject/object appearance, shape, material, markings, pose/orientation, readable text, background, lighting, camera/framing, color, texture, and style.",
    "Mention uncertainty inside the prose when something is unclear, occluded, unreadable, or inferred.",
    "Avoid generic phrases like identity/type, distinctive details, use as source, preserve closely, must preserve, or can change.",
    "Return JSON only:",
    "{\"observations\":[{\"imageId\":\"string\",\"visualRead\":\"string\"}]}",
    `Image metadata: ${JSON.stringify(images.map((image) => ({
      imageId: image.imageId,
      role: image.role,
      label: image.label,
      strength: image.strength,
    })))}`,
  ].join("\n");
}

function describeReaderError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Reference reader failed.";
  const normalized = raw.toLowerCase();
  if (normalized.includes("billing_disabled") || normalized.includes("billing to be enabled") || normalized.includes("billing is disabled")) {
    return {
      message: "Google Cloud billing is disabled for the configured Vertex AI project. Enable billing, or on localhost add a Gemini API key in Settings.",
      status: 403,
      retryAfterSeconds: null,
    };
  }
  if (
    normalized.includes("resource_exhausted")
    || normalized.includes("resource exhausted")
    || normalized.includes("429")
    || normalized.includes("rate limit")
    || normalized.includes("quota")
  ) {
    return {
      message: "Reference reader is temporarily busy. Existing reference notes will remain active while it retries.",
      status: 429,
      retryAfterSeconds: 8,
    };
  }
  if (normalized.includes("permission_denied") || normalized.includes("permission denied") || normalized.includes("403")) {
    return { message: "Vertex AI denied access to the reference reader. Check project permissions and API enablement.", status: 403, retryAfterSeconds: null };
  }
  if (normalized.includes("unauthenticated") || normalized.includes("credential") || normalized.includes("401")) {
    return { message: "Reference reader authentication is not configured. Add GEMINI_API_KEY as a server secret.", status: 401, retryAfterSeconds: null };
  }
  return { message: raw, status: 400, retryAfterSeconds: null };
}

type ReferenceReadResult = {
  model: string;
  observations: ReferenceObservation[];
  usage: UsageMetadata;
};

function referenceReadCacheKey(input: BriefReferenceReadRequest, model: string) {
  const hash = createHash("sha256");
  hash.update(model);
  hash.update("\0");
  hash.update(input.sourceFingerprint);
  input.images.forEach((image) => {
    hash.update("\0");
    hash.update(image.imageId);
    hash.update("\0");
    hash.update(image.role);
    hash.update("\0");
    hash.update(image.label);
    hash.update("\0");
    hash.update(String(image.strength));
    hash.update("\0");
    hash.update(image.dataUrl);
  });
  return hash.digest("hex");
}

async function readReferences(input: BriefReferenceReadRequest, model: string, localApiKey?: string | null): Promise<ReferenceReadResult> {
  const ai = createGoogleGenAI({ apiKey: localApiKey });
  const parts = [
    { text: buildInstruction(input.images) },
    ...input.images.flatMap((image, index) => {
      const parsed = parseDataUrl(image.dataUrl);
      return [
        { text: `Reference Image ${index + 1}: ${image.role} / ${image.label}` },
        { inlineData: { mimeType: parsed.mimeType, data: parsed.data } },
      ];
    }),
  ];
  const result = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      temperature: 0.15,
      responseMimeType: "application/json",
    },
  });
  const json = parseJsonObject(extractResponseText(result));
  const observationsJson = Array.isArray(json.observations) ? json.observations : [];
  const observations = input.images.map((image) => {
    const found = observationsJson.find((item) => (
      item && typeof item === "object" && (item as { imageId?: unknown }).imageId === image.imageId
    ));
    return mergeObservation(image, found);
  });

  return { model, observations, usage: modelUsage(result) };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const input = validateRequest(request, await request.json());
    const localApiKey = process.env.NODE_ENV === "production"
      ? null
      : request.headers.get("x-cafehtml-local-gemini-key");
    const model = process.env.BRIEF_REFERENCE_MODEL?.trim() || DEFAULT_REFERENCE_READER_MODEL;
    const cacheKey = referenceReadCacheKey(input, model);
    const { value, cache } = await cacheReferenceRead(cacheKey, () => readReferences(input, model, localApiKey));
    const trace = {
      requestId,
      cache,
      referenceFingerprint: traceReferenceFingerprint(input.sourceFingerprint),
      cacheKey: cacheKey.slice(0, 12),
      imageCount: input.images.length,
      durationMs: Date.now() - startedAt,
    };
    if (cache === "miss") {
      logModelUsage("brief-agent.read-references", model, { usageMetadata: value.usage }, trace);
    } else {
      logCachedModelUsage("brief-agent.read-references", model, trace);
    }
    const response: BriefReferenceReadResponse = {
      brain: "vision",
      model: value.model,
      snapshot: {
        id: `ref-vision-${new Date().toISOString()}`,
        createdAt: new Date().toISOString(),
        sourceFingerprint: input.sourceFingerprint,
        observations: value.observations,
      },
    };
    return NextResponse.json(response, { headers: { "X-CafeHTML-Request-Id": requestId } });
  } catch (error) {
    const described = describeReaderError(error);
    return NextResponse.json(
      {
        error: described.message,
        ...(described.retryAfterSeconds ? { retryAfterSeconds: described.retryAfterSeconds } : {}),
      },
      {
        status: described.status,
        headers: {
          "X-CafeHTML-Request-Id": requestId,
          ...(described.retryAfterSeconds ? { "Retry-After": String(described.retryAfterSeconds) } : {}),
        },
      },
    );
  }
}

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { BRIEF_AGENT_SKILL_CONTRACT } from "@/lib/brief-agent/skillContract";
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

async function readReferences(input: BriefReferenceReadRequest) {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
  const model = process.env.BRIEF_REFERENCE_MODEL?.trim()
    || process.env.BRIEF_AGENT_MODEL?.trim()
    || DEFAULT_REFERENCE_READER_MODEL;
  if (!project || !location) throw new Error("Vertex reference reader is not configured.");

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion: "v1",
  });
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

  return { model, observations };
}

export async function POST(request: Request) {
  try {
    const input = validateRequest(request, await request.json());
    const { model, observations } = await readReferences(input);
    const response: BriefReferenceReadResponse = {
      brain: "vision",
      model,
      snapshot: {
        id: `ref-vision-${new Date().toISOString()}`,
        createdAt: new Date().toISOString(),
        sourceFingerprint: input.sourceFingerprint,
        observations,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference reader failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

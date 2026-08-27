import { NextResponse } from "next/server";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { MODEL_REGISTRY } from "@/lib/modelRegistry";
import { SCENE_BUILDER_SKILL } from "@/lib/brief-agent/skills/sceneBuilder";
import type { BriefBoardContext, BriefReferenceRole, BriefReferenceSnapshot, ScenePlan, ScenePlanShot } from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCENE_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "intent", "continuity", "shots"],
  properties: {
    title: { type: "string" },
    intent: { type: "string" },
    continuity: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "world", "style", "progression"],
      properties: {
        subject: { type: "array", items: { type: "string" } },
        world: { type: "array", items: { type: "string" } },
        style: { type: "array", items: { type: "string" } },
        progression: { type: "string" },
      },
    },
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "title", "purpose", "action", "camera", "continuity", "prompt"],
        properties: {
          index: { type: "integer" },
          title: { type: "string" },
          purpose: { type: "string" },
          action: { type: "string" },
          camera: { type: "string" },
          continuity: { type: "array", items: { type: "string" } },
          prompt: { type: "string" },
        },
      },
    },
  },
} as const;

function text(value: unknown, limit = 1_500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function stringList(value: unknown, limit = 12) {
  return Array.isArray(value) ? value.map((item) => text(item, 360)).filter(Boolean).slice(0, limit) : [];
}

function safeReferences(value: unknown): BriefReferenceSnapshot {
  const source = value && typeof value === "object" ? value as Partial<BriefReferenceSnapshot> : {};
  return {
    id: text(source.id, 100) || crypto.randomUUID(),
    createdAt: text(source.createdAt, 100) || new Date().toISOString(),
    sourceFingerprint: text(source.sourceFingerprint, 200),
    observations: Array.isArray(source.observations) ? source.observations.slice(0, 24).map((item) => ({
      imageId: text(item?.imageId, 120),
      role: (item?.role === "SUBJECT" || item?.role === "SCENE" || item?.role === "STYLE" ? item.role : "UNASSIGNED") as BriefReferenceRole,
      label: text(item?.label, 160),
      strength: Math.min(100, Math.max(0, Number(item?.strength) || 0)),
      visualRead: text(item?.visualRead, 700),
      readSource: item?.readSource === "vision" ? "vision" as const : "local" as const,
    })).filter((item) => item.imageId) : [],
  };
}

function safeBoards(value: unknown): BriefBoardContext[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => ({
    id: text(item?.id, 120),
    type: item?.type === "MOOD" || item?.type === "LOOKBOOK" || item?.type === "WORLD" ? item.type : "CUSTOM" as const,
    name: text(item?.name, 160),
    purpose: text(item?.purpose, 500),
    active: item?.active !== false,
    sourceFingerprint: text(item?.sourceFingerprint, 200),
    images: Array.isArray(item?.images) ? item.images.slice(0, 24).map((image: unknown) => {
      const sourceImage = image && typeof image === "object" ? image as Record<string, unknown> : {};
      return {
        imageId: text(sourceImage.imageId, 120),
        label: text(sourceImage.label, 160),
        visualRead: text(sourceImage.visualRead, 700),
      };
    }).filter((image: { imageId: string }) => image.imageId) : [],
  })).filter((item) => item.id && item.active);
}

function parseJson(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function responseText(result: unknown) {
  const candidate = result as { text?: string | (() => string) };
  return typeof candidate.text === "function" ? candidate.text() : candidate.text || "";
}

function normalizeShot(value: unknown, index: number, sourcePrompt: string): ScenePlanShot {
  const shot = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    index,
    title: text(shot.title, 120) || `SHOT ${index}`,
    purpose: text(shot.purpose, 400) || `Advance beat ${index}`,
    action: text(shot.action, 600) || sourcePrompt,
    camera: text(shot.camera, 400) || "Clear cinematic composition",
    continuity: stringList(shot.continuity),
    prompt: text(shot.prompt, 4_000) || `${sourcePrompt}. Shot ${index}.`,
  };
}

function normalizePlan(value: Record<string, unknown>, prompt: string, shotCount: number): ScenePlan {
  const continuity = value.continuity && typeof value.continuity === "object"
    ? value.continuity as Record<string, unknown> : {};
  const rawShots = Array.isArray(value.shots) ? value.shots : [];
  const shots = Array.from({ length: shotCount }, (_, index) => normalizeShot(rawShots[index], index + 1, prompt));
  return {
    id: crypto.randomUUID(),
    title: text(value.title, 160) || "UNTITLED SCENE",
    intent: text(value.intent, 800) || prompt,
    sourcePrompt: prompt,
    shotCount,
    continuity: {
      subject: stringList(continuity.subject),
      world: stringList(continuity.world),
      style: stringList(continuity.style),
      progression: text(continuity.progression, 800),
    },
    shots,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const prompt = text(body.prompt, 8_000);
    const shotCount = Math.min(10, Math.max(1, Math.round(Number(body.shotCount) || 1)));
    if (!prompt) return NextResponse.json({ error: "Add a scene instruction." }, { status: 400 });
    const references = safeReferences(body.referenceSnapshot);
    const boards = safeBoards(body.briefBoards);
    const localApiKey = process.env.NODE_ENV === "production" ? null : request.headers.get("x-cafehtml-local-gemini-key");
    const model = process.env.BRIEF_AGENT_MODEL?.trim() || MODEL_REGISTRY.briefAgent;
    const ai = createGoogleGenAI({ apiKey: localApiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: [
        SCENE_BUILDER_SKILL,
        `Requested shot count: ${shotCount}`,
        `Scene instruction: ${JSON.stringify(prompt)}`,
        `Direct reference observations: ${JSON.stringify(references.observations)}`,
        `Active Brief Boards: ${JSON.stringify(boards)}`,
        "Return JSON only.",
      ].join("\n\n") }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCENE_PLAN_SCHEMA,
        maxOutputTokens: 8_192,
      },
    });
    const plan = normalizePlan(parseJson(responseText(result)), prompt, shotCount);
    return NextResponse.json({ plan, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scene planning failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

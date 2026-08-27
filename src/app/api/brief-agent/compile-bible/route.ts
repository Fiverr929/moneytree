import { NextResponse } from "next/server";
import { MODEL_REGISTRY } from "@/lib/modelRegistry";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { VISUAL_BIBLE_COMPILER_SKILL } from "@/lib/brief-agent/skills/visualBibleCompiler";
import type { BriefBoardContext, VisualBible, VisualBibleRules } from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BIBLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "preserve", "flexible", "avoid", "unknown"],
  properties: {
    summary: { type: "string" },
    preserve: { type: "array", items: { type: "string" }, maxItems: 12 },
    flexible: { type: "array", items: { type: "string" }, maxItems: 12 },
    avoid: { type: "array", items: { type: "string" }, maxItems: 12 },
    unknown: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
} as const;

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function cleanList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, 420)).filter(Boolean).slice(0, 12)
    : [];
}

function cleanBoard(value: unknown): BriefBoardContext {
  const board = value && typeof value === "object" ? value as Partial<BriefBoardContext> : {};
  const allowedTypes = new Set(["MOOD", "LOOKBOOK", "WORLD", "CUSTOM", "CHARACTER", "SETTING", "OBJECT", "CREATURE", "WARDROBE", "TREATMENT"]);
  const type = allowedTypes.has(String(board.type)) ? board.type as BriefBoardContext["type"] : "CUSTOM";
  return {
    id: cleanText(board.id, 120),
    type,
    name: cleanText(board.name, 160),
    purpose: cleanText(board.purpose, 600),
    active: board.active !== false,
    sourceFingerprint: cleanText(board.sourceFingerprint, 220),
    images: Array.isArray(board.images) ? board.images.slice(0, 24).map((image) => ({
      imageId: cleanText(image?.imageId, 120),
      label: cleanText(image?.label, 160),
      visualRead: cleanText(image?.visualRead, 900),
    })).filter((image) => image.imageId) : [],
  };
}

function responseText(result: unknown) {
  const candidate = result as { text?: string | (() => string) };
  return typeof candidate.text === "function" ? candidate.text() : candidate.text || "";
}

function parseResult(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function previousBible(value: unknown): VisualBible | null {
  if (!value || typeof value !== "object") return null;
  const previous = value as Partial<VisualBible>;
  if (!previous.rules) return null;
  return {
    id: cleanText(previous.id, 120) || crypto.randomUUID(),
    version: Math.max(1, Math.round(Number(previous.version) || 1)),
    status: previous.status === "approved" || previous.status === "stale" ? previous.status : "draft",
    sourceFingerprint: cleanText(previous.sourceFingerprint, 220),
    summary: cleanText(previous.summary, 1_200),
    rules: {
      preserve: cleanList(previous.rules.preserve),
      flexible: cleanList(previous.rules.flexible),
      avoid: cleanList(previous.rules.avoid),
      unknown: cleanList(previous.rules.unknown),
    },
    draftedAt: cleanText(previous.draftedAt, 100) || new Date().toISOString(),
    approvedAt: cleanText(previous.approvedAt, 100) || undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const board = cleanBoard(body.board);
    if (!board.id || !board.name) return NextResponse.json({ error: "A Brief Board is required." }, { status: 400 });
    if (!board.images.some((image) => image.visualRead)) {
      return NextResponse.json({ error: "The board images are still being read. Try again when visual observations are ready." }, { status: 409 });
    }
    const previous = previousBible(body.previous);
    const localApiKey = process.env.NODE_ENV === "production" ? null : request.headers.get("x-cafehtml-local-gemini-key");
    const model = process.env.BRIEF_AGENT_MODEL?.trim() || MODEL_REGISTRY.briefAgent;
    const ai = createGoogleGenAI({ apiKey: localApiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: [
        VISUAL_BIBLE_COMPILER_SKILL,
        `Brief Board: ${JSON.stringify(board)}`,
        `Previous reviewed Bible: ${JSON.stringify(previous)}`,
        "Return JSON only.",
      ].join("\n\n") }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: BIBLE_SCHEMA,
        maxOutputTokens: 4_096,
      },
    });
    const parsed = parseResult(responseText(result));
    const rules: VisualBibleRules = {
      preserve: cleanList(parsed.preserve),
      flexible: cleanList(parsed.flexible),
      avoid: cleanList(parsed.avoid),
      unknown: cleanList(parsed.unknown),
    };
    const bible: VisualBible = {
      id: previous?.id || crypto.randomUUID(),
      version: previous ? previous.version + 1 : 1,
      status: "draft",
      sourceFingerprint: board.sourceFingerprint,
      summary: cleanText(parsed.summary, 1_200),
      rules,
      draftedAt: new Date().toISOString(),
    };
    return NextResponse.json({ bible, model });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Visual Bible drafting failed." }, { status: 400 });
  }
}

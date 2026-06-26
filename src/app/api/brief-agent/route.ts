import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { createMockBriefDraft } from "@/lib/brief-agent/mockPlanner";
import { applySkillContract, BRIEF_AGENT_SKILL_CONTRACT } from "@/lib/brief-agent/skillContract";
import type {
  AgentMessage,
  BriefAgentRequest,
  BriefAgentResponse,
  BriefClarification,
  BriefDraft,
  BriefPlan,
  BriefReferenceSnapshot,
} from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_BRIEF_AGENT_MODEL = "gemini-3.1-flash-lite";
const MAX_MESSAGE_COUNT = 24;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_FINAL_PROMPT_CHARS = 4_000;

function validateMessage(value: unknown): AgentMessage {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid brief agent message.");
  }
  const message = value as Partial<AgentMessage>;
  if (typeof message.id !== "string" || typeof message.text !== "string" || typeof message.createdAt !== "string") {
    throw new Error("Invalid brief agent message.");
  }
  if (message.role !== "user" && message.role !== "agent" && message.role !== "system") {
    throw new Error("Invalid brief agent message role.");
  }
  return message as AgentMessage;
}

function validateReferenceSnapshot(value: unknown): BriefReferenceSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid reference snapshot.");
  }
  const snapshot = value as Partial<BriefReferenceSnapshot>;
  if (
    typeof snapshot.id !== "string"
    || typeof snapshot.createdAt !== "string"
    || typeof snapshot.sourceFingerprint !== "string"
    || !Array.isArray(snapshot.observations)
  ) {
    throw new Error("Invalid reference snapshot.");
  }
  return snapshot as BriefReferenceSnapshot;
}

function validateRequest(request: Request, value: unknown): BriefAgentRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) {
    throw new Error("Brief agent requests require a same-origin browser request.");
  }
  if (origin && origin !== new URL(request.url).origin) {
    throw new Error("Cross-origin brief agent requests are not allowed.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid brief agent request.");
  }

  const input = value as Partial<BriefAgentRequest>;
  if (!Array.isArray(input.messages)) {
    throw new Error("Brief agent request requires messages.");
  }

  return {
    referenceSnapshot: validateReferenceSnapshot(input.referenceSnapshot),
    messages: input.messages.slice(-MAX_MESSAGE_COUNT).map(validateMessage),
  };
}

function formatAgentReply(draft: ReturnType<typeof createMockBriefDraft>) {
  const lines = [draft.reply];
  if (draft.clarification.needed) {
    draft.clarification.questions.forEach((question, index) => {
      lines.push(`Q${index + 1}: ${question}`);
    });
  }
  return lines.join("\n");
}

function latestUserText(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].text.trim();
  }
  return "";
}

function trimText(value: string, limit = MAX_MESSAGE_CHARS) {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function extractResponseText(result: unknown) {
  if (result && typeof result === "object" && "text" in result && typeof result.text === "string") {
    return result.text;
  }
  const candidateText = (result as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  })?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  return candidateText || "";
}

function parseJsonObject(text: string) {
  const direct = text.trim();
  try {
    return JSON.parse(direct) as Record<string, unknown>;
  } catch {
    const match = direct.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Brief agent model did not return JSON.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? trimText(value, MAX_FINAL_PROMPT_CHARS) : fallback;
}

function stringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => trimText(item, 500))
    .slice(0, 6);
}

function planValue(value: unknown, fallback: BriefPlan): BriefPlan {
  if (!value || typeof value !== "object") return fallback;
  const plan = value as Partial<BriefPlan>;
  return {
    intent: stringValue(plan.intent, fallback.intent),
    subjectPolicy: stringValue(plan.subjectPolicy, fallback.subjectPolicy),
    scenePolicy: stringValue(plan.scenePolicy, fallback.scenePolicy),
    stylePolicy: stringValue(plan.stylePolicy, fallback.stylePolicy),
  };
}

function clarificationValue(value: unknown, fallback: BriefClarification): BriefClarification {
  if (!value || typeof value !== "object") return fallback;
  const clarification = value as Partial<BriefClarification>;
  return {
    needed: typeof clarification.needed === "boolean" ? clarification.needed : fallback.needed,
    reason: typeof clarification.reason === "string" ? trimText(clarification.reason, 500) : fallback.reason,
    questions: stringArray(clarification.questions, fallback.questions).slice(0, 3),
  };
}

function draftFromModelJson(value: Record<string, unknown>, fallback: BriefDraft): BriefDraft {
  const clarification = clarificationValue(value.clarification, fallback.clarification);
  const finalPrompt = clarification.needed
    ? ""
    : stringValue(value.finalPrompt, fallback.finalPrompt).slice(0, MAX_FINAL_PROMPT_CHARS);
  const status = clarification.needed
    ? "needs_clarification"
    : finalPrompt
    ? "draft"
    : fallback.status;

  return {
    ...fallback,
    status,
    reply: stringValue(value.reply, fallback.reply),
    clarification,
    plan: planValue(value.plan, fallback.plan),
    finalPrompt,
    warnings: stringArray(value.warnings, fallback.warnings),
    readyToExecute: typeof value.readyToExecute === "boolean" ? value.readyToExecute : false,
  };
}

function buildModelInstruction(input: BriefAgentRequest, fallback: BriefDraft) {
  const conversation = input.messages.map((message) => ({
    role: message.role,
    text: trimText(message.text),
    createdAt: message.createdAt,
  }));
  const references = input.referenceSnapshot.observations.map((observation) => ({
    role: observation.role,
    label: observation.label,
    strength: observation.strength,
    facts: observation.facts,
    mustPreserve: observation.mustPreserve,
    canChange: observation.canChange,
    mustAvoid: observation.mustAvoid,
  }));

  return [
    "You are CafeHTML Brief Agent, a prompt-planning agent for modular image generation.",
    "Work like a careful coding agent: discuss, clarify, draft, and never execute generation yourself.",
    `Skill contract: ${JSON.stringify(BRIEF_AGENT_SKILL_CONTRACT)}`,
    "If the instruction is under-specified or risks changing subject identity/background/style content, ask concise clarification questions.",
    "If clear enough, produce a concise finalPrompt that preserves role boundaries.",
    "Return JSON only with this shape:",
    "{\"reply\":\"string\",\"clarification\":{\"needed\":boolean,\"reason\":string|null,\"questions\":[\"string\"]},\"plan\":{\"intent\":\"string\",\"subjectPolicy\":\"string\",\"scenePolicy\":\"string\",\"stylePolicy\":\"string\"},\"finalPrompt\":\"string\",\"warnings\":[\"string\"],\"readyToExecute\":false}",
    "",
    `Latest user instruction: ${JSON.stringify(latestUserText(input.messages))}`,
    `Reference snapshot: ${JSON.stringify(references)}`,
    `Conversation: ${JSON.stringify(conversation)}`,
    `Fallback draft to improve: ${JSON.stringify({
      reply: fallback.reply,
      clarification: fallback.clarification,
      plan: fallback.plan,
      finalPrompt: fallback.finalPrompt,
      warnings: fallback.warnings,
    })}`,
  ].join("\n");
}

async function createModelDraft(input: BriefAgentRequest, fallback: BriefDraft) {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
  const model = process.env.BRIEF_AGENT_MODEL?.trim() || DEFAULT_BRIEF_AGENT_MODEL;
  if (!project || !location) return null;

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    apiVersion: "v1",
  });
  const result = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [{ text: buildModelInstruction(input, fallback) }],
    }],
    config: {
      temperature: 0.25,
      responseMimeType: "application/json",
    },
  });
  const text = extractResponseText(result);
  const json = parseJsonObject(text);
  return {
    draft: draftFromModelJson(json, fallback),
    model,
  };
}

export async function POST(request: Request) {
  try {
    const input = validateRequest(request, await request.json());
    let brain: BriefAgentResponse["brain"] = "mock";
    let model: string | null = null;
    let draft = applySkillContract(createMockBriefDraft(input.referenceSnapshot, input.messages));

    try {
      const modelResult = await createModelDraft(input, draft);
      if (modelResult) {
        draft = applySkillContract(modelResult.draft);
        brain = "model";
        model = modelResult.model;
      }
    } catch (error) {
      console.warn("[Brief Agent] Model planner failed, using mock fallback:", error);
      draft = {
        ...draft,
        warnings: [...draft.warnings, "Model planner unavailable; using mock fallback."],
      };
    }

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text: formatAgentReply(draft),
      createdAt: new Date().toISOString(),
      promptArtifact: draft.finalPrompt
        ? {
          id: crypto.randomUUID(),
          title: "PROMPT DRAFT",
          prompt: draft.finalPrompt,
          sourceDraftId: draft.id,
          sourceFingerprint: input.referenceSnapshot.sourceFingerprint,
          refCount: input.referenceSnapshot.observations.length,
        }
        : undefined,
    };
    const response: BriefAgentResponse = { draft, message, brain, model };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Brief agent failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

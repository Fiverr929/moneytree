import { NextResponse } from "next/server";
import { ThinkingLevel } from "@google/genai";
import { applySkillContract, BRIEF_AGENT_SKILL_CONTRACT } from "@/lib/brief-agent/skillContract";
import { advanceAgentRun, type AgentRun } from "@/lib/brief-agent/runState";
import { REFERENCE_INFLUENCE_SKILL } from "@/lib/brief-agent/skills/referenceInfluence";
import { DELIBERATE_PLANNING_SKILL } from "@/lib/brief-agent/skills/deliberatePlanning";
import { createVisualUnderstanding } from "@/lib/brief-agent/visualUnderstanding";
import { getReferenceInfluence } from "@/lib/pipeline/strength";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { logModelUsage, traceReferenceFingerprint } from "@/lib/server/modelUsage";
import { parseAgentAppActions } from "@/lib/brief-agent/appActions";
import { cleanReplyForDirections, createClarificationFlow, createDirectionFlow } from "@/lib/brief-agent/decisionFlow";
import { compileGenerationPrompt, DEFAULT_GENERATION_PROMPT_LIMIT } from "@/lib/brief-agent/promptCompiler";
import { MODEL_REGISTRY } from "@/lib/modelRegistry";
import {
  isClearlyNonCreativeMessage,
  isCreativeBrief,
  shouldProduceDraft,
} from "@/lib/brief-agent/intent";
import type {
  AgentDecisionQuestion,
  AgentMessage,
  BriefAgentMemory,
  BriefAgentAction,
  BriefAgentRequest,
  BriefAgentResponse,
  BriefClarification,
  BriefDraft,
  BriefGenerationEvidence,
  BriefPlan,
  BriefReferenceSnapshot,
  BriefSessionState,
  CafeWorkspaceSnapshot,
  IterationBrief,
  IterationConstraint,
} from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_BRIEF_AGENT_MODEL = MODEL_REGISTRY.briefAgent;
const MAX_MESSAGE_COUNT = 24;
const MAX_MODEL_MESSAGE_COUNT = 10;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_MODEL_MESSAGE_CHARS = 1_500;
const MAX_FINAL_PROMPT_CHARS = DEFAULT_GENERATION_PROMPT_LIMIT;
const MAX_MODEL_PROMPT_MEMORY_CHARS = 3_000;
const MAX_REFERENCE_READ_CHARS = 650;
const MAX_SESSION_TEXT_CHARS = 900;
const MAX_VISUAL_FACTS = 5;
const MAX_GENERATION_EVIDENCE = 6;
const MAX_MEMORY_COUNT = 10;
const MAX_MEMORY_CHARS = 360;

const BRIEF_AGENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "reply",
    "clarification",
    "decisions",
    "plan",
    "session",
    "finalPrompt",
    "warnings",
    "readyToExecute",
    "appActions",
  ],
  properties: {
    action: { type: "string", enum: ["talk", "inspect", "plan", "ask", "draft"] },
    reply: { type: "string" },
    clarification: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "reason", "questions"],
      properties: {
        needed: { type: "boolean" },
        reason: { type: ["string", "null"] },
        questions: { type: "array", items: { type: "string" } },
      },
    },
    decisions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "prompt", "options", "allowCustom", "dependsOnQuestionId", "dependsOnOptionId"],
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          options: {
            type: "array",
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "description"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          allowCustom: { type: "boolean" },
          dependsOnQuestionId: { type: ["string", "null"] },
          dependsOnOptionId: { type: ["string", "null"] },
        },
      },
    },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "subjectPolicy", "scenePolicy", "stylePolicy"],
      properties: {
        intent: { type: "string" },
        subjectPolicy: { type: "string" },
        scenePolicy: { type: "string" },
        stylePolicy: { type: "string" },
      },
    },
    session: {
      type: "object",
      additionalProperties: false,
      required: ["projectIntent", "selectedDirection", "directions", "lastDraftPrompt", "unresolvedQuestions", "notes"],
      properties: {
        projectIntent: { type: "string" },
        selectedDirection: { type: "string" },
        directions: { type: "array", items: { type: "string" } },
        lastDraftPrompt: { type: "string" },
        unresolvedQuestions: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    finalPrompt: { type: "string", maxLength: MAX_FINAL_PROMPT_CHARS },
    warnings: { type: "array", items: { type: "string" } },
    readyToExecute: { type: "boolean" },
    appActions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          imageId: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          strength: { type: "number" },
          visible: { type: "boolean" },
          folder: { type: ["string", "null"] },
        },
        required: ["type"],
      },
    },
  },
} as const;

function briefAgentThinkingLevel() {
  const configured = process.env.BRIEF_AGENT_THINKING_LEVEL?.trim().toUpperCase();
  if (configured === "MINIMAL") return ThinkingLevel.MINIMAL;
  if (configured === "LOW") return ThinkingLevel.LOW;
  if (configured === "MEDIUM") return ThinkingLevel.MEDIUM;
  return ThinkingLevel.HIGH;
}
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

function validateSession(value: unknown): BriefSessionState | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<BriefSessionState>;
  return {
    projectIntent: typeof session.projectIntent === "string" ? trimText(session.projectIntent, MAX_SESSION_TEXT_CHARS) : "",
    selectedDirection: typeof session.selectedDirection === "string" ? trimText(session.selectedDirection, MAX_SESSION_TEXT_CHARS) : "",
    directions: stringArray(session.directions, []).slice(0, 5),
    lastDraftPrompt: typeof session.lastDraftPrompt === "string" ? trimText(session.lastDraftPrompt, MAX_FINAL_PROMPT_CHARS) : "",
    unresolvedQuestions: stringArray(session.unresolvedQuestions, []).slice(0, 3),
    notes: stringArray(session.notes, []).slice(0, 6),
  };
}

function validateRun(value: unknown): AgentRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<AgentRun>;
  if (
    typeof run.id !== "string"
    || run.version !== 1
    || typeof run.goal !== "string"
    || typeof run.referenceFingerprint !== "string"
    || !Array.isArray(run.steps)
    || !Array.isArray(run.generationIds)
    || !run.budget
  ) {
    return null;
  }
  return {
    ...(run as AgentRun),
    generationAttempts: Number.isFinite(run.generationAttempts)
      ? Math.max(0, Math.floor(run.generationAttempts as number))
      : 0,
    budget: {
      maxSteps: Math.min(20, Math.max(1, Math.floor(Number(run.budget.maxSteps) || 6))),
      maxGenerations: Math.min(3, Math.max(1, Math.floor(Number(run.budget.maxGenerations) || 1))),
    },
  };
}

function validateGenerationEvidence(value: unknown): BriefGenerationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_GENERATION_EVIDENCE).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<BriefGenerationEvidence>;
    if (typeof candidate.generationId !== "string") return [];
    const review = candidate.visualReview;
    const feedback = candidate.userFeedback;
    const vision = candidate.visionObservation;
    return [{
      generationId: trimText(candidate.generationId, 120),
      recency: index + 1,
      anchored: candidate.anchored === true,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : null,
      prompt: typeof candidate.prompt === "string" ? trimText(candidate.prompt, MAX_MODEL_PROMPT_MEMORY_CHARS) : "",
      model: typeof candidate.model === "string" ? trimText(candidate.model, 120) : null,
      visualReview: review && typeof review === "object" ? {
        summary: typeof review.summary === "string" ? trimText(review.summary, 600) : "",
        issues: stringArray(review.issues, []).slice(0, 5),
        suggestions: stringArray(review.suggestions, []).slice(0, 5),
        scores: {
          prompt: Number(review.scores?.prompt) || 0,
          subject: Number(review.scores?.subject) || 0,
          scene: Number(review.scores?.scene) || 0,
          style: Number(review.scores?.style) || 0,
          quality: Number(review.scores?.quality) || 0,
        },
      } : null,
      userFeedback: feedback && typeof feedback === "object"
        && (feedback.reaction === "like" || feedback.reaction === "mixed" || feedback.reaction === "dislike")
        ? {
          reaction: feedback.reaction,
          keep: stringArray(feedback.keep, []).slice(0, 8),
          change: stringArray(feedback.change, []).slice(0, 8),
          note: typeof feedback.note === "string" ? trimText(feedback.note, 800) : "",
          remember: feedback.remember === true,
        }
        : null,
      visionObservation: vision && typeof vision === "object" && typeof vision.visualRead === "string"
        ? {
          visualRead: trimText(vision.visualRead, 1600),
          comparison: typeof vision.comparison === "string" ? trimText(vision.comparison, 1600) : null,
          inspectedAt: typeof vision.inspectedAt === "string" ? vision.inspectedAt : new Date().toISOString(),
        }
        : null,
    }];
  });
}

function validateWorkspace(value: unknown): CafeWorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const workspace = value as Partial<CafeWorkspaceSnapshot>;
  if (!workspace.project || !Array.isArray(workspace.references)) return null;
  const projectId = Number(workspace.project.id);
  if (!Number.isFinite(projectId)) return null;
  return {
    project: { id: projectId, name: trimText(String(workspace.project.name || "Project"), 120) },
    folders: Array.isArray(workspace.folders) ? workspace.folders.slice(0, 100).flatMap((folder) => (
      folder && typeof folder.id === "string"
        ? [{ id: trimText(folder.id, 120), name: trimText(String(folder.name || folder.id), 120) }]
        : []
    )) : [],
    references: workspace.references.slice(0, 100).flatMap((reference, index) => {
      if (!reference || typeof reference !== "object" || typeof reference.imageId !== "string") return [];
      const role = String(reference.role || "UNASSIGNED").toUpperCase();
      return [{
        position: index + 1,
        imageId: trimText(reference.imageId, 160),
        name: trimText(String(reference.name || reference.label || "UNLABELED"), 120),
        label: trimText(String(reference.label || reference.name || "UNLABELED"), 120),
        role: role === "SUBJECT" || role === "SCENE" || role === "STYLE" ? role : "UNASSIGNED",
        strength: Math.max(0, Math.min(100, Math.round(Number(reference.strength) || 0))),
        visible: reference.visible !== false,
        folder: typeof reference.folder === "string" ? trimText(reference.folder, 120) : null,
      }];
    }),
  };
}

function validateMemories(value: unknown): BriefAgentMemory[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_MEMORY_COUNT).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<BriefAgentMemory>;
    if (typeof candidate.id !== "string" || typeof candidate.text !== "string") return [];
    if (candidate.scope !== "user" && candidate.scope !== "project" && candidate.scope !== "session") return [];
    const kinds = new Set(["preference", "constraint", "decision", "correction", "feedback", "summary"]);
    if (!candidate.kind || !kinds.has(candidate.kind)) return [];
    return [{
      id: trimText(candidate.id, 160),
      scope: candidate.scope,
      kind: candidate.kind,
      text: trimText(candidate.text, MAX_MEMORY_CHARS),
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0)),
      pinned: candidate.pinned === true,
    }];
  });
}

function validateIterationBrief(value: unknown): IterationBrief | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IterationBrief>;
  const projectId = Number(candidate.projectId);
  if (!Number.isFinite(projectId)) return null;
  const constraints = (items: unknown, kind: "keep" | "change" | "avoid"): IterationConstraint[] => Array.isArray(items)
    ? items.slice(0, 12).flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const text = typeof entry.text === "string" ? trimText(entry.text, 500) : "";
      if (!text) return [];
      return [{
        id: typeof entry.id === "string" ? trimText(entry.id, 120) : `${kind}-${index + 1}`,
        kind,
        text,
        source: (entry.source === "user" || entry.source === "comparison" || entry.source === "agent" ? entry.source : "feedback") as IterationConstraint["source"],
        sourceGenerationIds: stringArray(entry.sourceGenerationIds, []).slice(0, 6),
        confidence: entry.confidence === "inferred" ? "inferred" as const : "explicit" as const,
        status: (entry.status === "superseded" || entry.status === "confirmed" ? entry.status : "active") as IterationConstraint["status"],
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      }];
    })
    : [];
  return {
    projectId,
    anchorGenerationId: typeof candidate.anchorGenerationId === "string" ? trimText(candidate.anchorGenerationId, 160) : null,
    parentGenerationId: typeof candidate.parentGenerationId === "string" ? trimText(candidate.parentGenerationId, 160) : null,
    keep: constraints(candidate.keep, "keep"),
    change: constraints(candidate.change, "change"),
    avoid: constraints(candidate.avoid, "avoid"),
    rejectedGenerationIds: stringArray(candidate.rejectedGenerationIds, []).slice(0, 20),
    selectedDirection: typeof candidate.selectedDirection === "string" ? trimText(candidate.selectedDirection, 500) : null,
    decisionAnswers: [],
    referenceFingerprint: typeof candidate.referenceFingerprint === "string" ? trimText(candidate.referenceFingerprint, 200) : null,
    version: Math.max(1, Number(candidate.version) || 1),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
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
    session: validateSession(input.session),
    run: validateRun(input.run),
    generations: validateGenerationEvidence(input.generations),
    workspace: validateWorkspace(input.workspace),
    memories: validateMemories(input.memories),
    iterationBrief: validateIterationBrief(input.iterationBrief),
  };
}

function formatAgentReply(draft: BriefDraft) {
  const structuredItems = draft.action === "plan"
    ? draft.session.directions
    : draft.action === "ask" || draft.clarification.needed
      ? draft.decisionQuestions.map((question) => question.prompt)
      : [];
  return cleanReplyForDirections(draft.reply, structuredItems)
    || (draft.action === "plan"
      ? "Choose a direction to continue."
      : draft.action === "ask"
        ? "I need a little more detail."
        : "Done.");
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

function compactStringArray(value: string[], limit = MAX_VISUAL_FACTS) {
  return value
    .filter((item) => item.trim())
    .slice(0, limit)
    .map((item) => trimText(item, 180));
}

function compactRoleUnderstanding(role: BriefDraft["visualUnderstanding"]["subject"]) {
  return {
    present: role.present,
    labels: compactStringArray(role.labels, 4),
    facts: compactStringArray(role.facts),
    anchors: compactStringArray(role.anchors),
    avoid: compactStringArray(role.avoid, 3),
  };
}

function compactSessionForModel(session: BriefSessionState) {
  return {
    projectIntent: trimText(session.projectIntent, MAX_SESSION_TEXT_CHARS),
    selectedDirection: trimText(session.selectedDirection, MAX_SESSION_TEXT_CHARS),
    directions: compactStringArray(session.directions, 5),
    lastDraftPrompt: trimText(session.lastDraftPrompt, MAX_MODEL_PROMPT_MEMORY_CHARS),
    unresolvedQuestions: compactStringArray(session.unresolvedQuestions, 3),
    notes: compactStringArray(session.notes, 6),
  };
}

function compactConversationForModel(messages: AgentMessage[]) {
  return messages.slice(-MAX_MODEL_MESSAGE_COUNT).map((message) => ({
    role: message.role,
    action: message.action || null,
    text: trimText(message.text.replace(/\s+/g, " "), MAX_MODEL_MESSAGE_CHARS),
    promptDraft: message.promptArtifact?.prompt
      ? trimText(message.promptArtifact.prompt, MAX_MODEL_PROMPT_MEMORY_CHARS)
      : null,
    createdAt: message.createdAt,
  }));
}

function compactVisualUnderstandingForModel(draft: BriefDraft) {
  const understanding = draft.visualUnderstanding;
  return {
    subject: compactRoleUnderstanding(understanding.subject),
    scene: compactRoleUnderstanding(understanding.scene),
    style: compactRoleUnderstanding(understanding.style),
    unassigned: compactRoleUnderstanding(understanding.unassigned),
    continuity: {
      anchors: compactStringArray(understanding.continuity.anchors),
      changeBoundaries: compactStringArray(understanding.continuity.changeBoundaries),
      storySignals: compactStringArray(understanding.continuity.storySignals, 3),
    },
    uncertainties: compactStringArray(understanding.uncertainties, 4),
  };
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

function decisionQuestionsValue(value: unknown, fallbackQuestions: string[]): AgentDecisionQuestion[] {
  const fallback = () => fallbackQuestions.map((prompt, index) => ({
    id: `question-${index + 1}`,
    prompt,
    options: [],
    allowCustom: true,
  }));
  if (!Array.isArray(value)) return fallback();
  const parsed = value.slice(0, 3).flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const prompt = typeof candidate.prompt === "string" ? trimText(candidate.prompt, 500) : "";
    if (!prompt) return [];
    const options = Array.isArray(candidate.options)
      ? candidate.options.slice(0, 4).flatMap((option, optionIndex) => {
        if (!option || typeof option !== "object") return [];
        const item = option as Record<string, unknown>;
        const label = typeof item.label === "string" ? trimText(item.label, 300) : "";
        if (!label) return [];
        return [{
          id: typeof item.id === "string" && item.id.trim() ? trimText(item.id, 80) : `option-${optionIndex + 1}`,
          label,
          description: typeof item.description === "string" && item.description.trim() ? trimText(item.description, 300) : undefined,
        }];
      })
      : [];
    return [{
      id: typeof candidate.id === "string" && candidate.id.trim() ? trimText(candidate.id, 80) : `question-${index + 1}`,
      prompt,
      options,
      allowCustom: candidate.allowCustom !== false,
      dependsOnQuestionId: typeof candidate.dependsOnQuestionId === "string" && candidate.dependsOnQuestionId.trim() ? trimText(candidate.dependsOnQuestionId, 80) : undefined,
      dependsOnOptionId: typeof candidate.dependsOnOptionId === "string" && candidate.dependsOnOptionId.trim() ? trimText(candidate.dependsOnOptionId, 80) : undefined,
    }];
  });
  return parsed.length ? parsed : fallback();
}

function createEmptySession(): BriefSessionState {
  return {
    projectIntent: "",
    selectedDirection: "",
    directions: [],
    lastDraftPrompt: "",
    unresolvedQuestions: [],
    notes: [],
  };
}

function deriveSessionFromMessages(messages: AgentMessage[], previousSession: BriefSessionState | null): BriefSessionState {
  const session = previousSession || createEmptySession();
  const lastDraftPrompt = [...messages].reverse().find((message) => message.promptArtifact?.prompt)?.promptArtifact?.prompt
    || session.lastDraftPrompt;
  const lastCreativeUserMessage = [...messages].reverse().find((message) => (
    message.role === "user" && isCreativeBrief(message.text)
  ))?.text || session.projectIntent;
  const unresolvedQuestions = [...messages].reverse().find((message) => (
    message.role === "agent" && message.action === "ask"
  ))?.text.split("\n").filter(Boolean).slice(0, 3) || session.unresolvedQuestions;

  return {
    ...session,
    projectIntent: trimText(lastCreativeUserMessage, MAX_SESSION_TEXT_CHARS),
    lastDraftPrompt: trimText(lastDraftPrompt, MAX_FINAL_PROMPT_CHARS),
    unresolvedQuestions,
  };
}

function sessionValue(value: unknown, fallback: BriefSessionState): BriefSessionState {
  if (!value || typeof value !== "object") return fallback;
  const session = value as Partial<BriefSessionState>;
  return {
    projectIntent: stringValue(session.projectIntent, fallback.projectIntent),
    selectedDirection: stringValue(session.selectedDirection, fallback.selectedDirection),
    directions: stringArray(session.directions, fallback.directions).slice(0, 5),
    lastDraftPrompt: stringValue(session.lastDraftPrompt, fallback.lastDraftPrompt),
    unresolvedQuestions: stringArray(session.unresolvedQuestions, fallback.unresolvedQuestions).slice(0, 3),
    notes: stringArray(session.notes, fallback.notes).slice(0, 6),
  };
}

function actionValue(value: unknown, fallback: BriefAgentAction): BriefAgentAction {
  return value === "talk"
    || value === "inspect"
    || value === "plan"
    || value === "ask"
    || value === "draft"
    ? value
    : fallback;
}

function fallbackActionForText(text: string, shouldDraft: boolean): BriefAgentAction {
  if (shouldDraft) return "draft";
  if (/\b(plan|approach|strategy|steps|option|direction|workflow)\b/i.test(text)) return "plan";
  if (/\?|\b(what|how|why|when|where|who|can you|could you|do you|are you|is this|does this)\b/i.test(text)) {
    return "inspect";
  }
  return "talk";
}

function draftFromModelJson(value: Record<string, unknown>, fallback: BriefDraft): BriefDraft {
  const latestText = latestUserText(fallback.messages);
  const shouldDraft = shouldProduceDraft(latestText, fallback.session);
  const clarification = clarificationValue(value.clarification, fallback.clarification);
  const requestedAction = actionValue(value.action, fallbackActionForText(latestText, shouldDraft));
  const allowModelDraft = requestedAction === "draft" && !isClearlyNonCreativeMessage(latestText);
  const action: BriefAgentAction = clarification.needed
    ? "ask"
    : allowModelDraft
      ? "draft"
      : requestedAction === "draft"
        ? fallbackActionForText(latestText, false)
        : requestedAction;
  const modelPrompt = typeof value.finalPrompt === "string" ? value.finalPrompt.trim() : "";
  // A creative request must never disappear because the model selected draft but
  // omitted the optional-looking JSON field. The user's own brief is a safe,
  // generation-capable fallback and remains visible for editing.
  const promptFallback = action === "draft" ? latestText : fallback.finalPrompt;
  const compiledPrompt = action !== "draft" || clarification.needed
    ? compileGenerationPrompt("")
    : compileGenerationPrompt(modelPrompt || promptFallback);
  const promptTooLong = action === "draft" && compiledPrompt.blocked;
  const finalPrompt = promptTooLong ? "" : compiledPrompt.prompt;
  const effectiveClarification: BriefClarification = promptTooLong
    ? {
      needed: true,
      reason: compiledPrompt.warnings[0],
      questions: ["Which details should be prioritized so I can prepare a focused generation brief?"],
    }
    : clarification;
  const status = action === "ask" || promptTooLong
    ? "needs_clarification"
    : action === "draft" && finalPrompt
    ? "draft"
    : "empty";
  const session = sessionValue(value.session, fallback.session);
  const nextSession: BriefSessionState = {
    ...session,
    lastDraftPrompt: finalPrompt || session.lastDraftPrompt,
    unresolvedQuestions: action === "ask" || promptTooLong ? effectiveClarification.questions : session.unresolvedQuestions,
  };
  const decisionQuestions = decisionQuestionsValue(promptTooLong ? [] : value.decisions, effectiveClarification.questions);

  return {
    ...fallback,
    status,
    action: promptTooLong ? "ask" : finalPrompt ? "draft" : action === "draft" ? "talk" : action,
    reply: promptTooLong
      ? `${compiledPrompt.warnings[0]} ${effectiveClarification.questions[0]}`
      : stringValue(value.reply, fallback.reply),
    clarification: effectiveClarification,
    decisionQuestions,
    plan: planValue(value.plan, fallback.plan),
    session: nextSession,
    finalPrompt,
    warnings: Array.from(new Set([
      ...stringArray(value.warnings, fallback.warnings),
      ...compiledPrompt.warnings,
      ...(action === "draft" && !modelPrompt && finalPrompt
        ? ["The planner omitted its composed prompt, so the original creative brief was preserved as the draft."]
        : []),
    ])),
    readyToExecute: typeof value.readyToExecute === "boolean" ? value.readyToExecute : false,
  };
}

function createBaselineDraft(input: BriefAgentRequest): BriefDraft {
  const visualUnderstanding = createVisualUnderstanding(input.referenceSnapshot);
  const session = deriveSessionFromMessages(input.messages, input.session || null);
  return {
    id: crypto.randomUUID(),
    status: "empty",
    action: "talk",
    reply: "",
    messages: input.messages,
    referenceSnapshot: input.referenceSnapshot,
    observations: input.referenceSnapshot.observations,
    visualUnderstanding,
    clarification: {
      needed: false,
      reason: null,
      questions: [],
    },
    decisionQuestions: [],
    plan: {
      intent: session.projectIntent || latestUserText(input.messages),
      subjectPolicy: "",
      scenePolicy: "",
      stylePolicy: "",
    },
    session,
    finalPrompt: "",
    warnings: [],
    skillChecks: [],
    readyToExecute: false,
  };
}

function buildModelInstruction(input: BriefAgentRequest, fallback: BriefDraft) {
  const latestInstruction = latestUserText(input.messages);
  const shouldDraft = shouldProduceDraft(latestInstruction, fallback.session);
  const session = compactSessionForModel(fallback.session);
  const conversation = compactConversationForModel(input.messages);
  const visualUnderstanding = compactVisualUnderstandingForModel(fallback);
  const references = input.referenceSnapshot.observations.map((observation) => ({
    imageId: observation.imageId,
    role: observation.role,
    label: observation.label,
    influence: getReferenceInfluence(observation.strength),
    visualRead: trimText(observation.visualRead, MAX_REFERENCE_READ_CHARS),
    readSource: observation.readSource || null,
  }));
  const generations = input.generations || [];
  const workspace = input.workspace || null;
  const memories = input.memories || [];
  const iterationBrief = input.iterationBrief || null;

  return [
    "You are CafeHTML Brief Agent, a prompt-planning agent for modular image generation.",
    "Work like a terse coding agent in a terminal: answer directly, clarify briefly, and draft only when the user gives a creative image direction. The client automatically starts image generation when you return a valid draft.",
    "Choose exactly one conversational action for the latest user message: talk, inspect, plan, ask, or draft. You may also return safe appActions when the user explicitly requests an app change.",
    "talk = casual conversation or quick status; inspect = answer how the current references/UI/agent state works; plan = outline an approach or creative direction; ask = one missing detail blocks the next useful move; draft = produce a generation-ready image prompt.",
    "Action behavior:",
    "- talk: reply in one or two short natural lines. No prompt draft language, no planning template.",
    "- inspect: explain what you can infer from the current references, model state, command state, or conversation. Be factual and compact.",
    "- plan: put 2-4 concise unnumbered options in session.directions. Keep reply to one short introduction and do not repeat directions in reply.",
    "- ask: put each materially blocking interactive question and its options in decisions. Keep reply to one short introduction and do not repeat questions in reply. Use an empty options array when a custom answer is required.",
    "decisions is only for interactive questions. Ordinary rhetorical or inline questions in reply must not appear there. Return at most three questions and four unnumbered options each. Use dependencies only when a later question applies to one earlier option.",
    "- draft: produce one generation-ready prompt in finalPrompt and a short reply that says generation is starting. Store finalPrompt in session.lastDraftPrompt.",
    "For follow-ups like 'do option 2', 'use that', 'make it moodier', or 'continue', resolve the target from session, conversation, and the last plan before choosing action.",
    "Treat short follow-ups as edits to the active objective unless the user clearly starts a new subject. Carry forward established constraints, selected direction, and requested keeps; do not make the user restate them.",
    "Relevant memory contains previously stored user, project, and session facts. Apply only memories relevant to the latest instruction. The latest explicit user instruction always overrides memory. Never expose internal memory IDs or claim a memory was stored unless the client confirms it.",
    "When the user corrects you, accept the correction as authoritative, update session notes or selectedDirection as needed, and apply it immediately without defending the earlier interpretation.",
    "Before asking a question, inspect the session, recent conversation, workspace, references, and generation evidence. Ask only when a missing decision would materially change the result.",
    "Never report an operation as complete from intent alone. Distinguish between what you understand, what you drafted, what is generating, what needs approval, and what the client confirms as completed.",
    "You are integrated with CafeHTML's generation client. Never claim that you cannot run generation or that you only write prompts. A draft is handed to the client automatically. If generation evidence says a run failed or was blocked, acknowledge that exact outcome and offer a useful retry or prompt adjustment.",
    "Maintain session.projectIntent as the user's current creative objective. Maintain session.selectedDirection when a plan option is chosen. Keep session.notes as short durable constraints only.",
    "Do not introduce yourself. Do not say you are ready to help. Do not greet unless the user greets first, and then keep it to one short line.",
    "If the latest user message is casual chat, a greeting, a status question, or a question about the UI/agent, use action talk or inspect. Do not produce finalPrompt.",
    "Use action draft and produce finalPrompt when the latest user message asks to create, generate, compose, edit, transform, or simply describes the desired image/frame as a noun phrase.",
    "If action is talk, inspect, plan, or ask, finalPrompt must be an empty string.",
    "App control:",
    "- appActions are proposed commands for CafeHTML itself, separate from the conversational action. The user must approve them before execution.",
    "- Emit an app action only when the latest user message explicitly requests that change. Never infer extra cleanup or organization.",
    "- Resolve image targets only from Current workspace. Use the exact imageId. If a target is ambiguous, ask and return no appActions.",
    "- Allowed actions: project.rename, reference.rename, reference.set_role, reference.set_strength, reference.set_visibility, reference.move, reference.duplicate, folder.create.",
    "- Action shapes: {type:'project.rename',name}; {type:'reference.rename',imageId,name}; {type:'reference.set_role',imageId,role}; {type:'reference.set_strength',imageId,strength}; {type:'reference.set_visibility',imageId,visible}; {type:'reference.move',imageId,folder}; {type:'reference.duplicate',imageId}; {type:'folder.create',folder}.",
    "- role is SUBJECT, SCENE, STYLE, or UNASSIGNED. strength is 0..100. visible is boolean. folder is an exact folder id or null for root.",
    "- folder.create accepts only MOOD, LOOKBOOK, or WORLD and only when that folder does not already exist.",
    "- Never claim an app change succeeded in reply; say what you are proposing for approval. The client reports actual execution results.",
    "- Image generation is automatically executed from a draft and is never an appAction. Editing, deletion of user-owned content, replacement, upload, publishing, and other destructive operations are not appActions.",
    "Recent generation evidence is an on-demand inspection catalog. Recency 1 means the latest generation, except an anchored generation may be included explicitly with anchored=true even when older.",
    "Iteration brief is the authoritative continuity state for the current project. Keep/change/avoid are explicit constraints. The anchor is a semantic continuity source, not proof that its pixels are being passed to the image model. Never replace an anchor merely because a newer attempt exists.",
    "User feedback is authoritative evidence of preference. visualReview is an automatic quality review. visionObservation is the result of an explicit on-demand image inspection.",
    "When visionObservation is present, you may answer from its visible evidence and comparison, and you must identify the generation or generations used.",
    "When asked what the user liked, disliked, wants preserved, or wants changed, answer from userFeedback and identify the generation used.",
    "When asked to compare generations, contrast only generations present in the catalog. Separate user preference from visual-review findings.",
    "When revising from feedback, preserve items in keep, address items in change and the note, and use visual-review suggestions only when they do not conflict with user feedback.",
    "If the requested generation or evidence is absent, say what is unavailable instead of inventing it.",
    `Skill contract: ${JSON.stringify(BRIEF_AGENT_SKILL_CONTRACT)}`,
    `Deliberate planning skill:\n${DELIBERATE_PLANNING_SKILL}`,
    `Reference influence skill:\n${REFERENCE_INFLUENCE_SKILL}`,
    "First build a visual understanding from the references, then draft from that understanding. The raw user text is an instruction, not the final prompt.",
    "Treat the latest user instruction as the creative brief. Use reference data to support that brief, not to automatically freeze the image.",
    "Use compact visual understanding as visual evidence. The visual scan tells you what is visible; the influence value tells you how much that evidence should shape the composed finalPrompt.",
    "Use influence only for private prompt composition. Never include influence labels, strength, control axis, slider, percentage, or other UI mechanics in finalPrompt.",
    "Do not invent subject features, wardrobe details, stage elements, camera view, lighting, palette, or style details that are not requested by the user or present in the visual scan.",
    "For a person, SUBJECT exclusively determines the main character's identity and visible gender presentation when the Subject scan is clear. People depicted in SCENE may contribute action, pose, staging, and spatial relationships but never replace the Subject's identity, gender presentation, or wardrobe. People depicted in STYLE contribute none of those traits.",
    "When more than one SUBJECT reference is active, represent every one in finalPrompt with distinct visible evidence. Unless the user identifies them as alternate views of the same entity, treat them as separate subjects that must all appear in the composition.",
    "Example conflict: if SUBJECT shows a woman and SCENE shows a man tying his shoes, compose the woman performing the shoe-tying action; do not turn her into the Scene man.",
    "When the visual scan is incomplete, use safe general language or ask only if the missing detail blocks a useful draft.",
    "The finalPrompt should be one clean generation brief. Merge user intent, visual scans, roles, and influence into natural visual language; do not append checklist-like rule blocks.",
    "Before returning a draft, re-read the exact latest user instruction and verify that every explicit subject, action, setting, composition, style, lighting, color, text, keep, remove, and negative constraint is represented in finalPrompt. Do not silently drop details.",
    "If the user asks for a small edit and the relevant reference influence is LOCKED or CLOSE, keep the rest stable through natural prompt wording.",
    "If the user asks for transformation, exploration, or a campaign concept, let FREE, LOOSE, or BALANCED references participate more flexibly.",
    "Ask concise clarification questions only when the request lacks a necessary target or choosing one would likely betray the user's intent.",
    "If the latest message is an image direction and a reasonable image can be drafted, produce a concise finalPrompt instead of asking.",
    "Return JSON only with this shape:",
    "{\"action\":\"talk|inspect|plan|ask|draft\",\"reply\":\"string\",\"clarification\":{\"needed\":boolean,\"reason\":string|null,\"questions\":[\"string\"]},\"decisions\":[{\"id\":\"string\",\"prompt\":\"string\",\"options\":[{\"id\":\"string\",\"label\":\"string\",\"description\":\"string\"}],\"allowCustom\":true,\"dependsOnQuestionId\":null,\"dependsOnOptionId\":null}],\"plan\":{\"intent\":\"string\",\"subjectPolicy\":\"string\",\"scenePolicy\":\"string\",\"stylePolicy\":\"string\"},\"session\":{\"projectIntent\":\"string\",\"selectedDirection\":\"string\",\"directions\":[\"string\"],\"lastDraftPrompt\":\"string\",\"unresolvedQuestions\":[\"string\"],\"notes\":[\"string\"]},\"finalPrompt\":\"string\",\"warnings\":[\"string\"],\"readyToExecute\":false,\"appActions\":[]}",
    "",
    `Latest user instruction: ${JSON.stringify(latestInstruction)}`,
    `Creative-direction heuristic (advisory; use the instruction itself as authority): ${JSON.stringify(shouldDraft)}`,
    `Session state: ${JSON.stringify(session)}`,
    `Relevant memory: ${JSON.stringify(memories)}`,
    `Iteration brief: ${JSON.stringify(iterationBrief)}`,
    `Compact visual understanding: ${JSON.stringify(visualUnderstanding)}`,
    `Compact reference reads: ${JSON.stringify(references)}`,
    `Recent generation evidence: ${JSON.stringify(generations)}`,
    `Recent conversation: ${JSON.stringify(conversation)}`,
    `Current workspace: ${JSON.stringify(workspace)}`,
    `Current draft state: ${JSON.stringify({
      action: fallback.action,
      clarification: fallback.clarification,
      plan: fallback.plan,
      warnings: fallback.warnings,
    })}`,
  ].join("\n");
}

async function createModelDraft(input: BriefAgentRequest, baseline: BriefDraft, requestId: string, localApiKey?: string | null) {
  const startedAt = Date.now();
  const model = process.env.BRIEF_AGENT_MODEL?.trim() || DEFAULT_BRIEF_AGENT_MODEL;
  const ai = createGoogleGenAI({ apiKey: localApiKey });
  const result = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [{ text: buildModelInstruction(input, baseline) }],
    }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: BRIEF_AGENT_RESPONSE_SCHEMA,
      maxOutputTokens: 6_144,
      thinkingConfig: { thinkingLevel: briefAgentThinkingLevel() },
    },
  });
  logModelUsage("brief-agent.plan", model, result, {
    requestId,
    referenceFingerprint: traceReferenceFingerprint(input.referenceSnapshot.sourceFingerprint),
    referenceCount: input.referenceSnapshot.observations.length,
    messageCount: input.messages.length,
    memoryCount: input.memories?.length || 0,
    durationMs: Date.now() - startedAt,
  });
  const text = extractResponseText(result);
  const json = parseJsonObject(text);
  return {
    draft: draftFromModelJson(json, baseline),
    model,
    appActions: parseAgentAppActions(json.appActions, input.workspace),
  };
}

function describeBriefAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("billing_disabled") || lower.includes("billing to be enabled") || lower.includes("billing is disabled")) {
    return { message: "Google Cloud billing is disabled for the configured Vertex AI project. Enable billing, or on localhost add a Gemini API key in Settings, then try again.", status: 403 };
  }
  if (lower.includes("token") || lower.includes("context") || lower.includes("too long") || lower.includes("request too large")) {
    return { message: "Brief agent context is still too large. Clear the agent console or reduce active references, then try again.", status: 413 };
  }
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate") || lower.includes("429")) {
    return { message: "Brief agent model quota or rate limit was hit. Wait a moment and try again.", status: 429 };
  }
  if (
    lower.includes("high demand")
    || lower.includes("unavailable")
    || lower.includes('"code":503')
    || lower.includes(" 503")
  ) {
    return {
      message: "The Gemini agent model is temporarily busy. CafeHTML will retry automatically.",
      status: 503,
      retryAfterSeconds: 3,
    };
  }
  if (lower.includes("permission_denied") || lower.includes("permission denied") || lower.includes("403")) {
    return { message: "Vertex AI access was denied. Check the project, API enablement, and the account's Vertex AI permissions.", status: 403 };
  }
  if (lower.includes("auth") || lower.includes("credential") || lower.includes("unauthenticated") || lower.includes("401")) {
    return { message: "Brief agent authentication is not configured. Add GEMINI_API_KEY as a server secret.", status: 401 };
  }
  return { message: message || "Brief agent failed.", status: 400 };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = validateRequest(request, await request.json());
    const localApiKey = process.env.NODE_ENV === "production"
      ? null
      : request.headers.get("x-cafehtml-local-gemini-key");
    const baseline = createBaselineDraft(input);
    const modelResult = await createModelDraft(input, baseline, requestId, localApiKey);
    const draft = applySkillContract(modelResult.draft);
    const run = advanceAgentRun(input.run, draft, input.referenceSnapshot);
    const isPromptRevision = input.run?.steps.at(-1)?.action.type === "request_prompt_revision";

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text: formatAgentReply(draft),
      action: draft.action,
      decisionFlow: draft.action === "plan"
        ? createDirectionFlow({
          id: `decision-${draft.id}`,
          sourceFingerprint: input.referenceSnapshot.sourceFingerprint,
          directions: draft.session.directions,
        })
        : draft.action === "ask"
          ? createClarificationFlow({
            id: `decision-${draft.id}`,
            sourceFingerprint: input.referenceSnapshot.sourceFingerprint,
            submitIntent: shouldProduceDraft(latestUserText(input.messages), draft.session) ? "draft" : "reply",
            questions: draft.decisionQuestions,
          })
          : undefined,
      createdAt: new Date().toISOString(),
      promptArtifact: draft.action === "draft" && draft.finalPrompt
        ? {
          id: crypto.randomUUID(),
          title: isPromptRevision ? "REVISED PROMPT" : "PROMPT DRAFT",
          prompt: draft.finalPrompt,
          sourceDraftId: draft.id,
          sourceFingerprint: input.referenceSnapshot.sourceFingerprint,
          refCount: input.referenceSnapshot.observations.length,
          previousPrompt: isPromptRevision ? input.run?.currentPrompt : undefined,
        }
        : undefined,
    };
    const response: BriefAgentResponse = { draft, message, run, brain: "model", model: modelResult.model, appActions: modelResult.appActions };
    return NextResponse.json(response, { headers: { "X-CafeHTML-Request-Id": requestId } });
  } catch (error) {
    const described = describeBriefAgentError(error);
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

import { NextResponse } from "next/server";
import { applySkillContract, BRIEF_AGENT_SKILL_CONTRACT } from "@/lib/brief-agent/skillContract";
import { advanceAgentRun, type AgentRun } from "@/lib/brief-agent/runState";
import { REFERENCE_INFLUENCE_SKILL } from "@/lib/brief-agent/skills/referenceInfluence";
import { createVisualUnderstanding } from "@/lib/brief-agent/visualUnderstanding";
import { getReferenceInfluence } from "@/lib/pipeline/strength";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import type {
  AgentMessage,
  BriefAgentAction,
  BriefAgentRequest,
  BriefAgentResponse,
  BriefClarification,
  BriefDraft,
  BriefGenerationEvidence,
  BriefPlan,
  BriefReferenceSnapshot,
  BriefSessionState,
} from "@/lib/brief-agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_BRIEF_AGENT_MODEL = "gemini-3.1-flash-lite";
const MAX_MESSAGE_COUNT = 24;
const MAX_MODEL_MESSAGE_COUNT = 10;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_MODEL_MESSAGE_CHARS = 700;
const MAX_FINAL_PROMPT_CHARS = 4_000;
const MAX_MODEL_PROMPT_MEMORY_CHARS = 1_000;
const MAX_REFERENCE_READ_CHARS = 650;
const MAX_SESSION_TEXT_CHARS = 900;
const MAX_VISUAL_FACTS = 5;
const MAX_GENERATION_EVIDENCE = 6;
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
  };
}

function formatAgentReply(draft: BriefDraft) {
  const lines = draft.reply.trim() ? [draft.reply] : [];
  if (draft.action === "ask" || draft.clarification.needed) {
    draft.clarification.questions.forEach((question) => {
      lines.push(question);
    });
  }
  return lines.join("\n") || "Done.";
}

function latestUserText(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].text.trim();
  }
  return "";
}

function isCreativeBrief(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|test|hellow)[\s?.!]*$/i.test(normalized)) {
    return false;
  }
  if (/^(what|how|why|when|where|who|can you|could you|do you|are you|is this|does this)\b/i.test(normalized)) {
    return false;
  }
  return /\b(create|make|generate|draft|compose|turn|change|replace|remove|add|use|make it|style|shot|portrait|product|scene|background|lighting|camera|angle|pose|render|image|frame|edit|transform|upscale)\b/i
    .test(normalized);
}

function isCreativeFollowUp(text: string, session: BriefSessionState) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const hasTarget = !!session.selectedDirection || !!session.lastDraftPrompt || session.directions.length > 0;
  if (!hasTarget) return false;
  return /^(do|use|choose|pick|go with|continue|run|draft|generate)\b.*\b(option\s*\d+|that|this|it|one|direction|draft)\b/i.test(normalized)
    || /^option\s*\d+$/i.test(normalized)
    || /^(yes|ok|okay|cool),?\s*(do|use|draft|generate|continue)\b/i.test(normalized)
    || /^(make|change|adjust|refine|improve|add|remove|keep|try)\b/i.test(normalized)
    || /^(use|apply)\b.*\b(feedback|review|liked|disliked|preference)\b/i.test(normalized);
}

function shouldProduceDraft(text: string, session: BriefSessionState) {
  return isCreativeBrief(text) || isCreativeFollowUp(text, session);
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
    hasPromptDraft: Boolean(message.promptArtifact),
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
  const action: BriefAgentAction = clarification.needed
    ? "ask"
    : requestedAction === "draft" && !shouldDraft
    ? fallbackActionForText(latestText, false)
    : requestedAction;
  const finalPrompt = action !== "draft" || clarification.needed
    ? ""
    : stringValue(value.finalPrompt, fallback.finalPrompt).slice(0, MAX_FINAL_PROMPT_CHARS);
  const status = action === "ask"
    ? "needs_clarification"
    : action === "draft" && finalPrompt
    ? "draft"
    : "empty";
  const session = sessionValue(value.session, fallback.session);
  const nextSession: BriefSessionState = {
    ...session,
    lastDraftPrompt: finalPrompt || session.lastDraftPrompt,
    unresolvedQuestions: action === "ask" ? clarification.questions : session.unresolvedQuestions,
  };

  return {
    ...fallback,
    status,
    action: finalPrompt ? "draft" : action === "draft" ? "talk" : action,
    reply: stringValue(value.reply, fallback.reply),
    clarification,
    plan: planValue(value.plan, fallback.plan),
    session: nextSession,
    finalPrompt,
    warnings: stringArray(value.warnings, fallback.warnings),
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

  return [
    "You are CafeHTML Brief Agent, a prompt-planning agent for modular image generation.",
    "Work like a terse coding agent in a terminal: answer directly, clarify briefly, draft only when the user gives a creative image direction, and never execute generation yourself.",
    "Choose exactly one action for the latest user message: talk, inspect, plan, ask, or draft.",
    "talk = casual conversation or quick status; inspect = answer how the current references/UI/agent state works; plan = outline an approach or creative direction; ask = one missing detail blocks the next useful move; draft = produce a generation-ready image prompt.",
    "Action behavior:",
    "- talk: reply in one or two short natural lines. No prompt draft language, no planning template.",
    "- inspect: explain what you can infer from the current references, model state, command state, or conversation. Be factual and compact.",
    "- plan: give 2-4 concrete numbered options or steps. Each option should be usable in a follow-up like 'do option 2'. Store those options in session.directions.",
    "- ask: ask the smallest number of blocking questions, ideally one. Store those questions in session.unresolvedQuestions.",
    "- draft: produce one generation-ready prompt in finalPrompt and a short reply that says what was drafted. Store finalPrompt in session.lastDraftPrompt.",
    "For follow-ups like 'do option 2', 'use that', 'make it moodier', or 'continue', resolve the target from session, conversation, and the last plan before choosing action.",
    "Maintain session.projectIntent as the user's current creative objective. Maintain session.selectedDirection when a plan option is chosen. Keep session.notes as short durable constraints only.",
    "Do not introduce yourself. Do not say you are ready to help. Do not greet unless the user greets first, and then keep it to one short line.",
    "If the latest user message is casual chat, a greeting, a status question, or a question about the UI/agent, use action talk or inspect. Do not produce finalPrompt.",
    "Use action draft and produce finalPrompt only when the latest user message asks to create, generate, compose, edit, transform, or otherwise describes the desired image/frame.",
    "If action is talk, inspect, plan, or ask, finalPrompt must be an empty string.",
    "Recent generation evidence is an on-demand inspection catalog. Recency 1 means the latest generation.",
    "User feedback is authoritative evidence of preference. visualReview is an automatic quality review. visionObservation is the result of an explicit on-demand image inspection.",
    "When visionObservation is present, you may answer from its visible evidence and comparison, and you must identify the generation or generations used.",
    "When asked what the user liked, disliked, wants preserved, or wants changed, answer from userFeedback and identify the generation used.",
    "When asked to compare generations, contrast only generations present in the catalog. Separate user preference from visual-review findings.",
    "When revising from feedback, preserve items in keep, address items in change and the note, and use visual-review suggestions only when they do not conflict with user feedback.",
    "If the requested generation or evidence is absent, say what is unavailable instead of inventing it.",
    `Skill contract: ${JSON.stringify(BRIEF_AGENT_SKILL_CONTRACT)}`,
    `Reference influence skill:\n${REFERENCE_INFLUENCE_SKILL}`,
    "First build a visual understanding from the references, then draft from that understanding. The raw user text is an instruction, not the final prompt.",
    "Treat the latest user instruction as the creative brief. Use reference data to support that brief, not to automatically freeze the image.",
    "Use compact visual understanding as visual evidence. The visual scan tells you what is visible; the influence value tells you how much that evidence should shape the composed finalPrompt.",
    "Use influence only for private prompt composition. Never include influence labels, strength, control axis, slider, percentage, or other UI mechanics in finalPrompt.",
    "Do not invent subject features, wardrobe details, stage elements, camera view, lighting, palette, or style details that are not requested by the user or present in the visual scan.",
    "When the visual scan is incomplete, use safe general language or ask only if the missing detail blocks a useful draft.",
    "The finalPrompt should be one clean generation brief. Merge user intent, visual scans, roles, and influence into natural visual language; do not append checklist-like rule blocks.",
    "If the user asks for a small edit and the relevant reference influence is LOCKED or CLOSE, keep the rest stable through natural prompt wording.",
    "If the user asks for transformation, exploration, or a campaign concept, let FREE, LOOSE, or BALANCED references participate more flexibly.",
    "Ask concise clarification questions only when the request lacks a necessary target or choosing one would likely betray the user's intent.",
    "If the latest message is an image direction and a reasonable image can be drafted, produce a concise finalPrompt instead of asking.",
    "Return JSON only with this shape:",
    "{\"action\":\"talk|inspect|plan|ask|draft\",\"reply\":\"string\",\"clarification\":{\"needed\":boolean,\"reason\":string|null,\"questions\":[\"string\"]},\"plan\":{\"intent\":\"string\",\"subjectPolicy\":\"string\",\"scenePolicy\":\"string\",\"stylePolicy\":\"string\"},\"session\":{\"projectIntent\":\"string\",\"selectedDirection\":\"string\",\"directions\":[\"string\"],\"lastDraftPrompt\":\"string\",\"unresolvedQuestions\":[\"string\"],\"notes\":[\"string\"]},\"finalPrompt\":\"string\",\"warnings\":[\"string\"],\"readyToExecute\":false}",
    "",
    `Latest user instruction: ${JSON.stringify(latestInstruction)}`,
    `Latest message is creative image direction: ${JSON.stringify(shouldDraft)}`,
    `Session state: ${JSON.stringify(session)}`,
    `Compact visual understanding: ${JSON.stringify(visualUnderstanding)}`,
    `Compact reference reads: ${JSON.stringify(references)}`,
    `Recent generation evidence: ${JSON.stringify(generations)}`,
    `Recent conversation: ${JSON.stringify(conversation)}`,
    `Current draft state: ${JSON.stringify({
      action: fallback.action,
      clarification: fallback.clarification,
      plan: fallback.plan,
      warnings: fallback.warnings,
    })}`,
  ].join("\n");
}

async function createModelDraft(input: BriefAgentRequest, baseline: BriefDraft) {
  const model = process.env.BRIEF_AGENT_MODEL?.trim() || DEFAULT_BRIEF_AGENT_MODEL;
  const ai = createGoogleGenAI();
  const result = await ai.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [{ text: buildModelInstruction(input, baseline) }],
    }],
    config: {
      temperature: 0.25,
      responseMimeType: "application/json",
    },
  });
  const text = extractResponseText(result);
  const json = parseJsonObject(text);
  return {
    draft: draftFromModelJson(json, baseline),
    model,
  };
}

function describeBriefAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("billing_disabled") || lower.includes("billing to be enabled") || lower.includes("billing is disabled")) {
    return { message: "Google Cloud billing is disabled for the configured Vertex AI project. Enable billing, wait for it to propagate, then try again.", status: 403 };
  }
  if (lower.includes("token") || lower.includes("context") || lower.includes("too long") || lower.includes("request too large")) {
    return { message: "Brief agent context is still too large. Clear the agent console or reduce active references, then try again.", status: 413 };
  }
  if (lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate") || lower.includes("429")) {
    return { message: "Brief agent model quota or rate limit was hit. Wait a moment and try again.", status: 429 };
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
  try {
    const input = validateRequest(request, await request.json());
    const baseline = createBaselineDraft(input);
    const modelResult = await createModelDraft(input, baseline);
    const draft = applySkillContract(modelResult.draft);
    const run = advanceAgentRun(input.run, draft, input.referenceSnapshot);
    const isPromptRevision = input.run?.steps.at(-1)?.action.type === "request_prompt_revision";

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text: formatAgentReply(draft),
      action: draft.action,
      options: draft.action === "plan"
        ? draft.session.directions.map((direction, index) => ({
          id: `direction-${index + 1}`,
          label: direction,
          submitText: `Use option ${index + 1}: ${direction}`,
        }))
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
    const response: BriefAgentResponse = { draft, message, run, brain: "model", model: modelResult.model };
    return NextResponse.json(response);
  } catch (error) {
    const described = describeBriefAgentError(error);
    return NextResponse.json({ error: described.message }, { status: described.status });
  }
}

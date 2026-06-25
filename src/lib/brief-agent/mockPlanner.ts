import type { ModuleFile } from "@/context/ModuleContext";
import { normalizeStrength } from "@/lib/pipeline/strength";
import type {
  AgentMessage,
  BriefDraft,
  BriefPlan,
  BriefReferenceRole,
  BriefReferenceSnapshot,
  ReferenceObservation,
} from "./types";

function roleOf(file: ModuleFile): BriefReferenceRole {
  const role = String(file.mode || "").toUpperCase();
  if (role === "SUBJECT" || role === "SCENE" || role === "STYLE") return role;
  return "UNASSIGNED";
}

function visibleModuleFiles(files: ModuleFile[]) {
  return files.filter((file) => file.eye !== false && file.url && !file.folder);
}

export function fingerprintModuleFiles(files: ModuleFile[]) {
  return visibleModuleFiles(files)
    .map((file) => [
      file.uuid || file.id,
      file.mode,
      file.label || file.name,
      file.strength,
      file.eye === false ? "hidden" : "visible",
    ].join(":"))
    .join("|");
}

function observationForFile(file: ModuleFile): ReferenceObservation {
  const role = roleOf(file);
  const label = file.label || file.name || "UNLABELED";
  const strength = normalizeStrength(file.strength);

  if (role === "SUBJECT") {
    return {
      imageId: file.uuid || String(file.id),
      role,
      label,
      strength,
      facts: [`Subject reference labeled ${label}`],
      mustPreserve: ["identity/type", "shape", "wardrobe/materials", "distinctive details"],
      canChange: ["pose", "expression", "action", "orientation"],
      mustAvoid: ["new identity", "new object type", "using subject background as scene"],
    };
  }

  if (role === "SCENE") {
    return {
      imageId: file.uuid || String(file.id),
      role,
      label,
      strength,
      facts: [`Scene reference labeled ${label}`],
      mustPreserve: ["event/location", "background", "scale", "lighting direction", "visible anchors"],
      canChange: ["crop", "framing", "lens feel", "modest alternate shot"],
      mustAvoid: ["different event", "redesigned location", "unrelated subject"],
    };
  }

  if (role === "STYLE") {
    return {
      imageId: file.uuid || String(file.id),
      role,
      label,
      strength,
      facts: [`Style reference labeled ${label}`],
      mustPreserve: ["medium", "palette", "texture", "lighting mood", "finish"],
      canChange: ["style intensity"],
      mustAvoid: ["copying style image content", "using style background", "importing style composition"],
    };
  }

  return {
    imageId: file.uuid || String(file.id),
    role,
    label,
    strength,
    facts: [`Unassigned reference labeled ${label}`],
    mustPreserve: ["useful visual context"],
    canChange: ["supporting interpretation"],
    mustAvoid: ["overriding Subject, Scene, or Style modules"],
  };
}

function buildPlan(observations: ReferenceObservation[], userPrompt: string): BriefPlan {
  const hasSubject = observations.some((item) => item.role === "SUBJECT");
  const hasScene = observations.some((item) => item.role === "SCENE");
  const hasStyle = observations.some((item) => item.role === "STYLE");

  return {
    intent: userPrompt || "Draft a generation brief from the active module references.",
    subjectPolicy: hasSubject
      ? "Use Subject modules only for identity/type and allowed pose/action changes."
      : "No Subject module is active; do not invent a specific main subject unless the user asks.",
    scenePolicy: hasScene
      ? "Use Scene modules for background, event, environment, camera, and visible anchors."
      : "No Scene module is active; keep background choices conservative unless the user asks.",
    stylePolicy: hasStyle
      ? "Use Style modules only for rendering treatment, never content or background."
      : "No Style module is active; use a neutral rendering style unless the user asks.",
  };
}

function buildFinalPrompt(observations: ReferenceObservation[], plan: BriefPlan) {
  const preserve = observations.flatMap((item) => item.mustPreserve);
  const avoid = observations.flatMap((item) => item.mustAvoid);
  const roles = observations.map((item) => `${item.role}:${item.label}`).join(", ") || "NO ACTIVE MODULES";

  return [
    plan.intent,
    `Use modules: ${roles}.`,
    `Preserve: ${Array.from(new Set(preserve)).join(", ") || "module role boundaries"}.`,
    `Avoid: ${Array.from(new Set(avoid)).join(", ") || "unrequested changes"}.`,
    "Show the final prompt to the user before generation.",
  ].join("\n");
}

function buildClarificationQuestions(observations: ReferenceObservation[]) {
  const roles = new Set(observations.map((item) => item.role));
  const questions: string[] = [];

  if (!observations.length) {
    return ["What do you want to make?", "Should I wait for module references before drafting?"];
  }

  if (roles.has("SUBJECT")) {
    questions.push("For the Subject, should I keep the pose locked, adjust it slightly, or create a new action?");
  }

  if (roles.has("SCENE")) {
    questions.push("For the Scene, should I preserve the exact view, reframe it, or make an alternate shot of the same event?");
  }

  if (roles.has("STYLE")) {
    questions.push("For the Style, should the visual treatment be subtle, balanced, or strong?");
  }

  if (!questions.length) {
    questions.push("Which active reference should lead the brief?");
  }

  return questions.slice(0, 3);
}

function userPromptIsClear(userPrompt: string) {
  const text = userPrompt.trim();
  if (!text) return false;
  if (/\b(keep|change|turn|add|remove|preserve|reframe|replace|insert|swap|make it|use the|do not|don't)\b/i.test(text)) {
    return true;
  }
  if (text.length >= 36 && /\b(make|create|generate|render|compose)\b/i.test(text)) {
    return true;
  }
  return false;
}

export function createReferenceSnapshot(files: ModuleFile[]): BriefReferenceSnapshot {
  const observations = visibleModuleFiles(files).map(observationForFile);
  const createdAt = new Date().toISOString();
  return {
    id: `ref-snapshot-${createdAt}`,
    createdAt,
    sourceFingerprint: fingerprintModuleFiles(files),
    observations,
  };
}

function latestUserText(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].text.trim();
  }
  return "";
}

export function createMockBriefDraft(
  referenceSnapshot: BriefReferenceSnapshot,
  messages: AgentMessage[] = [],
): BriefDraft {
  const trimmedPrompt = latestUserText(messages);
  const observations = referenceSnapshot.observations;
  const plan = buildPlan(observations, trimmedPrompt);
  const needsClarification = !userPromptIsClear(trimmedPrompt);
  const clarificationQuestions = needsClarification ? buildClarificationQuestions(observations) : [];
  const finalPrompt = needsClarification ? "" : buildFinalPrompt(observations, plan);

  return {
    id: "mock-brief-draft",
    status: observations.length || trimmedPrompt
      ? needsClarification ? "needs_clarification" : "draft"
      : "empty",
    reply: needsClarification
      ? "I need one direction before drafting the final prompt."
      : observations.length
      ? `I found ${observations.length} active module reference${observations.length === 1 ? "" : "s"} and drafted a role-safe brief.`
      : "Add module references or type an instruction to start a brief.",
    messages,
    referenceSnapshot,
    observations,
    clarification: {
      needed: needsClarification,
      reason: needsClarification ? "The instruction is empty or too broad for a reliable prompt draft." : null,
      questions: clarificationQuestions,
    },
    plan,
    finalPrompt,
    warnings: observations.length ? [] : ["No active module references found."],
    readyToExecute: false,
  };
}

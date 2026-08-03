import type {
  BriefAgentAction,
  BriefDraft,
  BriefReferenceSnapshot,
} from "./types";

export type AgentRunStatus =
  | "planning"
  | "awaiting_approval"
  | "generating"
  | "ready"
  | "completed"
  | "failed";

export type AgentRunAction =
  | { type: "answer"; text: string }
  | { type: "inspect"; text: string }
  | { type: "propose_directions"; directions: string[] }
  | { type: "ask"; questions: string[] }
  | { type: "draft_prompt"; prompt: string }
  | {
    type: "request_prompt_revision";
    generationId: string;
    summary: string;
    issues: string[];
    suggestions: string[];
  }
  | { type: "revise_prompt"; prompt: string; previousPrompt: string }
  | { type: "request_generation"; prompt: string }
  | {
    type: "observe_generation";
    outcome: "succeeded" | "blocked" | "failed";
    generationIds: string[];
    message: string;
  }
  | {
    type: "review_generation";
    generationId: string;
    scores: {
      prompt: number;
      subject: number;
      scene: number;
      style: number;
      quality: number;
    };
    summary: string;
    issues: string[];
    suggestions: string[];
  }
  | { type: "finish"; text: string };

export type AgentRunStep = {
  id: string;
  createdAt: string;
  action: AgentRunAction;
  source: "planner" | "system";
};

export type AgentRun = {
  id: string;
  version: 1;
  goal: string;
  status: AgentRunStatus;
  referenceFingerprint: string;
  selectedDirection: string;
  currentPrompt: string;
  steps: AgentRunStep[];
  generationIds: string[];
  generationAttempts: number;
  budget: {
    maxSteps: number;
    maxGenerations: number;
  };
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_MAX_GENERATIONS = 1;

function actionFromDraft(draft: BriefDraft, previous: AgentRun | null | undefined): AgentRunAction {
  switch (draft.action) {
    case "inspect":
      return { type: "inspect", text: draft.reply };
    case "plan":
      return { type: "propose_directions", directions: draft.session.directions };
    case "ask":
      return { type: "ask", questions: draft.clarification.questions };
    case "draft":
      if (previous?.steps.at(-1)?.action.type === "request_prompt_revision") {
        return {
          type: "revise_prompt",
          prompt: draft.finalPrompt,
          previousPrompt: previous.currentPrompt,
        };
      }
      return { type: "draft_prompt", prompt: draft.finalPrompt };
    case "talk":
    default:
      return { type: "answer", text: draft.reply };
  }
}

function statusFromAction(action: BriefAgentAction): AgentRunStatus {
  if (action === "draft") return "awaiting_approval";
  if (action === "ask") return "planning";
  return "ready";
}

export function advanceAgentRun(
  previous: AgentRun | null | undefined,
  draft: BriefDraft,
  snapshot: BriefReferenceSnapshot,
): AgentRun {
  const now = new Date().toISOString();
  const referenceChanged = previous?.referenceFingerprint !== snapshot.sourceFingerprint;
  const revisionPending = previous?.steps.at(-1)?.action.type === "request_prompt_revision";
  const previousRunFinished = previous?.status === "completed" || previous?.status === "failed";
  const shouldStartFreshRun = referenceChanged || (previousRunFinished && !revisionPending);
  const base: AgentRun = previous && !shouldStartFreshRun
    ? previous
    : {
      id: crypto.randomUUID(),
      version: 1,
      goal: draft.session.projectIntent || draft.plan.intent,
      status: "planning",
      referenceFingerprint: snapshot.sourceFingerprint,
      selectedDirection: "",
      currentPrompt: "",
      steps: [],
      generationIds: [],
      generationAttempts: 0,
      budget: {
        maxSteps: DEFAULT_MAX_STEPS,
        maxGenerations: DEFAULT_MAX_GENERATIONS,
      },
      createdAt: now,
      updatedAt: now,
    };

  const step: AgentRunStep = {
    id: crypto.randomUUID(),
    createdAt: now,
    source: "planner",
    action: actionFromDraft(draft, previous),
  };
  const steps = [...base.steps, step].slice(-base.budget.maxSteps);

  return {
    ...base,
    goal: draft.session.projectIntent || base.goal,
    status: statusFromAction(draft.action),
    referenceFingerprint: snapshot.sourceFingerprint,
    selectedDirection: draft.session.selectedDirection || base.selectedDirection,
    currentPrompt: draft.finalPrompt || base.currentPrompt,
    steps,
    updatedAt: now,
  };
}

export function requestAgentPromptRevision(
  run: AgentRun,
  review: {
    generationId: string;
    summary: string;
    issues: string[];
    suggestions: string[];
  },
): AgentRun {
  const now = new Date().toISOString();
  const step: AgentRunStep = {
    id: crypto.randomUUID(),
    createdAt: now,
    source: "system",
    action: { type: "request_prompt_revision", ...review },
  };
  return {
    ...run,
    status: "planning",
    budget: {
      ...run.budget,
      maxGenerations: Math.min(3, Math.max(run.budget.maxGenerations, run.generationAttempts + 1)),
    },
    steps: [...run.steps, step].slice(-run.budget.maxSteps),
    updatedAt: now,
  };
}

export type GenerationApprovalResult =
  | { allowed: true; run: AgentRun }
  | { allowed: false; run: AgentRun; reason: string };

export function requestAgentGeneration(run: AgentRun, prompt: string): GenerationApprovalResult {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return { allowed: false, run, reason: "The approved prompt is empty." };
  }
  if (run.status !== "awaiting_approval") {
    return { allowed: false, run, reason: "This run is not waiting for prompt approval." };
  }
  if (normalizedPrompt !== run.currentPrompt.trim()) {
    return { allowed: false, run, reason: "This is not the current prompt for the run." };
  }
  if (run.referenceFingerprint === "") {
    return { allowed: false, run, reason: "The generation has no reference snapshot." };
  }
  if (run.generationAttempts >= run.budget.maxGenerations) {
    return { allowed: false, run, reason: "This run has reached its generation budget." };
  }

  const now = new Date().toISOString();
  const step: AgentRunStep = {
    id: crypto.randomUUID(),
    createdAt: now,
    source: "system",
    action: { type: "request_generation", prompt: normalizedPrompt },
  };
  return {
    allowed: true,
    run: {
      ...run,
      status: "generating",
      currentPrompt: normalizedPrompt,
      generationAttempts: run.generationAttempts + 1,
      steps: [...run.steps, step].slice(-run.budget.maxSteps),
      updatedAt: now,
    },
  };
}

export function observeAgentGeneration(
  run: AgentRun,
  observation: {
    outcome: "succeeded" | "blocked" | "failed";
    generationIds: string[];
    message: string;
  },
): AgentRun {
  const now = new Date().toISOString();
  const generationIds = Array.from(new Set([...run.generationIds, ...observation.generationIds]));
  const step: AgentRunStep = {
    id: crypto.randomUUID(),
    createdAt: now,
    source: "system",
    action: { type: "observe_generation", ...observation },
  };
  return {
    ...run,
    status: observation.outcome === "succeeded" ? "completed" : "failed",
    generationIds,
    steps: [...run.steps, step].slice(-run.budget.maxSteps),
    updatedAt: now,
  };
}

export function recoverInterruptedAgentRun(run: AgentRun): AgentRun {
  if (run.status !== "generating") return run;
  return observeAgentGeneration(run, {
    outcome: "failed",
    generationIds: [],
    message: "Generation was interrupted before the run completed.",
  });
}

export function observeAgentReview(
  run: AgentRun,
  review: {
    generationId: string;
    scores: {
      prompt: number;
      subject: number;
      scene: number;
      style: number;
      quality: number;
    };
    summary: string;
    issues: string[];
    suggestions: string[];
  },
): AgentRun {
  const now = new Date().toISOString();
  const step: AgentRunStep = {
    id: crypto.randomUUID(),
    createdAt: now,
    source: "system",
    action: { type: "review_generation", ...review },
  };
  return {
    ...run,
    steps: [...run.steps, step].slice(-run.budget.maxSteps),
    updatedAt: now,
  };
}

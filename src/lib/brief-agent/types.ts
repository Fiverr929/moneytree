import type { AgentRun } from "./runState";

export type BriefReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";
export type BriefAgentAction = "talk" | "inspect" | "plan" | "ask" | "draft";

export type AgentAppAction =
  | { id: string; type: "project.rename"; name: string }
  | { id: string; type: "reference.rename"; imageId: string; name: string }
  | { id: string; type: "reference.set_role"; imageId: string; role: BriefReferenceRole }
  | { id: string; type: "reference.set_strength"; imageId: string; strength: number }
  | { id: string; type: "reference.set_visibility"; imageId: string; visible: boolean }
  | { id: string; type: "reference.move"; imageId: string; folder: string | null }
  | { id: string; type: "reference.duplicate"; imageId: string }
  | { id: string; type: "reference.remove_copy"; imageId: string }
  | { id: string; type: "folder.create"; folder: string }
  | { id: string; type: "folder.remove"; folder: string };

export type AgentAppEvent = {
  id: string;
  runId: string;
  actor: "agent" | "user" | "system";
  action: AgentAppAction;
  inverse: AgentAppAction | null;
  status: "completed" | "failed" | "undone";
  summary: string;
  createdAt: string;
  undoneAt?: string;
  undoOf?: string;
  error?: string;
};

export type AgentActionProposalStatus =
  | "pending"
  | "executing"
  | "completed"
  | "partially_failed"
  | "failed"
  | "rejected"
  | "stale";

export type AgentActionProposal = {
  id: string;
  runId: string;
  projectId: number;
  status: AgentActionProposalStatus;
  actions: AgentAppAction[];
  createdAt: string;
  resolvedAt?: string;
  error?: string;
};

export type CafeWorkspaceSnapshot = {
  project: { id: number; name: string };
  folders: Array<{ id: string; name: string }>;
  references: Array<{
    position: number;
    imageId: string;
    name: string;
    label: string;
    role: BriefReferenceRole;
    strength: number;
    visible: boolean;
    folder: string | null;
  }>;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  createdAt: string;
  action?: BriefAgentAction;
  options?: Array<{
    id: string;
    label: string;
    submitText: string;
  }>;
  decisionFlow?: AgentDecisionFlow;
  promptArtifact?: {
    id: string;
    title: string;
    prompt: string;
    sourceDraftId?: string;
    sourceFingerprint?: string;
    refCount?: number;
    previousPrompt?: string;
  };
  scenePlan?: {
    plan: ScenePlan;
    model: string;
    referenceFingerprint: string;
    status: "pending" | "executing" | "completed" | "rejected" | "failed";
  };
  toolProposal?: AgentActionProposal;
  context?: {
    refCount: number;
  };
  media?: Array<{
    kind: "reference" | "generation";
    imageId: string;
    label: string;
    event: "uploaded" | "mentioned" | "generated";
  }>;
  trace?: {
    kind: "generation";
    status: "completed" | "blocked" | "failed";
    model: string;
    aspectRatio: string;
    resolution: string | null;
    thinkingLevel: string | null;
    durationMs: number;
    prompt: string;
    resultCount: number;
    references: Array<{
      imageId: string;
      label: string;
      role: string;
    }>;
  };
};

export type ReferenceObservation = {
  imageId: string;
  role: BriefReferenceRole;
  label: string;
  strength: number;
  visualRead: string;
  readSource?: "local" | "vision";
};

export type BriefReferenceSnapshot = {
  id: string;
  createdAt: string;
  sourceFingerprint: string;
  observations: ReferenceObservation[];
};

export type VisualRoleUnderstanding = {
  present: boolean;
  labels: string[];
  facts: string[];
  anchors: string[];
  allowedChanges: string[];
  avoid: string[];
};

export type VisualUnderstanding = {
  id: string;
  createdAt: string;
  sourceFingerprint: string;
  subject: VisualRoleUnderstanding;
  scene: VisualRoleUnderstanding;
  style: VisualRoleUnderstanding;
  unassigned: VisualRoleUnderstanding;
  continuity: {
    anchors: string[];
    changeBoundaries: string[];
    storySignals: string[];
  };
  uncertainties: string[];
};

export type BriefPlan = {
  intent: string;
  subjectPolicy: string;
  scenePolicy: string;
  stylePolicy: string;
};

export type BriefClarification = {
  needed: boolean;
  reason: string | null;
  questions: string[];
};

export type BriefSkillCheck = {
  id: string;
  status: "pass" | "warning";
  message: string;
};

export type AgentDecisionOption = {
  id: string;
  label: string;
  description?: string;
};

export type AgentDecisionQuestion = {
  id: string;
  prompt: string;
  options: AgentDecisionOption[];
  allowCustom: boolean;
  dependsOnQuestionId?: string;
  dependsOnOptionId?: string;
};

export type AgentDecisionAnswer = {
  questionId: string;
  optionId: string | null;
  value: string;
  custom: boolean;
};

export type AgentDecisionFlow = {
  id: string;
  title: string;
  sourceFingerprint: string;
  submitIntent: "reply" | "draft" | "generate";
  questions: AgentDecisionQuestion[];
  answers?: AgentDecisionAnswer[];
  status?: "active" | "submitted" | "stale";
};

export type BriefSessionState = {
  projectIntent: string;
  selectedDirection: string;
  directions: string[];
  lastDraftPrompt: string;
  unresolvedQuestions: string[];
  notes: string[];
};

export type AgentMemoryScope = "user" | "project" | "session";
export type AgentMemoryKind = "preference" | "constraint" | "decision" | "correction" | "feedback" | "summary";

export type AgentMemoryItem = {
  id: string;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  text: string;
  normalizedText: string;
  projectId: number | null;
  sessionId: string | null;
  source: "explicit" | "conversation" | "session" | "feedback";
  sourceId?: string | null;
  confidence: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  useCount?: number;
  cloudSyncedAt?: string | null;
};

export type BriefAgentMemory = Pick<AgentMemoryItem, "id" | "scope" | "kind" | "text" | "confidence" | "pinned">;

export type BriefBoardType =
  | "MOOD"
  | "LOOKBOOK"
  | "WORLD"
  | "CUSTOM"
  | "CHARACTER"
  | "SETTING"
  | "OBJECT"
  | "CREATURE"
  | "WARDROBE"
  | "TREATMENT";

export type VisualBibleRules = {
  preserve: string[];
  flexible: string[];
  avoid: string[];
  unknown: string[];
};

export type VisualBible = {
  id: string;
  version: number;
  status: "draft" | "approved" | "stale";
  sourceFingerprint: string;
  summary: string;
  rules: VisualBibleRules;
  draftedAt: string;
  approvedAt?: string;
};

export type BriefBoardContext = {
  id: string;
  type: BriefBoardType;
  name: string;
  purpose: string;
  active: boolean;
  sourceFingerprint: string;
  images: Array<{
    imageId: string;
    label: string;
    visualRead: string;
  }>;
  visualBible?: VisualBible;
};

export type VisualBibleDraftRequest = {
  board: BriefBoardContext;
  previous?: VisualBible | null;
};

export type VisualBibleDraftResponse = {
  bible: VisualBible;
  model: string;
};

export type ScenePlanShot = {
  index: number;
  title: string;
  purpose: string;
  action: string;
  camera: string;
  continuity: string[];
  prompt: string;
};

export type ScenePlan = {
  id: string;
  title: string;
  intent: string;
  sourcePrompt: string;
  shotCount: number;
  continuity: {
    subject: string[];
    world: string[];
    style: string[];
    progression: string;
  };
  shots: ScenePlanShot[];
};

export type ScenePlanRequest = {
  prompt: string;
  shotCount: number;
  referenceSnapshot: BriefReferenceSnapshot;
  briefBoards?: BriefBoardContext[];
};

export type ScenePlanResponse = {
  plan: ScenePlan;
  model: string;
};

export type BriefDraft = {
  id: string;
  status: "empty" | "needs_clarification" | "draft";
  action: BriefAgentAction;
  reply: string;
  messages: AgentMessage[];
  referenceSnapshot: BriefReferenceSnapshot;
  observations: ReferenceObservation[];
  visualUnderstanding: VisualUnderstanding;
  clarification: BriefClarification;
  decisionQuestions: AgentDecisionQuestion[];
  plan: BriefPlan;
  session: BriefSessionState;
  finalPrompt: string;
  warnings: string[];
  skillChecks: BriefSkillCheck[];
  readyToExecute: boolean;
};

export type BriefAgentRequest = {
  referenceSnapshot: BriefReferenceSnapshot;
  briefBoards?: BriefBoardContext[];
  messages: AgentMessage[];
  session?: BriefSessionState | null;
  run?: AgentRun | null;
  generations?: BriefGenerationEvidence[];
  workspace?: CafeWorkspaceSnapshot | null;
  memories?: BriefAgentMemory[];
  iterationBrief?: IterationBrief | null;
};

export type IterationConstraintKind = "keep" | "change" | "avoid";

export type IterationConstraint = {
  id: string;
  kind: IterationConstraintKind;
  text: string;
  source: "user" | "feedback" | "comparison" | "agent";
  sourceGenerationIds: string[];
  confidence: "explicit" | "inferred";
  status: "active" | "superseded" | "confirmed";
  createdAt: string;
};

export type IterationBrief = {
  projectId: number;
  anchorGenerationId: string | null;
  parentGenerationId: string | null;
  keep: IterationConstraint[];
  change: IterationConstraint[];
  avoid: IterationConstraint[];
  rejectedGenerationIds: string[];
  selectedDirection: string | null;
  decisionAnswers: AgentDecisionAnswer[];
  referenceFingerprint: string | null;
  version: number;
  updatedAt: string;
};

export type BriefGenerationEvidence = {
  generationId: string;
  recency: number;
  anchored?: boolean;
  createdAt: string | null;
  prompt: string;
  model: string | null;
  visualReview: {
    summary: string;
    issues: string[];
    suggestions: string[];
    scores: {
      prompt: number;
      subject: number;
      scene: number;
      style: number;
      quality: number;
    };
  } | null;
  userFeedback: {
    reaction: "like" | "mixed" | "dislike";
    keep: string[];
    change: string[];
    note: string;
    remember?: boolean;
  } | null;
  visionObservation?: {
    visualRead: string;
    comparison: string | null;
    inspectedAt: string;
  } | null;
};

export type GenerationInspectionRequest = {
  images: Array<{
    generationId: string;
    dataUrl: string;
    prompt: string;
  }>;
};

export type GenerationInspectionResponse = {
  model: string;
  observations: Array<{
    generationId: string;
    visualRead: string;
  }>;
  comparison: string | null;
};

export type BriefAgentResponse = {
  draft: BriefDraft;
  message: AgentMessage;
  run: AgentRun;
  brain: "model";
  model: string | null;
  appActions: AgentAppAction[];
};

export type BriefReferenceImageInput = {
  imageId: string;
  role: BriefReferenceRole;
  label: string;
  strength: number;
  dataUrl: string;
};

export type BriefReferenceReadRequest = {
  sourceFingerprint: string;
  images: BriefReferenceImageInput[];
};

export type BriefReferenceReadResponse = {
  snapshot: BriefReferenceSnapshot;
  brain: "vision";
  model: string;
};

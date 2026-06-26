export type BriefReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  createdAt: string;
  promptArtifact?: {
    id: string;
    title: string;
    prompt: string;
    sourceDraftId?: string;
    sourceFingerprint?: string;
    refCount?: number;
  };
  context?: {
    refCount: number;
  };
};

export type ReferenceObservation = {
  imageId: string;
  role: BriefReferenceRole;
  label: string;
  strength: number;
  facts: string[];
  mustPreserve: string[];
  canChange: string[];
  mustAvoid: string[];
  readSource?: "mock" | "vision";
};

export type BriefReferenceSnapshot = {
  id: string;
  createdAt: string;
  sourceFingerprint: string;
  observations: ReferenceObservation[];
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
  status: "pass" | "repaired" | "warning";
  message: string;
};

export type BriefDraft = {
  id: string;
  status: "empty" | "needs_clarification" | "draft";
  reply: string;
  messages: AgentMessage[];
  referenceSnapshot: BriefReferenceSnapshot;
  observations: ReferenceObservation[];
  clarification: BriefClarification;
  plan: BriefPlan;
  finalPrompt: string;
  warnings: string[];
  skillChecks: BriefSkillCheck[];
  readyToExecute: boolean;
};

export type BriefAgentRequest = {
  referenceSnapshot: BriefReferenceSnapshot;
  messages: AgentMessage[];
};

export type BriefAgentResponse = {
  draft: BriefDraft;
  message: AgentMessage;
  brain: "model" | "mock";
  model: string | null;
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

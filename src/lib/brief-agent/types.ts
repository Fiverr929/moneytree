export type BriefReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  createdAt: string;
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
  readyToExecute: boolean;
};

export type BriefAgentRequest = {
  referenceSnapshot: BriefReferenceSnapshot;
  messages: AgentMessage[];
};

export type BriefAgentResponse = {
  draft: BriefDraft;
  message: AgentMessage;
};

import type {
  BriefGenerationEvidence,
  BriefReferenceSnapshot,
} from "./types";

export type AgentInsightType = "defect_candidate" | "product_idea" | "generation_feedback";
export type AgentInsightStatus = "new" | "confirmed" | "planned" | "fixed" | "verified" | "dismissed";
export type AgentInsightStatusEvent = {
  id: string;
  from: AgentInsightStatus | null;
  to: AgentInsightStatus;
  actor: "harness" | "user" | "coding_agent" | "system";
  evidence: string;
  createdAt: string;
};

export type AgentInsight = {
  id: string;
  schemaVersion: 1;
  projectId: number;
  type: AgentInsightType;
  status: AgentInsightStatus;
  statusHistory?: AgentInsightStatusEvent[];
  title: string;
  expected: string;
  observed: string;
  acceptanceTest: string;
  source: {
    kind: "conversation" | "evaluation";
    sourceId: string;
    runId: string | null;
    generationIds: string[];
  };
  referenceFingerprint: string | null;
  activeReferences: Array<{
    imageId: string;
    role: string;
    label: string;
    strength: number;
  }>;
  conversationEvidence: string[];
  diagnosis: {
    text: string;
    confidence: number;
    status: "inference";
  } | null;
  createdAt: string;
  updatedAt: string;
};

export function isAgentInsight(value: unknown): value is AgentInsight {
  if (!value || typeof value !== "object") return false;
  const insight = value as Partial<AgentInsight>;
  const source = insight.source as Partial<AgentInsight["source"]> | undefined;
  return insight.schemaVersion === 1
    && typeof insight.id === "string"
    && typeof insight.projectId === "number"
    && (insight.type === "defect_candidate" || insight.type === "product_idea" || insight.type === "generation_feedback")
    && (insight.status === "new" || insight.status === "confirmed" || insight.status === "planned" || insight.status === "fixed" || insight.status === "verified" || insight.status === "dismissed")
    && typeof insight.title === "string"
    && typeof insight.expected === "string"
    && typeof insight.observed === "string"
    && typeof insight.acceptanceTest === "string"
    && !!source
    && (source.kind === "conversation" || source.kind === "evaluation")
    && typeof source.sourceId === "string"
    && Array.isArray(source.generationIds)
    && Array.isArray(insight.activeReferences)
    && Array.isArray(insight.conversationEvidence)
    && typeof insight.createdAt === "string";
}

const DEFECT_SIGNAL = /\b(issue|bug|broken|failed|failure|wrong|missing|overlooked|ignored|omitted|not working|didn'?t include|didn'?t use|why (?:did|didn'?t|wasn'?t|isn'?t))\b/i;
const IDEA_SIGNAL = /\b(idea|feature|improvement|would be helpful|should support|could support|wish|suggestion)\b/i;
const MULTI_SUBJECT_OMISSION = /\b(second|other|another|both|all)\b.{0,50}\b(subject|model|person|character|reference)\b|\b(subject|model|person|character|reference)\b.{0,50}\b(second|other|another|both|all)\b/i;

function compact(text: string, max: number) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function stableInsightId(projectId: number, kind: string, sourceId: string) {
  return `insight:${projectId}:${kind}:${sourceId}`.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

export function createConversationInsight(input: {
  projectId: number;
  runId?: string | null;
  sourceMessageId: string;
  userText: string;
  agentReply: string;
  referenceSnapshot: BriefReferenceSnapshot;
  generations: BriefGenerationEvidence[];
  createdAt?: string;
}): AgentInsight | null {
  const defect = DEFECT_SIGNAL.test(input.userText);
  const idea = IDEA_SIGNAL.test(input.userText);
  if (!defect && !idea) return null;

  const subjects = input.referenceSnapshot.observations.filter((reference) => reference.role === "SUBJECT");
  const multiSubjectOmission = defect
    && subjects.length > 1
    && MULTI_SUBJECT_OMISSION.test(input.userText);
  const type: AgentInsightType = defect ? "defect_candidate" : "product_idea";
  const now = input.createdAt || new Date().toISOString();

  return {
    id: stableInsightId(input.projectId, "conversation", input.sourceMessageId),
    schemaVersion: 1,
    projectId: input.projectId,
    type,
    status: "new",
    statusHistory: [{
      id: crypto.randomUUID(),
      from: null,
      to: "new",
      actor: "harness",
      evidence: "Captured from an explicit conversation signal.",
      createdAt: now,
    }],
    title: multiSubjectOmission
      ? "Active subject omitted from a multi-subject composition"
      : compact(input.userText, 120),
    expected: multiSubjectOmission
      ? "Every distinct active SUBJECT reference appears in the composed prompt and generated image."
      : defect
        ? "CafeHTML should satisfy the user's stated request using the captured workspace state."
        : "The proposed behavior should be evaluated against the captured product context.",
    observed: compact(input.userText, 800),
    acceptanceTest: multiSubjectOmission
      ? "With two distinct active SUBJECT references, including after hide/reactivate, the final prompt represents both and incomplete drafts are blocked."
      : defect
        ? "Reproduce under the captured reference state, implement the correction, and verify the user's expectation with a regression check."
        : "Define a user-visible completion test before scheduling implementation.",
    source: {
      kind: "conversation",
      sourceId: input.sourceMessageId,
      runId: input.runId || null,
      generationIds: input.generations.slice(0, 3).map((generation) => generation.generationId),
    },
    referenceFingerprint: input.referenceSnapshot.sourceFingerprint,
    activeReferences: input.referenceSnapshot.observations.map((reference) => ({
      imageId: reference.imageId,
      role: reference.role,
      label: reference.label,
      strength: reference.strength,
    })),
    conversationEvidence: [compact(input.userText, 1_000)],
    diagnosis: defect && input.agentReply.trim() ? {
      text: compact(input.agentReply, 1_000),
      confidence: 0.5,
      status: "inference",
    } : null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEvaluationInsight(input: {
  projectId: number;
  generationId: string;
  reaction?: "like" | "mixed" | "dislike";
  note?: string;
  issues?: string[];
  suggestions?: string[];
  subjectScore?: number;
  referenceFingerprint?: string | null;
  references?: Array<{ uuid?: string; role?: string; label?: string; strength?: number }>;
  createdAt?: string;
}): AgentInsight | null {
  const negativeReaction = input.reaction === "mixed" || input.reaction === "dislike";
  const lowSubjectScore = typeof input.subjectScore === "number" && input.subjectScore <= 2;
  const evidence = [input.note || "", ...(input.issues || [])].filter((item) => item.trim());
  if ((!negativeReaction && !lowSubjectScore) || !evidence.length) return null;

  const now = input.createdAt || new Date().toISOString();
  const subjectIssue = lowSubjectScore || evidence.some((item) => /\b(subject|character|person|model|identity)\b/i.test(item));
  return {
    id: stableInsightId(input.projectId, "evaluation", input.generationId),
    schemaVersion: 1,
    projectId: input.projectId,
    type: "generation_feedback",
    status: "new",
    statusHistory: [{
      id: crypto.randomUUID(),
      from: null,
      to: "new",
      actor: "harness",
      evidence: "Captured from evidence-backed generation feedback.",
      createdAt: now,
    }],
    title: subjectIssue ? "Generation feedback reports a subject mismatch" : "Generation feedback requires investigation",
    expected: "The generated result should match the approved prompt and active reference contract.",
    observed: compact(evidence.join("; "), 1_000),
    acceptanceTest: "Reproduce from the stored generation evidence and verify the reported mismatch no longer occurs.",
    source: {
      kind: "evaluation",
      sourceId: input.generationId,
      runId: null,
      generationIds: [input.generationId],
    },
    referenceFingerprint: input.referenceFingerprint || null,
    activeReferences: (input.references || []).map((reference) => ({
      imageId: reference.uuid || "unknown",
      role: reference.role || "UNASSIGNED",
      label: reference.label || "UNLABELED",
      strength: Number.isFinite(reference.strength) ? reference.strength! : 50,
    })),
    conversationEvidence: input.note?.trim() ? [compact(input.note, 1_000)] : [],
    diagnosis: input.suggestions?.length ? {
      text: compact(input.suggestions.join("; "), 1_000),
      confidence: 0.5,
      status: "inference",
    } : null,
    createdAt: now,
    updatedAt: now,
  };
}

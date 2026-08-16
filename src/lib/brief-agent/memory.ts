"use client";

import DB from "@/lib/db";
import type {
  AgentMemoryItem,
  AgentMemoryKind,
  AgentMemoryScope,
  BriefAgentMemory,
  BriefSessionState,
} from "./types";
import { extractMemoryCandidates, normalizeMemoryText, rankMemories } from "./memoryPolicy";

const MAX_MEMORY_ITEMS = 250;

type RememberInput = {
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  text: string;
  projectId: number | null;
  sessionId?: string | null;
  source: AgentMemoryItem["source"];
  sourceId?: string | null;
  confidence?: number;
  pinned?: boolean;
  stableKey?: string;
};

function contextFor(input: RememberInput) {
  return {
    projectId: input.scope === "user" ? null : input.projectId,
    sessionId: input.scope === "session" ? input.sessionId || null : null,
  };
}

function stableMemoryId(input: RememberInput) {
  if (!input.stableKey) return crypto.randomUUID();
  const context = contextFor(input);
  return ["memory", input.scope, context.projectId ?? "global", context.sessionId ?? "global", input.stableKey]
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]/g, "-");
}

async function pruneMemories() {
  const items = await DB.agentMemories.getAll() as AgentMemoryItem[];
  if (items.length <= MAX_MEMORY_ITEMS) return;
  const removable = items
    .filter((item) => !item.pinned)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(0, items.length - MAX_MEMORY_ITEMS);
  await DB.agentMemories.deleteMany(removable.map((item) => item.id));
}

export async function rememberAgentMemory(input: RememberInput) {
  const text = normalizeMemoryText(input.text);
  if (!text) return null;
  const normalizedText = text.toLowerCase();
  const context = contextFor(input);
  const all = await DB.agentMemories.getAll() as AgentMemoryItem[];
  const id = stableMemoryId(input);
  const existing = all.find((item) => item.id === id) || all.find((item) => (
    item.scope === input.scope
    && item.projectId === context.projectId
    && item.sessionId === context.sessionId
    && item.normalizedText === normalizedText
  ));
  const now = new Date().toISOString();
  const memory: AgentMemoryItem = {
    id: existing?.id || id,
    scope: input.scope,
    kind: input.kind,
    text,
    normalizedText,
    projectId: context.projectId,
    sessionId: context.sessionId,
    source: input.source,
    sourceId: input.sourceId || null,
    confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
    pinned: input.pinned ?? existing?.pinned ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt || null,
    useCount: existing?.useCount || 0,
  };
  await DB.agentMemories.put(memory);
  await pruneMemories();
  return memory;
}

export async function captureUserMessageMemories(
  message: string,
  projectId: number,
  sessionId: string,
  sourceId?: string,
) {
  const candidates = extractMemoryCandidates(message);
  await Promise.all(candidates.map((candidate) => rememberAgentMemory({
    ...candidate,
    projectId,
    sessionId,
    source: "conversation",
    sourceId,
  })));
  return candidates.length;
}

export async function captureSessionStateMemory(
  session: BriefSessionState,
  projectId: number,
  sessionId: string,
) {
  const writes: Promise<AgentMemoryItem | null>[] = [];
  if (session.projectIntent.trim()) {
    writes.push(rememberAgentMemory({
      scope: "session",
      kind: "summary",
      text: `Current objective: ${session.projectIntent}`,
      projectId,
      sessionId,
      source: "session",
      stableKey: "current-objective",
      confidence: 0.95,
    }));
  }
  if (session.selectedDirection.trim()) {
    writes.push(rememberAgentMemory({
      scope: "session",
      kind: "decision",
      text: `Selected direction: ${session.selectedDirection}`,
      projectId,
      sessionId,
      source: "session",
      stableKey: "selected-direction",
      confidence: 0.95,
    }));
  }
  session.notes.slice(0, 6).forEach((note) => {
    writes.push(rememberAgentMemory({
      scope: "project",
      kind: "constraint",
      text: note,
      projectId,
      source: "session",
      confidence: 0.82,
    }));
  });
  await Promise.all(writes);
}

export async function rememberGenerationFeedback(input: {
  projectId: number;
  generationId: string;
  reaction: "like" | "mixed" | "dislike";
  keep: string[];
  change: string[];
  note: string;
}) {
  const parts = [
    `Generation feedback (${input.reaction})`,
    input.keep.length ? `keep ${input.keep.join(", ")}` : "",
    input.change.length ? `change ${input.change.join(", ")}` : "",
    input.note.trim(),
  ].filter(Boolean);
  return rememberAgentMemory({
    scope: "project",
    kind: "feedback",
    text: parts.join("; "),
    projectId: input.projectId,
    source: "feedback",
    sourceId: input.generationId,
    stableKey: `feedback-${input.generationId}`,
    confidence: 1,
  });
}

export async function listAgentMemories(projectId: number, sessionId?: string | null) {
  const all = await DB.agentMemories.getAll() as AgentMemoryItem[];
  return all.filter((item) => (
    item.scope === "user"
    || (item.scope === "project" && item.projectId === projectId)
    || (item.scope === "session" && item.projectId === projectId && item.sessionId === (sessionId || null))
  ));
}

export async function recallAgentMemories(input: {
  projectId: number;
  sessionId?: string | null;
  query: string;
  limit?: number;
}): Promise<BriefAgentMemory[]> {
  const ranked = rankMemories(
    await listAgentMemories(input.projectId, input.sessionId),
    input.query,
    input.limit || 8,
  );
  const now = new Date().toISOString();
  void Promise.all(ranked.map((memory) => DB.agentMemories.put({
    ...memory,
    lastUsedAt: now,
    useCount: (memory.useCount || 0) + 1,
  }))).catch(() => undefined);
  return ranked.map(({ id, scope, kind, text, confidence, pinned }) => ({
    id,
    scope,
    kind,
    text,
    confidence,
    pinned,
  }));
}

export async function clearAgentMemories(
  scope: AgentMemoryScope | "all",
  projectId: number,
  sessionId?: string | null,
) {
  const items = await listAgentMemories(projectId, sessionId);
  const ids = items.filter((item) => scope === "all" || item.scope === scope).map((item) => item.id);
  await DB.agentMemories.deleteMany(ids);
  return ids.length;
}

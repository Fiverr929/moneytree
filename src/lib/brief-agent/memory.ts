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
import { canUseCloudWorkspace } from "@/lib/cloudWorkspace";

const MAX_MEMORY_ITEMS = 250;
const CLOUD_SYNC_INTERVAL_MS = 15_000;
const projectKeyPromises = new Map<number, Promise<string>>();
const syncPromises = new Map<number, Promise<void>>();
const lastSyncedAt = new Map<number, number>();

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

type CloudMemoryResponse = {
  memories?: AgentMemoryItem[];
};

async function getProjectMemoryKey(projectId: number) {
  const pending = projectKeyPromises.get(projectId);
  if (pending) return pending;
  const promise = (async () => {
    const project = await DB.projects.get(projectId) as { cloudId?: string; memoryCloudId?: string } | undefined;
    if (project?.cloudId || project?.memoryCloudId) return project.cloudId || project.memoryCloudId!;
    const memoryCloudId = crypto.randomUUID();
    await DB.projects.update(projectId, { cloudId: memoryCloudId, memoryCloudId }, true);
    return memoryCloudId;
  })();
  projectKeyPromises.set(projectId, promise);
  try {
    return await promise;
  } catch (error) {
    projectKeyPromises.delete(projectId);
    throw error;
  }
}

function isCloudMemory(value: unknown): value is AgentMemoryItem {
  if (!value || typeof value !== "object") return false;
  const memory = value as Partial<AgentMemoryItem>;
  return typeof memory.id === "string"
    && (memory.scope === "user" || memory.scope === "project")
    && typeof memory.kind === "string"
    && typeof memory.text === "string"
    && typeof memory.normalizedText === "string"
    && typeof memory.updatedAt === "string";
}

async function syncAgentMemoriesNow(projectId: number) {
  if (!await canUseCloudWorkspace()) return;
  const projectKey = await getProjectMemoryKey(projectId);
  const all = await DB.agentMemories.getAll() as AgentMemoryItem[];
  const visible = all.filter((item) => item.scope === "user" || (item.scope === "project" && item.projectId === projectId));
  const pending = visible.filter((item) => !item.cloudSyncedAt || item.updatedAt > item.cloudSyncedAt);
  const response = await fetch("/api/agent-memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectKey,
      memories: pending.map((memory) => ({
        id: memory.id,
        scope: memory.scope,
        kind: memory.kind,
        text: memory.text,
        normalizedText: memory.normalizedText,
        source: memory.source,
        sourceId: memory.sourceId,
        confidence: memory.confidence,
        pinned: memory.pinned,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        lastUsedAt: memory.lastUsedAt,
        useCount: memory.useCount,
      })),
    }),
  });
  if (!response.ok) throw new Error("Cloud memory sync failed.");
  const body = await response.json() as CloudMemoryResponse;
  if (!Array.isArray(body.memories) || !body.memories.every(isCloudMemory)) {
    throw new Error("Cloud memory sync returned invalid data.");
  }

  const syncedAt = new Date().toISOString();
  const remoteIds = new Set(body.memories.map((memory) => memory.id));
  const staleIds = visible
    .filter((memory) => memory.cloudSyncedAt && !remoteIds.has(memory.id) && !pending.some((item) => item.id === memory.id))
    .map((memory) => memory.id);
  await Promise.all([
    ...body.memories.map((memory) => DB.agentMemories.put({
      ...memory,
      projectId: memory.scope === "project" ? projectId : null,
      sessionId: null,
      cloudSyncedAt: syncedAt,
    })),
  ]);
  if (staleIds.length) await DB.agentMemories.deleteMany(staleIds);
  lastSyncedAt.set(projectId, Date.now());
}

async function syncAgentMemories(projectId: number, force = false) {
  if (!force && Date.now() - (lastSyncedAt.get(projectId) || 0) < CLOUD_SYNC_INTERVAL_MS) return;
  const active = syncPromises.get(projectId);
  if (active) return active;
  const promise = syncAgentMemoriesNow(projectId).finally(() => syncPromises.delete(projectId));
  syncPromises.set(projectId, promise);
  return promise;
}

async function deleteCloudMemories(scope: AgentMemoryScope | "all", projectId: number) {
  if (!await canUseCloudWorkspace()) return;
  if (scope === "session") return;
  const projectKey = await getProjectMemoryKey(projectId);
  const params = new URLSearchParams({ scope, project_key: projectKey });
  const response = await fetch(`/api/agent-memory?${params}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not clear synced memory.");
  lastSyncedAt.delete(projectId);
}

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
  if (memory.scope !== "session" && input.projectId) {
    void syncAgentMemories(input.projectId, true).catch(() => undefined);
  }
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
  await syncAgentMemories(projectId).catch(() => undefined);
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
  const all = await DB.agentMemories.getAll() as AgentMemoryItem[];
  const items = all.filter((item) => (
    item.scope === "user"
    || (item.scope === "project" && item.projectId === projectId)
    || (item.scope === "session" && item.projectId === projectId && item.sessionId === (sessionId || null))
  ));
  await deleteCloudMemories(scope, projectId);
  const ids = items.filter((item) => scope === "all" || item.scope === scope).map((item) => item.id);
  await DB.agentMemories.deleteMany(ids);
  return ids.length;
}

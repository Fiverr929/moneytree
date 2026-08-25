"use client";

import DB from "@/lib/db";
import type { AgentMessage } from "./types";
import { canUseCloudWorkspace } from "@/lib/cloudWorkspace";
import { ACTIVE_MESSAGE_LIMIT, compactConversationMessages } from "./conversationCompaction";

export type ConversationCheckpoint = {
  id: string;
  schemaVersion: 1;
  project_id: number;
  session_id: string;
  sourceMessageIds: string[];
  coveredThrough: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export async function persistConversationMessages(
  projectId: number,
  sessionId: string,
  messages: AgentMessage[],
) {
  await DB.agentMessages.putMany(projectId, sessionId, messages);
  void syncConversationContext(projectId, sessionId, messages, []).catch(() => undefined);
}

async function syncConversationContext(
  projectId: number,
  sessionId: string,
  messages: AgentMessage[],
  checkpoints: ConversationCheckpoint[],
) {
  if (!await canUseCloudWorkspace()) return;
  const project = await DB.projects.get(projectId) as { cloudId?: string; memoryCloudId?: string } | undefined;
  const projectKey = project?.cloudId || project?.memoryCloudId;
  if (!projectKey) return;
  const response = await fetch("/api/agent-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectKey,
      messages: messages.map((message) => ({ id: message.id, sessionId, createdAt: message.createdAt, payload: message })),
      checkpoints: checkpoints.map((checkpoint) => ({ id: checkpoint.id, sessionId, updatedAt: checkpoint.updatedAt, payload: checkpoint })),
    }),
  });
  if (!response.ok) throw new Error("Cloud conversation sync failed.");
  const body = await response.json() as {
    messages?: Array<{ sessionId: string; payload: AgentMessage }>;
    checkpoints?: Array<{ sessionId: string; payload: ConversationCheckpoint }>;
  };
  const remoteMessages = Array.isArray(body.messages) ? body.messages : [];
  const bySession = new Map<string, AgentMessage[]>();
  remoteMessages.forEach((record) => bySession.set(record.sessionId, [...(bySession.get(record.sessionId) || []), record.payload]));
  await Promise.all([...bySession].map(([remoteSessionId, records]) => DB.agentMessages.putMany(projectId, remoteSessionId, records)));
  await DB.agentCheckpoints.putMany((Array.isArray(body.checkpoints) ? body.checkpoints : []).map((record) => ({
    ...record.payload,
    project_id: projectId,
    session_id: record.sessionId,
  })));
}

export async function prepareConversationContext(input: {
  projectId: number;
  sessionId: string;
  messages: AgentMessage[];
}) {
  await persistConversationMessages(input.projectId, input.sessionId, input.messages);
  if (input.messages.length <= ACTIVE_MESSAGE_LIMIT) {
    return { messages: input.messages, checkpoint: null as ConversationCheckpoint | null };
  }

  const { archived, recent, summary } = compactConversationMessages(input.messages);
  const coveredThrough = archived.at(-1)?.id || "empty";
  const now = new Date().toISOString();
  const checkpoint: ConversationCheckpoint = {
    id: `checkpoint:${input.projectId}:${input.sessionId}:${coveredThrough}`,
    schemaVersion: 1,
    project_id: input.projectId,
    session_id: input.sessionId,
    sourceMessageIds: archived.map((message) => message.id),
    coveredThrough,
    summary,
    createdAt: now,
    updatedAt: now,
  };
  await DB.agentCheckpoints.put(checkpoint);
  void syncConversationContext(input.projectId, input.sessionId, input.messages, [checkpoint]).catch(() => undefined);
  const compactedMessage: AgentMessage = {
    id: checkpoint.id,
    role: "system",
    text: `COMPACTED CONTEXT\n${checkpoint.summary}`,
    createdAt: now,
  };
  return { messages: [compactedMessage, ...recent], checkpoint };
}

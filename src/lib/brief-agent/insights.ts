"use client";

import DB from "@/lib/db";
import type { AgentInsight } from "./insightPolicy";

export async function recordAgentInsight(insight: AgentInsight | null) {
  if (!insight) return null;
  await DB.agentInsights.put(insight);
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    void fetch("/api/agent-insights/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insight }),
    }).then((response) => {
      if (!response.ok) throw new Error(`Insight inbox export failed (${response.status}).`);
    }).catch((error) => console.warn("Failed to update the local agent insight inbox", error));
  }
  return insight;
}

export async function listAgentInsights(projectId: number) {
  return DB.agentInsights.getByProject(projectId) as Promise<AgentInsight[]>;
}

export async function updateAgentInsightStatus(
  insightId: string,
  status: AgentInsight["status"],
) {
  const existing = await DB.agentInsights.get(insightId) as AgentInsight | undefined;
  if (!existing) throw new Error("Insight not found.");
  const insight: AgentInsight = {
    ...existing,
    status,
    statusHistory: [
      ...(existing.statusHistory || []),
      {
        id: crypto.randomUUID(),
        from: existing.status,
        to: status,
        actor: "user",
        evidence: "Updated from the local Memory insight panel.",
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  await recordAgentInsight(insight);
  return insight;
}

import type {
  AgentActionProposal,
  AgentActionProposalStatus,
  AgentAppAction,
  AgentAppEvent,
} from "./types";

export function createAgentActionProposal(
  actions: AgentAppAction[],
  runId: string,
  projectId: number,
): AgentActionProposal {
  if (!actions.length) throw new Error("An action proposal requires at least one action.");
  return {
    id: crypto.randomUUID(),
    runId,
    projectId,
    status: "pending",
    actions,
    createdAt: new Date().toISOString(),
  };
}

export function canResolveAgentActionProposal(proposal: AgentActionProposal) {
  return proposal.status === "pending";
}

export function recoverInterruptedActionProposal(proposal: AgentActionProposal) {
  if (proposal.status !== "executing") return proposal;
  return resolveAgentActionProposal(
    proposal,
    "stale",
    "Execution was interrupted. Inspect /actions before asking the agent to propose it again.",
  );
}

export function resolveAgentActionProposal(
  proposal: AgentActionProposal,
  status: Exclude<AgentActionProposalStatus, "pending" | "executing">,
  error?: string,
): AgentActionProposal {
  return {
    ...proposal,
    status,
    resolvedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

export function proposalStatusFromEvents(events: AgentAppEvent[]): "completed" | "partially_failed" | "failed" {
  if (!events.length || events.every((event) => event.status === "failed")) return "failed";
  return events.some((event) => event.status === "failed") ? "partially_failed" : "completed";
}

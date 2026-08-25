"use client";

import type { AgentAppEvent, AgentMemoryItem } from "@/lib/brief-agent/types";
import type { AgentInsight, AgentInsightStatus } from "@/lib/brief-agent/insightPolicy";

export type AgentMemoryPanelTab = "memory" | "insights" | "activity";

type Props = {
  tab: AgentMemoryPanelTab;
  loading: boolean;
  memories: AgentMemoryItem[];
  insights: AgentInsight[];
  events: AgentAppEvent[];
  onTabChange: (tab: AgentMemoryPanelTab) => void;
  onClose: () => void;
  onClearMemory: (scope: "user" | "project" | "session" | "all") => void;
  onInsightStatus: (insightId: string, status: AgentInsightStatus) => void;
};

const INSIGHT_STATUSES: AgentInsightStatus[] = [
  "new",
  "confirmed",
  "planned",
  "fixed",
  "verified",
  "dismissed",
];

function readable(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

export default function AgentMemoryPanel({
  tab,
  loading,
  memories,
  insights,
  events,
  onTabChange,
  onClose,
  onClearMemory,
  onInsightStatus,
}: Props) {
  const memoryCounts = memories.reduce((counts, memory) => {
    counts[memory.scope] += 1;
    return counts;
  }, { user: 0, project: 0, session: 0 });
  const newInsightCount = insights.filter((insight) => insight.status === "new").length;

  return (
    <section className="agent-memory-panel" aria-label="Memory and insights">
      <div className="agent-memory-panel-head">
        <div>
          <strong>MEMORY</strong>
          <span>Project knowledge, engineering insights, and agent activity</span>
        </div>
        <button type="button" onClick={onClose}>CLOSE</button>
      </div>
      <div className="agent-memory-tabs" role="tablist" aria-label="Memory sections">
        <button type="button" role="tab" aria-selected={tab === "memory"} className={tab === "memory" ? "active" : ""} onClick={() => onTabChange("memory")}>
          MEMORY <span>{memories.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "insights"} className={tab === "insights" ? "active" : ""} onClick={() => onTabChange("insights")}>
          INSIGHTS <span>{newInsightCount || insights.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => onTabChange("activity")}>
          ACTIVITY <span>{events.length}</span>
        </button>
      </div>

      {loading ? <div className="agent-memory-empty">LOADING…</div> : null}

      {!loading && tab === "memory" && (
        <div className="agent-memory-content" role="tabpanel">
          <div className="agent-memory-summary">
            <span>USER {memoryCounts.user}</span>
            <span>PROJECT {memoryCounts.project}</span>
            <span>SESSION {memoryCounts.session}</span>
          </div>
          {memories.length ? memories.map((memory) => (
            <article className="agent-memory-record" key={memory.id}>
              <div className="agent-memory-record-meta">
                <span>{memory.scope.toUpperCase()}</span>
                <span>{memory.kind.toUpperCase()}</span>
                {memory.pinned && <span>PINNED</span>}
              </div>
              <p>{memory.text}</p>
            </article>
          )) : <div className="agent-memory-empty">No saved memory for this project and session.</div>}
          <div className="agent-memory-actions">
            {(["user", "project", "session", "all"] as const).map((scope) => (
              <button type="button" key={scope} onClick={() => onClearMemory(scope)}>CLEAR {scope.toUpperCase()}</button>
            ))}
          </div>
          <div className="agent-memory-hint">/memory add [user|project|session] &lt;fact&gt;</div>
        </div>
      )}

      {!loading && tab === "insights" && (
        <div className="agent-memory-content" role="tabpanel">
          {insights.length ? insights.map((insight) => (
            <details className="agent-insight-record" key={insight.id}>
              <summary>
                <span className={`status-${insight.status}`}>{readable(insight.status)}</span>
                <strong>{insight.title}</strong>
                <small>{readable(insight.type)}</small>
              </summary>
              <div className="agent-insight-detail">
                <p><b>EXPECTED</b>{insight.expected}</p>
                <p><b>OBSERVED</b>{insight.observed}</p>
                <p><b>VERIFY</b>{insight.acceptanceTest}</p>
                <p><b>SOURCE</b>{insight.source.kind.toUpperCase()} · {insight.source.generationIds.join(", ") || "NO GENERATION"}</p>
                <p><b>REFERENCES</b>{insight.activeReferences.map((reference) => `${reference.label} (${reference.role})`).join(", ") || "NONE"}</p>
                {insight.diagnosis && <p><b>INFERENCE</b>{insight.diagnosis.text}</p>}
                {insight.statusHistory?.length ? (
                  <p><b>STATUS HISTORY</b>{insight.statusHistory.map((event) => `${event.to.toUpperCase()} · ${event.actor.toUpperCase()} · ${event.createdAt}`).join("\n")}</p>
                ) : null}
                <label>
                  STATUS
                  <select value={insight.status} onChange={(event) => onInsightStatus(insight.id, event.target.value as AgentInsightStatus)}>
                    {INSIGHT_STATUSES.map((status) => <option value={status} key={status}>{readable(status)}</option>)}
                  </select>
                </label>
              </div>
            </details>
          )) : <div className="agent-memory-empty">No engineering insights captured for this project.</div>}
        </div>
      )}

      {!loading && tab === "activity" && (
        <div className="agent-memory-content" role="tabpanel">
          {events.length ? [...events].reverse().map((event) => (
            <article className="agent-activity-record" key={event.id}>
              <div>
                <span>{readable(event.status)}</span>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
              </div>
              <p>{event.summary}</p>
            </article>
          )) : <div className="agent-memory-empty">No agent workspace actions recorded for this project.</div>}
        </div>
      )}
    </section>
  );
}

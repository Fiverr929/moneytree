type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function preferred(left: JsonRecord, right: JsonRecord, includeVersion = false) {
  const leftKey = `${includeVersion ? String(number(left.version)).padStart(12, "0") : ""}\u0000${text(left.updatedAt)}\u0000${stableStringify({ ...left, projectId: 0 })}`;
  const rightKey = `${includeVersion ? String(number(right.version)).padStart(12, "0") : ""}\u0000${text(right.updatedAt)}\u0000${stableStringify({ ...right, projectId: 0 })}`;
  return leftKey >= rightKey ? left : right;
}

function mergeById(left: unknown, right: unknown, choose?: (a: JsonRecord, b: JsonRecord) => JsonRecord) {
  const records = new Map<string, JsonRecord>();
  for (const value of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    if (!isRecord(value) || typeof value.id !== "string") continue;
    const existing = records.get(value.id);
    records.set(value.id, existing ? (choose ? choose(existing, value) : preferred(existing, value)) : value);
  }
  return [...records.values()].sort((a, b) => text(a.createdAt).localeCompare(text(b.createdAt)) || text(a.id).localeCompare(text(b.id)));
}

const CONSTRAINT_STATUS = { active: 0, confirmed: 1, superseded: 2 } as Record<string, number>;

function chooseConstraint(left: JsonRecord, right: JsonRecord) {
  const leftRank = CONSTRAINT_STATUS[text(left.status)] ?? -1;
  const rightRank = CONSTRAINT_STATUS[text(right.status)] ?? -1;
  if (leftRank !== rightRank) return leftRank > rightRank ? left : right;
  return preferred(left, right);
}

function mergeStrings(left: unknown, right: unknown) {
  return [...new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].filter((value): value is string => typeof value === "string"))].sort();
}

function mergeDecisionAnswers(left: unknown, right: unknown, preferredAnswers: unknown) {
  const values = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].filter(isRecord);
  const preferredByQuestion = new Map((Array.isArray(preferredAnswers) ? preferredAnswers : [])
    .filter(isRecord)
    .map((answer) => [text(answer.questionId), answer]));
  const byQuestion = new Map<string, JsonRecord>();
  for (const answer of values) {
    const id = text(answer.questionId);
    if (!id) continue;
    const selected = preferredByQuestion.get(id);
    byQuestion.set(id, selected || preferred(byQuestion.get(id) || answer, answer));
  }
  return [...byQuestion.values()].sort((a, b) => text(a.questionId).localeCompare(text(b.questionId)));
}

/**
 * Convergent merge for iteration briefs. Scalar continuity fields come from a
 * deterministic winner while set-like evidence is unioned, so concurrent
 * devices cannot silently discard constraints, rejections, or decisions.
 */
export function mergeIterationBrief(left: unknown, right: unknown): JsonRecord | null {
  if (!isRecord(left)) return isRecord(right) ? { ...right } : null;
  if (!isRecord(right)) return { ...left };
  const winner = preferred(left, right, true);
  return {
    ...winner,
    keep: mergeById(left.keep, right.keep, chooseConstraint),
    change: mergeById(left.change, right.change, chooseConstraint),
    avoid: mergeById(left.avoid, right.avoid, chooseConstraint),
    rejectedGenerationIds: mergeStrings(left.rejectedGenerationIds, right.rejectedGenerationIds),
    decisionAnswers: mergeDecisionAnswers(left.decisionAnswers, right.decisionAnswers, winner.decisionAnswers),
    version: Math.max(number(left.version), number(right.version)),
    updatedAt: [text(left.updatedAt), text(right.updatedAt)].sort().at(-1) || text(winner.updatedAt),
  };
}

function chooseHistoryEvent(left: JsonRecord, right: JsonRecord) {
  return preferred(left, right);
}

function mergeReferences(left: unknown, right: unknown) {
  const byIdentity = new Map<string, JsonRecord>();
  for (const value of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    if (!isRecord(value)) continue;
    const key = `${text(value.imageId)}\u0000${text(value.role)}`;
    const existing = byIdentity.get(key);
    byIdentity.set(key, existing ? preferred(existing, value) : value);
  }
  return [...byIdentity.values()].sort((a, b) => `${text(a.imageId)}\u0000${text(a.role)}`.localeCompare(`${text(b.imageId)}\u0000${text(b.role)}`));
}

/** Merge an insight without losing append-only lifecycle or provenance data. */
export function mergeAgentInsight(left: unknown, right: unknown): JsonRecord | null {
  if (!isRecord(left)) return isRecord(right) ? { ...right } : null;
  if (!isRecord(right)) return { ...left };
  const winner = preferred(left, right);
  const history = mergeById(left.statusHistory, right.statusHistory, chooseHistoryEvent);
  const latest = [...history].sort((a, b) => text(a.createdAt).localeCompare(text(b.createdAt)) || text(a.id).localeCompare(text(b.id))).at(-1);
  const leftSource = isRecord(left.source) ? left.source : {};
  const rightSource = isRecord(right.source) ? right.source : {};
  const winnerSource = isRecord(winner.source) ? winner.source : {};
  return {
    ...winner,
    status: typeof latest?.to === "string" ? latest.to : winner.status,
    statusHistory: history,
    source: {
      ...winnerSource,
      generationIds: mergeStrings(leftSource.generationIds, rightSource.generationIds),
    },
    activeReferences: mergeReferences(left.activeReferences, right.activeReferences),
    conversationEvidence: mergeStrings(left.conversationEvidence, right.conversationEvidence),
    createdAt: [text(left.createdAt), text(right.createdAt)].filter(Boolean).sort()[0] || text(winner.createdAt),
    updatedAt: [text(left.updatedAt), text(right.updatedAt)].sort().at(-1) || text(winner.updatedAt),
  };
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeAgentInsight, mergeIterationBrief, stableStringify } from "../src/lib/cloudSyncMerge.ts";
import { iterationPreflight } from "../src/lib/brief-agent/iterationBrief.ts";

const constraint = (id, kind, text, createdAt, status = "active") => ({
  id, kind, text, source: "user", sourceGenerationIds: [], confidence: "explicit", status, createdAt,
});
const baseBrief = {
  projectId: 7,
  anchorGenerationId: "generation-anchor",
  parentGenerationId: "generation-parent",
  keep: [constraint("keep-composition", "keep", "composition", "2026-08-26T08:00:00.000Z")],
  change: [], avoid: [], rejectedGenerationIds: [], selectedDirection: "Editorial",
  decisionAnswers: [{ questionId: "tone", optionId: "editorial", value: "Editorial", custom: false }],
  referenceFingerprint: "refs-v3:original",
  version: 3, updatedAt: "2026-08-26T08:00:00.000Z",
};
const deviceA = {
  ...baseBrief,
  change: [constraint("change-light", "change", "lighting", "2026-08-26T08:01:00.000Z")],
  rejectedGenerationIds: ["generation-bad-a"],
  version: 4, updatedAt: "2026-08-26T08:01:00.000Z",
};
const deviceB = {
  ...baseBrief,
  projectId: 42,
  avoid: [constraint("avoid-glare", "avoid", "glare", "2026-08-26T08:02:00.000Z")],
  rejectedGenerationIds: ["generation-bad-b"],
  decisionAnswers: [...baseBrief.decisionAnswers, { questionId: "crop", optionId: "wide", value: "Wide", custom: false }],
  version: 4, updatedAt: "2026-08-26T08:02:00.000Z",
};

const mergedAB = mergeIterationBrief(deviceA, deviceB);
const mergedBA = mergeIterationBrief(deviceB, deviceA);
assert.equal(stableStringify(mergedAB), stableStringify(mergedBA), "brief merges must converge independent of arrival order");
assert.deepEqual(mergedAB.rejectedGenerationIds, ["generation-bad-a", "generation-bad-b"]);
assert.deepEqual(mergedAB.keep.map((item) => item.id), ["keep-composition"]);
assert.deepEqual(mergedAB.change.map((item) => item.id), ["change-light"]);
assert.deepEqual(mergedAB.avoid.map((item) => item.id), ["avoid-glare"]);
assert.deepEqual(mergedAB.decisionAnswers.map((item) => item.questionId), ["crop", "tone"]);
assert.equal(mergedAB.anchorGenerationId, "generation-anchor");
assert.equal(mergedAB.parentGenerationId, "generation-parent");
assert.equal(mergedAB.referenceFingerprint, "refs-v3:original");

const stale = iterationPreflight({
  brief: mergedAB,
  availableGenerationIds: ["generation-anchor"],
  referenceFingerprint: "refs-v3:changed",
});
assert.equal(stale.ok, true);
assert.deepEqual(stale.warnings, ["References changed after the iteration brief was last confirmed."], "sync must not refresh or suppress the stale-reference guard");

const insightBase = {
  id: "insight:7:conversation:m1", schemaVersion: 1, projectId: 7,
  type: "defect_candidate", status: "new",
  statusHistory: [{ id: "event-new", from: null, to: "new", actor: "harness", evidence: "captured", createdAt: "2026-08-26T08:00:00.000Z" }],
  title: "Reference omitted", expected: "All references appear", observed: "One missing", acceptanceTest: "Regression",
  source: { kind: "conversation", sourceId: "m1", runId: "run-1", generationIds: ["generation-a"] },
  referenceFingerprint: "refs-v3:evidence", activeReferences: [{ imageId: "ref-a", role: "SUBJECT", label: "A", strength: 50 }],
  conversationEvidence: ["Why is A missing?"], diagnosis: null,
  createdAt: "2026-08-26T08:00:00.000Z", updatedAt: "2026-08-26T08:00:00.000Z",
};
const planned = {
  ...insightBase, status: "planned",
  statusHistory: [...insightBase.statusHistory, { id: "event-planned", from: "new", to: "planned", actor: "user", evidence: "scheduled", createdAt: "2026-08-26T08:02:00.000Z" }],
  updatedAt: "2026-08-26T08:02:00.000Z",
};
const confirmed = {
  ...insightBase, projectId: 42, status: "confirmed",
  statusHistory: [...insightBase.statusHistory, { id: "event-confirmed", from: "new", to: "confirmed", actor: "coding_agent", evidence: "reproduced", createdAt: "2026-08-26T08:01:00.000Z" }],
  source: { ...insightBase.source, generationIds: ["generation-b"] },
  activeReferences: [...insightBase.activeReferences, { imageId: "ref-b", role: "SUBJECT", label: "B", strength: 75 }],
  updatedAt: "2026-08-26T08:01:00.000Z",
};
const mergedInsight = mergeAgentInsight(planned, confirmed);
assert.equal(mergedInsight.status, "planned", "latest status event deterministically defines current status");
assert.deepEqual(mergedInsight.statusHistory.map((event) => event.id), ["event-new", "event-confirmed", "event-planned"]);
assert.deepEqual(mergedInsight.source.generationIds, ["generation-a", "generation-b"]);
assert.equal(mergedInsight.activeReferences.length, 2);
assert.equal(mergedInsight.referenceFingerprint, "refs-v3:evidence");
assert.equal(stableStringify(mergeAgentInsight(planned, confirmed)), stableStringify(mergeAgentInsight(confirmed, planned)));

const migration = await readFile(new URL("../drizzle/0007_project_insight_sync.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE `cloud_agent_insight`/);
assert.match(migration, /PRIMARY KEY\(`owner_key`, `id`\)/, "insight identity must be owner-scoped and stable across projects/devices");
assert.match(migration, /project_id/);
assert.match(migration, /insight_json/);

console.log("Cloud project knowledge sync and migration checks passed.");

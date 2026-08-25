import assert from "node:assert/strict";
import {
  createConversationInsight,
  createEvaluationInsight,
} from "../src/lib/brief-agent/insightPolicy.ts";

const snapshot = {
  id: "snapshot-1",
  createdAt: "2026-08-24T00:00:00.000Z",
  sourceFingerprint: "two-subjects-active",
  observations: [
    { imageId: "model-1", role: "SUBJECT", label: "MODEL 1", strength: 50, visualRead: "A woman in a red coat." },
    { imageId: "model-2", role: "SUBJECT", label: "MODEL 2", strength: 50, visualRead: "A man in a blue jacket." },
  ],
};

const omission = createConversationInsight({
  projectId: 7,
  runId: "run-1",
  sourceMessageId: "message-1",
  userText: "Why didn't you include the second subject?",
  agentReply: "The prompt focused on one model.",
  referenceSnapshot: snapshot,
  generations: [{ generationId: "generation-1" }],
  createdAt: "2026-08-24T01:00:00.000Z",
});
assert.ok(omission, "a direct omission report should create an insight");
assert.equal(omission.type, "defect_candidate");
assert.equal(omission.title, "Active subject omitted from a multi-subject composition");
assert.equal(omission.activeReferences.length, 2);
assert.deepEqual(omission.source.generationIds, ["generation-1"]);
assert.equal(omission.diagnosis?.status, "inference", "agent explanations must not be stored as facts");

const casual = createConversationInsight({
  projectId: 7,
  sourceMessageId: "message-2",
  userText: "Make the lighting warmer.",
  agentReply: "Starting generation.",
  referenceSnapshot: snapshot,
  generations: [],
});
assert.equal(casual, null, "ordinary creative direction should not pollute the engineering ledger");

const unsupportedEvaluation = createEvaluationInsight({
  projectId: 7,
  generationId: "generation-2",
  reaction: "dislike",
  subjectScore: 1,
});
assert.equal(unsupportedEvaluation, null, "a rating without diagnostic evidence should remain ordinary feedback");

const subjectEvaluation = createEvaluationInsight({
  projectId: 7,
  generationId: "generation-3",
  reaction: "dislike",
  note: "The second model is missing.",
  issues: ["Only one subject appears."],
  suggestions: ["Represent both people."],
  subjectScore: 1,
  referenceFingerprint: snapshot.sourceFingerprint,
  references: snapshot.observations.map((reference) => ({
    uuid: reference.imageId,
    role: reference.role,
    label: reference.label,
    strength: reference.strength,
  })),
});
assert.ok(subjectEvaluation);
assert.equal(subjectEvaluation.type, "generation_feedback");
assert.equal(subjectEvaluation.activeReferences.length, 2);

console.log("Agent insight policy checks passed");

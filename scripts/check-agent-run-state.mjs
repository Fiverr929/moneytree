import assert from "node:assert/strict";
import {
  advanceAgentRun,
  observeAgentGeneration,
  observeAgentReview,
  requestAgentGeneration,
  requestAgentPromptRevision,
} from "../src/lib/brief-agent/runState.ts";

const now = new Date().toISOString();
const run = {
  id: crypto.randomUUID(),
  version: 1,
  goal: "Create a product image",
  status: "awaiting_approval",
  referenceFingerprint: "fixture:watch",
  selectedDirection: "",
  currentPrompt: "A watch on volcanic rock.",
  steps: [],
  generationIds: [],
  generationAttempts: 0,
  budget: { maxSteps: 6, maxGenerations: 1 },
  createdAt: now,
  updatedAt: now,
};

const approval = requestAgentGeneration(run, run.currentPrompt);
assert.equal(approval.allowed, true);
if (!approval.allowed) throw new Error(approval.reason);
assert.equal(approval.run.status, "generating");
assert.equal(approval.run.generationAttempts, 1);
assert.equal(approval.run.steps.at(-1)?.action.type, "request_generation");

const duplicateApproval = requestAgentGeneration(approval.run, run.currentPrompt);
assert.equal(duplicateApproval.allowed, false);
if (duplicateApproval.allowed) throw new Error("Expected the in-flight run to block a second approval.");
assert.match(duplicateApproval.reason, /not waiting/i);

const completed = observeAgentGeneration(approval.run, {
  outcome: "succeeded",
  generationIds: ["image-1"],
  message: "Generation completed with 1 image.",
});
assert.equal(completed.status, "completed");
assert.deepEqual(completed.generationIds, ["image-1"]);
assert.equal(completed.steps.at(-1)?.action.type, "observe_generation");

const reviewed = observeAgentReview(completed, {
  generationId: "image-1",
  scores: { prompt: 5, subject: 4, scene: 5, style: 4, quality: 5 },
  summary: "The result follows the approved direction.",
  issues: ["Minor reflection inconsistency."],
  suggestions: ["Reduce the highlight on the upper edge."],
});
assert.equal(reviewed.status, "completed");
assert.equal(reviewed.generationAttempts, 1);
assert.equal(reviewed.steps.at(-1)?.action.type, "review_generation");
if (reviewed.steps.at(-1)?.action.type === "review_generation") {
  assert.deepEqual(reviewed.steps.at(-1)?.action.suggestions, ["Reduce the highlight on the upper edge."]);
}

const revisionRequested = requestAgentPromptRevision(reviewed, {
  generationId: "image-1",
  summary: "The result follows the approved direction.",
  issues: ["Minor reflection inconsistency."],
  suggestions: ["Reduce the highlight on the upper edge."],
});
assert.equal(revisionRequested.status, "planning");
assert.equal(revisionRequested.budget.maxGenerations, 2);
assert.equal(revisionRequested.steps.at(-1)?.action.type, "request_prompt_revision");

const revisedPrompt = "A watch on volcanic rock with a controlled upper-edge highlight.";
const revisedDraftRun = advanceAgentRun(revisionRequested, {
  action: "draft",
  reply: "Revised the prompt from the visual review.",
  finalPrompt: revisedPrompt,
  session: {
    projectIntent: run.goal,
    selectedDirection: "",
    directions: [],
    lastDraftPrompt: revisedPrompt,
    unresolvedQuestions: [],
    notes: [],
  },
  plan: { intent: run.goal, subjectPolicy: "", scenePolicy: "", stylePolicy: "" },
}, {
  sourceFingerprint: run.referenceFingerprint,
});
assert.equal(revisedDraftRun.status, "awaiting_approval");
assert.equal(revisedDraftRun.steps.at(-1)?.action.type, "revise_prompt");
const staleApproval = requestAgentGeneration(revisedDraftRun, run.currentPrompt);
assert.equal(staleApproval.allowed, false);
if (staleApproval.allowed) throw new Error("Expected the stale prompt approval to fail.");
assert.match(staleApproval.reason, /not the current prompt/i);

const revisedApproval = requestAgentGeneration(revisedDraftRun, revisedPrompt);
assert.equal(revisedApproval.allowed, true);
if (!revisedApproval.allowed) throw new Error(revisedApproval.reason);
assert.equal(revisedApproval.run.generationAttempts, 2);

const freshDraftPrompt = "A different campaign image for the same watch.";
const freshRun = advanceAgentRun(completed, {
  action: "draft",
  reply: "Drafted a new campaign direction.",
  finalPrompt: freshDraftPrompt,
  session: {
    projectIntent: "Create a different watch campaign",
    selectedDirection: "",
    directions: [],
    lastDraftPrompt: freshDraftPrompt,
    unresolvedQuestions: [],
    notes: [],
  },
  plan: { intent: "Create a different watch campaign", subjectPolicy: "", scenePolicy: "", stylePolicy: "" },
}, {
  sourceFingerprint: run.referenceFingerprint,
});
assert.notEqual(freshRun.id, completed.id);
assert.equal(freshRun.generationAttempts, 0);
assert.equal(freshRun.budget.maxGenerations, 1);
assert.equal(freshRun.status, "awaiting_approval");
const freshApproval = requestAgentGeneration(freshRun, freshDraftPrompt);
assert.equal(freshApproval.allowed, true);

console.log("Agent run-state checks passed");

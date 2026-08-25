import assert from "node:assert/strict";
import {
  activeDecisionQuestions,
  cleanDecisionLabel,
  cleanReplyForDirections,
  createDirectionFlow,
  decisionAnswersText,
  updateDecisionAnswer,
} from "../src/lib/brief-agent/decisionFlow.ts";
import {
  emptyIterationBrief,
  applyGenerationFeedback,
  iterationPreflight,
  setIterationAnchor,
} from "../src/lib/brief-agent/iterationBrief.ts";

assert.equal(cleanDecisionLabel("1. Mid-stride street motion"), "Mid-stride street motion");
assert.equal(cleanDecisionLabel("Option 2: Low-angle drama"), "Low-angle drama");

const directions = ["1. Mid-stride street motion", "2. Low-angle drama"];
const cleanedReply = cleanReplyForDirections([
  "Here are two directions:",
  "1. Mid-stride street motion",
  "2. Low-angle drama",
].join("\n"), directions);
assert.equal(cleanedReply, "Here are two directions:");
assert.equal(
  cleanReplyForDirections(`Here are two directions: ${directions.join(" ")}`, directions),
  "Here are two directions:",
);

const flow = createDirectionFlow({ id: "flow-1", sourceFingerprint: "refs-1", directions });
assert.ok(flow);
assert.deepEqual(flow.questions[0].options.map((option) => option.label), ["Mid-stride street motion", "Low-angle drama"]);

const dependentFlow = {
  ...flow,
  questions: [
    flow.questions[0],
    { id: "camera", prompt: "Camera?", options: [{ id: "wide", label: "Wide" }], allowCustom: true, dependsOnQuestionId: "direction", dependsOnOptionId: "direction-2" },
  ],
};
let answers = updateDecisionAnswer(dependentFlow, [], { questionId: "direction", optionId: "direction-2", value: "Low-angle drama", custom: false });
assert.equal(activeDecisionQuestions(dependentFlow, answers).length, 2);
answers = updateDecisionAnswer(dependentFlow, answers, { questionId: "camera", optionId: "wide", value: "Wide", custom: false });
answers = updateDecisionAnswer(dependentFlow, answers, { questionId: "direction", optionId: "direction-1", value: "Mid-stride street motion", custom: false });
assert.equal(answers.some((answer) => answer.questionId === "camera"), false, "dependent answers must be invalidated");
assert.match(decisionAnswersText(dependentFlow, answers), /Requested next step: reply/);

const brief = setIterationAnchor(emptyIterationBrief(4), "image-29");
assert.equal(iterationPreflight({ brief, availableGenerationIds: ["image-29"], referenceFingerprint: "refs" }).ok, true);
assert.equal(iterationPreflight({ brief, availableGenerationIds: ["image-30"], referenceFingerprint: "refs" }).ok, false);

const feedback = { reaction: "mixed", keep: ["composition"], change: ["lighting"], note: "Use softer snowfall" };
const once = applyGenerationFeedback(brief, "image-30", feedback);
const twice = applyGenerationFeedback(once, "image-30", feedback);
assert.equal(twice.keep.filter((item) => item.sourceGenerationIds.includes("image-30")).length, 1, "feedback updates must be idempotent");
const conflict = {
  ...brief,
  keep: [{ id: "keep", kind: "keep", text: "composition", source: "user", sourceGenerationIds: [], confidence: "explicit", status: "active", createdAt: new Date().toISOString() }],
  change: [{ id: "change", kind: "change", text: "composition", source: "user", sourceGenerationIds: [], confidence: "explicit", status: "active", createdAt: new Date().toISOString() }],
};
assert.equal(iterationPreflight({ brief: conflict, availableGenerationIds: ["image-29"], referenceFingerprint: "refs" }).ok, false);

console.log("Agent decision and iteration checks passed.");

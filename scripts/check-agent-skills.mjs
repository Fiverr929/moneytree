import assert from "node:assert/strict";
import { runSkillChecks } from "../src/lib/brief-agent/skillContract.ts";

function draft(finalPrompt, observations = []) {
  return { finalPrompt, observations };
}

const watch = {
  imageId: "watch",
  role: "SUBJECT",
  label: "WATCH",
  strength: 10,
  visualRead: "A brushed steel wristwatch with a circular black dial and silver hour markers.",
};
const gallery = {
  imageId: "gallery",
  role: "SCENE",
  label: "GALLERY",
  strength: 20,
  visualRead: "A symmetrical cream gallery with a polished concrete floor and soft skylight.",
};

const clean = runSkillChecks(draft(
  "A brushed steel wristwatch with a circular black dial rests in a symmetrical cream gallery on polished concrete, lit by a soft skylight.",
  [watch, gallery],
));
assert.equal(clean.every((check) => check.status === "pass"), true, "grounded coherent prompts should pass");

const leaked = runSkillChecks(draft(
  "SUBJECT: use the watch at 10% strength. SCENE: apply high influence from Reference Image 2.",
  [watch, gallery],
));
assert.equal(leaked.find((check) => check.id === "prompt-hygiene")?.status, "warning");
assert.equal(leaked.find((check) => check.id === "prompt-coherence")?.status, "warning");

const ungrounded = runSkillChecks(draft("A generic luxury product on a neutral surface.", [watch]));
assert.equal(ungrounded.find((check) => check.id === "reference-grounding")?.status, "warning");
assert.deepEqual(runSkillChecks(draft("", [watch])), []);

console.log("Agent skill checks passed");

import assert from "node:assert/strict";
import {
  isClearlyNonCreativeMessage,
  isCreativeBrief,
  shouldProduceDraft,
} from "../src/lib/brief-agent/intent.ts";

const emptySession = {
  projectIntent: "",
  selectedDirection: "",
  directions: [],
  lastDraftPrompt: "",
  unresolvedQuestions: [],
  notes: [],
};

assert.equal(isCreativeBrief("a red sports car under neon rain"), true);
assert.equal(isCreativeBrief("Can you make this portrait moodier?"), true);
assert.equal(isCreativeBrief("editorial portrait, hard flash"), true);
assert.equal(isCreativeBrief("How does the agent use references?"), false);
assert.equal(isCreativeBrief("that didn't work, the generation didn't happen"), false);
assert.equal(isCreativeBrief("I really like this result"), false);
assert.equal(isCreativeBrief("sleek biomorphic pavilion at sunrise"), true);
assert.equal(isClearlyNonCreativeMessage("hello"), true);
assert.equal(shouldProduceDraft("make it warmer", { ...emptySession, lastDraftPrompt: "A cool portrait" }), true);

console.log("Agent intent regression checks passed.");

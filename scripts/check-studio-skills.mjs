import assert from "node:assert/strict";
import {
  DEFAULT_CHARACTER_REFERENCE_PROFILE,
  buildCharacterReferencePrompt,
  getCharacterReferenceProfile,
  listCharacterReferenceProfiles,
} from "../src/lib/studio/skills/characterReference.ts";

assert.equal(getCharacterReferenceProfile()?.id, DEFAULT_CHARACTER_REFERENCE_PROFILE);
assert.deepEqual(getCharacterReferenceProfile()?.generation, { aspectRatio: "16:9", imageSize: "1K" });
assert.deepEqual(listCharacterReferenceProfiles(), [
  "standard-v2",
  "identity-board-v1",
  "standard-v1",
  "expressions-v1",
]);

const standard = buildCharacterReferencePrompt("Keep the red scarf.");
assert.match(standard, /standard-v2/);
assert.match(standard, /three-view photographic character reference/i);
assert.match(standard, /never illustration, animation, anime/i);
assert.match(standard, /gentle internal tonal modelling/i);
assert.match(standard, /no borders, frames, divider lines/i);
assert.match(standard, /head and face fully visible/i);
assert.match(standard, /Keep the red scarf\./);

const identityBoard = buildCharacterReferencePrompt("", "identity-board-v1");
assert.match(identityBoard, /comprehensive horizontal photographic character identity board/i);
assert.match(identityBoard, /Never invent a detail to fill a slot/i);
assert.match(identityBoard, /Do not add layout titles, captions, labels/i);
assert.deepEqual(getCharacterReferenceProfile("identity-board-v1")?.generation, { aspectRatio: "16:9", imageSize: "1K" });

const expressions = buildCharacterReferencePrompt("", "expressions-v1");
assert.match(expressions, /expression reference sheet/i);
assert.match(expressions, /photographic medium exactly/i);
assert.doesNotMatch(expressions, /Additional direction:/);
assert.deepEqual(getCharacterReferenceProfile("expressions-v1")?.generation, { aspectRatio: "4:3", imageSize: "1K" });

assert.throws(
  () => buildCharacterReferencePrompt("", "missing-v1"),
  /Unknown character reference profile/,
);

console.log("Studio skill checks passed.");

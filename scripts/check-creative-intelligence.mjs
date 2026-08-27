import assert from "node:assert/strict";
import { moveScenePlanShot, replaceSceneShotPrompt, scenePlanCanExecute } from "../src/lib/brief-agent/scenePlanState.ts";
import { pinterestConfiguration } from "../src/lib/inspiration/providers.ts";

const plan = {
  id: "scene-1",
  title: "Crossing",
  intent: "A connected two-shot crossing.",
  sourcePrompt: "A traveler crosses a station.",
  shotCount: 2,
  continuity: { subject: ["red coat"], world: ["station"], style: [], progression: "arrival to departure" },
  shots: [
    { index: 1, title: "Arrival", purpose: "establish", action: "arrives", camera: "wide", continuity: ["red coat"], prompt: "wide arrival" },
    { index: 2, title: "Departure", purpose: "resolve", action: "leaves", camera: "close", continuity: ["red coat"], prompt: "close departure" },
  ],
};

const edited = replaceSceneShotPrompt(plan, 1, "edited arrival");
assert.equal(edited.shots[0].prompt, "edited arrival");
assert.equal(plan.shots[0].prompt, "wide arrival", "editing must not mutate the stored plan");

const moved = moveScenePlanShot(plan, 2, -1);
assert.deepEqual(moved.shots.map((shot) => shot.title), ["Departure", "Arrival"]);
assert.deepEqual(moved.shots.map((shot) => shot.index), [1, 2], "reordered shots must keep consecutive execution indices");
assert.equal(scenePlanCanExecute("pending", "same", "same"), true);
assert.equal(scenePlanCanExecute("pending", "old", "new"), false, "changed references must invalidate approval");
assert.equal(scenePlanCanExecute("completed", "same", "same"), false, "completed plans cannot run twice");

assert.equal(pinterestConfiguration({}).configured, false);
assert.deepEqual(pinterestConfiguration({}).missing, ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "PINTEREST_REDIRECT_URI"]);
assert.equal(pinterestConfiguration({
  PINTEREST_CLIENT_ID: "id",
  PINTEREST_CLIENT_SECRET: "secret",
  PINTEREST_REDIRECT_URI: "https://example.test/callback",
}).configured, true);

console.log("creative intelligence invariants passed");

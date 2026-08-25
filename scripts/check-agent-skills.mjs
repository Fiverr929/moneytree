import assert from "node:assert/strict";
import { applySkillContract, runSkillChecks } from "../src/lib/brief-agent/skillContract.ts";

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

const secondSubject = {
  imageId: "model-2",
  role: "SUBJECT",
  label: "MODEL 2",
  strength: 50,
  visualRead: "A tall man in a cobalt jacket with closely cropped hair.",
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

const bothSubjects = runSkillChecks(draft(
  "MODEL 1 wears a brushed steel wristwatch with a circular black dial beside MODEL 2, a tall man in a cobalt jacket.",
  [{ ...watch, label: "MODEL 1" }, secondSubject],
));
assert.equal(
  bothSubjects.find((check) => check.id === "multi-subject-coverage")?.status,
  "pass",
  "each active Subject should contribute distinct evidence",
);

const omittedSubjectDraft = {
  ...draft(
    "A tall man in a cobalt jacket poses alone in a studio.",
    [{ ...watch, label: "MODEL 1" }, secondSubject],
  ),
  status: "draft",
  action: "draft",
  reply: "Starting generation.",
  warnings: [],
  skillChecks: [],
  readyToExecute: false,
  session: {
    projectIntent: "Compose both models.",
    selectedDirection: "",
    directions: [],
    lastDraftPrompt: "A tall man in a cobalt jacket poses alone in a studio.",
    unresolvedQuestions: [],
    notes: [],
  },
};
const blockedOmission = applySkillContract(omittedSubjectDraft);
assert.equal(
  blockedOmission.skillChecks.find((check) => check.id === "multi-subject-coverage")?.status,
  "warning",
  "an omitted active Subject should be detected",
);
assert.equal(blockedOmission.action, "inspect", "multi-subject omissions should block generation");
assert.equal(blockedOmission.finalPrompt, "", "the incomplete prompt should be removed");

const alternateViews = runSkillChecks({
  ...draft(
    "Use these alternate views of the same subject to create a single portrait.",
    [{ ...watch, label: "MODEL FRONT" }, secondSubject],
  ),
  messages: [{ role: "user", text: "These are alternate views of the same subject." }],
});
assert.equal(
  alternateViews.some((check) => check.id === "multi-subject-coverage"),
  false,
  "an explicit same-entity relationship should not force duplicate subjects",
);

const womanSubject = {
  imageId: "paoul",
  role: "SUBJECT",
  label: "PAOUL",
  strength: 50,
  visualRead: "A woman standing against a plain dark background, wearing a graphic top.",
};
const manScene = {
  imageId: "shoe-scene",
  role: "SCENE",
  label: "COURTYARD",
  strength: 50,
  visualRead: "A man sits on a stone table and leans forward to tie his shoes in a house courtyard.",
};

const preservedSubject = runSkillChecks(draft(
  "The woman from the subject image sits on a stone table and leans forward to tie her shoes in a house courtyard.",
  [womanSubject, manScene],
));
assert.equal(
  preservedSubject.find((check) => check.id === "subject-identity-consistency")?.status,
  "pass",
  "Scene action may transfer without replacing the female Subject",
);

const swappedSubjectDraft = {
  ...draft(
    "A fair-skinned man sits on a stone table and leans forward to tie his shoes in a house courtyard.",
    [womanSubject, manScene],
  ),
  status: "draft",
  action: "draft",
  reply: "Starting generation.",
  warnings: [],
  skillChecks: [],
  readyToExecute: false,
  session: {
    projectIntent: "Compose the references.",
    selectedDirection: "",
    directions: [],
    lastDraftPrompt: "A fair-skinned man ties his shoes.",
    unresolvedQuestions: [],
    notes: [],
  },
};
const blockedSwap = applySkillContract(swappedSubjectDraft);
assert.equal(
  blockedSwap.skillChecks.find((check) => check.id === "subject-identity-consistency")?.status,
  "warning",
  "opposite-gender Scene identity leakage should be detected",
);
assert.equal(blockedSwap.action, "inspect", "identity conflicts should not auto-generate");
assert.equal(blockedSwap.finalPrompt, "", "the conflicting prompt should be removed");

const neutralSubject = runSkillChecks(draft(
  "PAOUL sits on a stone table and leans forward to tie their shoes in a house courtyard.",
  [womanSubject, manScene],
));
assert.equal(
  neutralSubject.find((check) => check.id === "subject-identity-consistency")?.status,
  "pass",
  "neutral prompt wording should remain valid",
);

const manSubject = {
  ...womanSubject,
  imageId: "male-subject",
  visualRead: "A man standing against a plain dark background, wearing a graphic top.",
};
const womanScene = {
  ...manScene,
  imageId: "female-scene",
  visualRead: "A woman sits on a stone table and leans forward to tie her shoes in a house courtyard.",
};
const inverseSwap = runSkillChecks(draft(
  "A woman sits on a stone table and leans forward to tie her shoes in a house courtyard.",
  [manSubject, womanScene],
));
assert.equal(
  inverseSwap.find((check) => check.id === "subject-identity-consistency")?.status,
  "warning",
  "the safeguard should work in both identity directions",
);

console.log("Agent skill checks passed");

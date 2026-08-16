import assert from "node:assert/strict";
import {
  applyAgentAppAction,
  parseAgentAppActions,
} from "../src/lib/brief-agent/appActions.ts";
import {
  canResolveAgentActionProposal,
  createAgentActionProposal,
  proposalStatusFromEvents,
  recoverInterruptedActionProposal,
  resolveAgentActionProposal,
} from "../src/lib/brief-agent/actionApproval.ts";
import {
  getGenerationModuleImages,
  MAX_ACTIVE_GENERATION_REFERENCES,
} from "../src/lib/pipeline/module-order.ts";

const workspace = {
  project: { id: 1, name: "Original" },
  folders: [{ id: "folder-a", name: "Campaign" }],
  references: [{
    position: 1,
    imageId: "image-a",
    name: "Bottle",
    label: "Bottle",
    role: "UNASSIGNED",
    strength: 50,
    visible: true,
    folder: null,
  }],
};

const parsed = parseAgentAppActions([
  { type: "reference.set_role", imageId: "image-a", role: "subject" },
  { type: "reference.set_strength", imageId: "image-a", strength: 999 },
  { type: "reference.move", imageId: "image-a", folder: "missing" },
  { type: "reference.set_visibility", imageId: "missing", visible: false },
], workspace);

assert.equal(parsed.length, 2, "invalid targets and folders must be rejected");
assert.equal(parsed[0].type, "reference.set_role");
assert.equal(parsed[1].type, "reference.set_strength");
assert.equal(parsed[1].strength, 100, "strength must be clamped");

const expanded = parseAgentAppActions([
  { type: "folder.create", folder: "mood" },
  { type: "folder.create", folder: "invalid" },
  { type: "reference.duplicate", imageId: "image-a" },
], workspace);
assert.equal(expanded.length, 2, "only approved folder presets and valid duplicate targets are allowed");
assert.equal(expanded[0].type, "folder.create");
assert.equal(expanded[1].type, "reference.duplicate");

const file = {
  id: 1,
  uuid: "image-a",
  folder: null,
  kind: "IMG",
  label: "Bottle",
  name: "Bottle",
  size: "1 MB",
  dims: "1024x1024",
  modified: "now",
  eye: true,
  strength: 50,
  mode: "UNASSIGNED",
  url: "data:image/png;base64,AA==",
};

const applied = applyAgentAppAction({ action: parsed[0], projectName: "Original", files: [file], runId: "run-1" });
assert.equal(applied.files[0].mode, "SUBJECT");
assert.equal(applied.event.status, "completed");
assert.equal(applied.event.inverse?.type, "reference.set_role");

const undone = applyAgentAppAction({ action: applied.event.inverse, projectName: "Original", files: applied.files, runId: "run-1" });
assert.equal(undone.files[0].mode, "UNASSIGNED", "inverse action must restore the previous role");

const folderCreated = applyAgentAppAction({
  action: expanded[0],
  projectName: "Original",
  files: [file],
  folders: [],
  runId: "run-1",
});
assert.equal(folderCreated.folders[0].id, "MOOD");
const folderUndone = applyAgentAppAction({
  action: folderCreated.event.inverse,
  projectName: "Original",
  files: folderCreated.files,
  folders: folderCreated.folders,
  runId: "run-1",
});
assert.equal(folderUndone.folders.length, 0, "undo must remove an unused agent-created folder");

const duplicated = applyAgentAppAction({
  action: expanded[1],
  projectName: "Original",
  files: [file],
  folders: [],
  runId: "run-1",
});
assert.equal(duplicated.files.length, 2);
assert.notEqual(duplicated.files[1].uuid, file.uuid);
assert.equal(duplicated.files[1].url, file.url, "duplicate must preserve the source image data");
const duplicateUndone = applyAgentAppAction({
  action: duplicated.event.inverse,
  projectName: "Original",
  files: duplicated.files,
  folders: duplicated.folders,
  runId: "run-1",
});
assert.equal(duplicateUndone.files.length, 1, "undo must remove only the created duplicate");

const activeCandidates = Array.from({ length: 8 }, (_, index) => ({
  ...file,
  id: index + 10,
  uuid: `active-${index}`,
  modified: String(100 - index),
  mode: "SUBJECT",
}));
const activeReferences = getGenerationModuleImages([
  ...activeCandidates,
  { ...file, id: 99, uuid: "library", folder: "MOOD", mode: "STYLE" },
  { ...file, id: 100, uuid: "hidden", eye: false, mode: "SCENE" },
]);
assert.equal(activeReferences.length, MAX_ACTIVE_GENERATION_REFERENCES);
assert.equal(activeReferences.some((item) => item.uuid === "library"), false, "folder references stay in the library");
assert.equal(activeReferences.some((item) => item.uuid === "hidden"), false, "hidden references are inactive");

const proposal = createAgentActionProposal(parsed, "run-1", 1);
assert.equal(proposal.status, "pending");
assert.equal(proposal.actions.length, 2);
assert.equal(canResolveAgentActionProposal(proposal), true);

const rejected = resolveAgentActionProposal(proposal, "rejected");
assert.equal(rejected.status, "rejected");
assert.equal(canResolveAgentActionProposal(rejected), false, "resolved proposals cannot execute twice");
assert.equal(recoverInterruptedActionProposal({ ...proposal, status: "executing" }).status, "stale");
assert.equal(proposalStatusFromEvents([applied.event]), "completed");
assert.equal(proposalStatusFromEvents([{ ...applied.event, status: "failed" }]), "failed");
assert.equal(proposalStatusFromEvents([applied.event, { ...applied.event, id: "failed", status: "failed" }]), "partially_failed");

console.log("Agent app-action checks passed");

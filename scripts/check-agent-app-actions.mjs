import assert from "node:assert/strict";
import {
  applyAgentAppAction,
  parseAgentAppActions,
} from "../src/lib/brief-agent/appActions.ts";

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

console.log("Agent app-action checks passed");

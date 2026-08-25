import assert from "node:assert/strict";
import { PROJECT_TRASH_RETENTION_MS, projectIsTrashed, projectTrashExpired, projectTrashMetadata } from "../src/lib/projectLifecycle.ts";

const now = new Date("2026-08-25T00:00:00.000Z");
const trashed = projectTrashMetadata(now);
assert.equal(Date.parse(trashed.purgeAfter) - Date.parse(trashed.deletedAt), PROJECT_TRASH_RETENTION_MS);
assert.equal(projectIsTrashed(trashed), true);
assert.equal(projectTrashExpired(trashed, now.getTime() + PROJECT_TRASH_RETENTION_MS - 1), false);
assert.equal(projectTrashExpired(trashed, now.getTime() + PROJECT_TRASH_RETENTION_MS), true);
assert.equal(projectIsTrashed({ deletedAt: null }), false);
console.log("Project lifecycle checks passed");

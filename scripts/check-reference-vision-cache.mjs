import assert from "node:assert/strict";
import { fingerprintReferenceValues } from "../src/lib/brief-agent/referenceFingerprint.ts";
import { cacheReferenceRead, clearReferenceReadCache } from "../src/lib/server/referenceReadCache.ts";

const largeImage = `data:image/png;base64,${"a".repeat(250_000)}`;
const rows = [["image-1", largeImage, "SUBJECT", "Hero", 80, "visible"]];
const fingerprint = fingerprintReferenceValues(rows);
assert.match(fingerprint, /^refs-v3:[a-f0-9]{16}$/);
assert.equal(fingerprint, fingerprintReferenceValues(rows));
assert.notEqual(fingerprint, fingerprintReferenceValues([["image-1", `${largeImage}b`, "SUBJECT", "Hero", 80, "visible"]]));
assert.ok(fingerprint.length < 40, "fingerprints must never carry image data into chat context");

clearReferenceReadCache();
let completedLoads = 0;
const first = await cacheReferenceRead("completed", async () => {
  completedLoads += 1;
  return "vision read";
});
const hit = await cacheReferenceRead("completed", async () => {
  completedLoads += 1;
  return "unexpected";
});
assert.deepEqual(first, { value: "vision read", cache: "miss" });
assert.deepEqual(hit, { value: "vision read", cache: "hit" });
assert.equal(completedLoads, 1);

clearReferenceReadCache();
let sharedLoads = 0;
let release;
const gate = new Promise((resolve) => { release = resolve; });
const owner = cacheReferenceRead("shared", async () => {
  sharedLoads += 1;
  await gate;
  return "shared read";
});
const follower = cacheReferenceRead("shared", async () => {
  sharedLoads += 1;
  return "unexpected";
});
release();
assert.deepEqual(await owner, { value: "shared read", cache: "miss" });
assert.deepEqual(await follower, { value: "shared read", cache: "shared" });
assert.equal(sharedLoads, 1);

clearReferenceReadCache();
await assert.rejects(cacheReferenceRead("retry", async () => { throw new Error("temporary"); }), /temporary/);
const retry = await cacheReferenceRead("retry", async () => "recovered");
assert.deepEqual(retry, { value: "recovered", cache: "miss" });

console.log("Reference vision fingerprint and cache checks passed.");

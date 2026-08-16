import assert from "node:assert/strict";
import { extractMemoryCandidates, normalizeMemoryText, rankMemories } from "../src/lib/brief-agent/memoryPolicy.ts";

assert.deepEqual(extractMemoryCandidates("I prefer warm practical lighting."), [{
  scope: "user",
  kind: "preference",
  text: "I prefer warm practical lighting.",
  confidence: 0.94,
}]);

assert.equal(extractMemoryCandidates("Keep the product label unchanged.")[0]?.scope, "project");
assert.equal(extractMemoryCandidates("Actually, use the blue jacket instead.")[0]?.scope, "session");
assert.deepEqual(extractMemoryCandidates("Can you make a blue jacket?"), []);
assert.equal(normalizeMemoryText(`  ${"a".repeat(500)}  `).length, 360);

const base = {
  projectId: 7,
  sessionId: null,
  source: "conversation",
  confidence: 0.9,
  pinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const ranked = rankMemories([
  { ...base, id: "lighting", scope: "user", kind: "preference", text: "Prefer warm lighting", normalizedText: "prefer warm lighting" },
  { ...base, id: "label", scope: "project", kind: "constraint", text: "Keep the product label unchanged", normalizedText: "keep the product label unchanged" },
  { ...base, id: "jacket", scope: "session", kind: "correction", text: "Use the blue jacket instead", normalizedText: "use the blue jacket instead" },
], "make the jacket blue", 2);

assert.equal(ranked[0].id, "jacket");
assert.equal(ranked.length, 2);

console.log("Agent memory policy checks passed.");

import assert from "node:assert/strict";
import { ACTIVE_MESSAGE_LIMIT, RECENT_MESSAGE_COUNT, compactConversationMessages } from "../src/lib/brief-agent/conversationCompaction.ts";

assert.ok(RECENT_MESSAGE_COUNT < ACTIVE_MESSAGE_LIMIT);
const messages = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 ? "agent" : "user",
  text: `direction ${index}`,
  createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
}));
const compacted = compactConversationMessages(messages);
assert.equal(compacted.archived.length, 16);
assert.equal(compacted.recent.length, 8);
assert.match(compacted.summary, /USER: direction 0/);
assert.match(compacted.summary, /AGENT: direction 15/);
assert.equal(compacted.recent[0].id, "message-16");
console.log("Conversation context invariants passed");

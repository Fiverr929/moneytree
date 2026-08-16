import type { AgentMemoryItem, AgentMemoryKind, AgentMemoryScope } from "./types";

export type MemoryCandidate = {
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  text: string;
  confidence: number;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "i", "in", "is", "it",
  "my", "of", "on", "or", "that", "the", "this", "to", "use", "with", "you",
]);

export function normalizeMemoryText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 360);
}

function words(value: string) {
  return new Set(
    normalizeMemoryText(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}'-]+/gu)
      ?.filter((word) => word.length > 2 && !STOP_WORDS.has(word)) || [],
  );
}

function candidateForSentence(sentence: string): MemoryCandidate | null {
  const text = normalizeMemoryText(sentence);
  if (text.length < 8 || text.startsWith("/")) return null;

  if (/\b(i prefer|my preference|i usually|i always|default to|always use)\b/i.test(text)) {
    return { scope: "user", kind: "preference", text, confidence: 0.94 };
  }
  if (/\b(remember that|for this project|must|must not|never|do not|don't|keep|remain|stay the same|should always)\b/i.test(text)) {
    return { scope: "project", kind: "constraint", text, confidence: 0.9 };
  }
  if (/\b(actually|instead|correction|not .+ but|change that to|i meant)\b/i.test(text)) {
    return { scope: "session", kind: "correction", text, confidence: 0.82 };
  }
  return null;
}

export function extractMemoryCandidates(message: string) {
  const compact = normalizeMemoryText(message);
  if (!compact || compact.endsWith("?") || compact.startsWith("/")) return [];
  const sentences = compact.split(/(?<=[.!])\s+/).slice(0, 6);
  const found = sentences.map(candidateForSentence).filter((item): item is MemoryCandidate => Boolean(item));
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.scope}:${normalizeMemoryText(item.text).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export function scoreMemory(memory: AgentMemoryItem, query: string) {
  const queryWords = words(query);
  const memoryWords = words(memory.text);
  let overlap = 0;
  queryWords.forEach((word) => {
    if (memoryWords.has(word)) overlap += 1;
  });
  const scopeWeight = memory.scope === "session" ? 2.2 : memory.scope === "project" ? 1.6 : 1;
  const kindWeight = memory.kind === "constraint" || memory.kind === "correction" ? 1.2 : 0;
  return overlap * 4 + scopeWeight + kindWeight + memory.confidence * 2 + (memory.pinned ? 8 : 0);
}

export function rankMemories(memories: AgentMemoryItem[], query: string, limit = 8) {
  const deduped = new Map<string, AgentMemoryItem>();
  memories.forEach((memory) => {
    const existing = deduped.get(memory.normalizedText);
    if (!existing || scoreMemory(memory, query) > scoreMemory(existing, query)) {
      deduped.set(memory.normalizedText, memory);
    }
  });
  return [...deduped.values()]
    .sort((left, right) => (
      scoreMemory(right, query) - scoreMemory(left, query)
      || right.updatedAt.localeCompare(left.updatedAt)
    ))
    .slice(0, Math.max(1, Math.min(10, limit)));
}

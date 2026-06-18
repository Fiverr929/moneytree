type DebugRecord = Record<string, unknown>;

declare global {
  interface Window {
    __cafeLastGenerationDebug?: DebugRecord;
  }
}

function truncateDebugValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      return `${value.slice(0, 96)}...[trimmed ${Math.max(0, value.length - 96)} chars]`;
    }
    if (value.length > 2000) {
      return `${value.slice(0, 2000)}...[trimmed ${value.length - 2000} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(truncateDebugValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, truncateDebugValue(entry)]),
    );
  }
  return value;
}

export function storeGenerationDebug(data: DebugRecord) {
  if (typeof window === "undefined") return;
  window.__cafeLastGenerationDebug = truncateDebugValue(data) as DebugRecord;
}

export function patchGenerationDebug(patch: DebugRecord, expectedRunId?: string) {
  if (typeof window === "undefined" || !window.__cafeLastGenerationDebug) return;
  if (expectedRunId && window.__cafeLastGenerationDebug.runId !== expectedRunId) return;
  storeGenerationDebug({
    ...window.__cafeLastGenerationDebug,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function getGenerationDebug() {
  if (typeof window === "undefined") return undefined;
  return window.__cafeLastGenerationDebug;
}

export type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

export function modelUsage(result: unknown): UsageMetadata {
  const usage = (result as { usageMetadata?: UsageMetadata } | null)?.usageMetadata;
  return {
    promptTokenCount: usage?.promptTokenCount,
    candidatesTokenCount: usage?.candidatesTokenCount,
    thoughtsTokenCount: usage?.thoughtsTokenCount,
    cachedContentTokenCount: usage?.cachedContentTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  };
}

export function traceReferenceFingerprint(value: string) {
  return /^refs-v3:[a-f0-9]{16}$/.test(value)
    ? value
    : `legacy:${value.length}chars`;
}

export function logModelUsage(operation: string, model: string, result: unknown, extra: Record<string, unknown> = {}) {
  const usage = modelUsage(result);
  console.info("[cafehtml:request-usage]", JSON.stringify({
    operation,
    model,
    promptTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
    thinkingTokens: usage?.thoughtsTokenCount ?? null,
    cachedTokens: usage?.cachedContentTokenCount ?? null,
    totalTokens: usage?.totalTokenCount ?? null,
    ...extra,
  }));
}

export function logCachedModelUsage(operation: string, model: string, extra: Record<string, unknown> = {}) {
  console.info("[cafehtml:request-usage]", JSON.stringify({
    operation,
    model,
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    ...extra,
  }));
}

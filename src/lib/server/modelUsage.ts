type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
};

export function logModelUsage(operation: string, model: string, result: unknown, extra: Record<string, unknown> = {}) {
  const usage = (result as { usageMetadata?: UsageMetadata } | null)?.usageMetadata;
  console.info("[cafehtml:model-usage]", JSON.stringify({
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

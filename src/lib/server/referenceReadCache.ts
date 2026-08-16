type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type ReferenceReadCacheStatus = "hit" | "miss" | "shared";

const completed = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 100;
const TTL_MS = 6 * 60 * 60 * 1000;

function prune(now: number) {
  for (const [key, entry] of completed) {
    if (entry.expiresAt <= now) completed.delete(key);
  }
  while (completed.size >= MAX_ENTRIES) {
    const oldestKey = completed.keys().next().value as string | undefined;
    if (!oldestKey) break;
    completed.delete(oldestKey);
  }
}

export async function cacheReferenceRead<T>(key: string, load: () => Promise<T>): Promise<{
  value: T;
  cache: ReferenceReadCacheStatus;
}> {
  const now = Date.now();
  const cached = completed.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) {
    completed.delete(key);
    completed.set(key, cached);
    return { value: cached.value, cache: "hit" };
  }
  if (cached) completed.delete(key);

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return { value: await pending, cache: "shared" };

  const promise = load();
  inFlight.set(key, promise);
  try {
    const value = await promise;
    prune(Date.now());
    completed.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return { value, cache: "miss" };
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

export function clearReferenceReadCache() {
  completed.clear();
  inFlight.clear();
}

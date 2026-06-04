/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchJSON(url: string, fetchOptions: RequestInit = {}, opts?: { label?: string, maxRetries?: number, timeoutMs?: number }) {
  const label = opts?.label || '[CafeNet]';
  const maxRetries = opts?.maxRetries ?? 2;
  const timeoutMs = opts?.timeoutMs || 0;

  async function attemptOnce(attempt: number): Promise<any> {
    let timer: NodeJS.Timeout | null = null;
    let options = fetchOptions;

    if (timeoutMs) {
      const controller = new AbortController();
      options = { ...fetchOptions, signal: controller.signal };
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const res = await fetch(url, options);
      if (timer) clearTimeout(timer);
      
      const data = await res.json();
      
      if (!res.ok) {
        if (res.status === 429 && attempt < maxRetries) {
          const wait = (attempt + 1) * 5000;
          console.warn(`${label} 429 rate limit — retrying in ${wait / 1000}s (attempt ${attempt + 1} of ${maxRetries})`);
          await new Promise(r => setTimeout(r, wait));
          return attemptOnce(attempt + 1);
        }
        throw new Error(`${label} ${res.status}: ${JSON.stringify(data)}`);
      }
      return data;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      throw err;
    }
  }

  return attemptOnce(0);
}




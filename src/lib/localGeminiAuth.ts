const SETTINGS_STORAGE_KEY = "cafehtml-settings";

function persistedGeminiApiKey() {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "";
    const saved = JSON.parse(raw) as { geminiApiKey?: unknown };
    return typeof saved.geminiApiKey === "string" ? saved.geminiApiKey.trim() : "";
  } catch {
    return "";
  }
}

export function localGeminiHeaders(apiKey?: string | null): Record<string, string> {
  if (typeof window === "undefined") return {};
  const hostname = window.location.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return {};

  const resolvedApiKey = apiKey?.trim() || persistedGeminiApiKey();
  return resolvedApiKey ? { "X-CafeHTML-Local-Gemini-Key": resolvedApiKey } : {};
}

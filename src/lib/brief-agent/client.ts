import type {
  BriefAgentRequest,
  BriefAgentResponse,
  BriefReferenceReadRequest,
  BriefReferenceReadResponse,
  GenerationInspectionRequest,
  GenerationInspectionResponse,
} from "./types";

export class ReferenceReadRequestError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ReferenceReadRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function localGeminiHeaders(apiKey?: string | null): Record<string, string> {
  if (typeof window === "undefined" || !apiKey?.trim()) return {};
  const hostname = window.location.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]") return {};
  return { "X-CafeHTML-Local-Gemini-Key": apiKey.trim() };
}

export async function requestGenerationInspection(
  input: GenerationInspectionRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<GenerationInspectionResponse> {
  const response = await fetch("/api/brief-agent/inspect-generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...localGeminiHeaders(apiKey) },
    body: JSON.stringify(input),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ReferenceReadRequestError(
      apiErrorMessage(data, "Generation inspection failed."),
      response.status,
      null,
    );
  }
  return data as GenerationInspectionResponse;
}

function apiErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const error = (data as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

export async function requestBriefAgent(
  input: BriefAgentRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<BriefAgentResponse> {
  const response = await fetch("/api/brief-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...localGeminiHeaders(apiKey),
    },
    body: JSON.stringify(input),
    signal,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Brief agent request failed.";
    throw new Error(message);
  }

  return data as BriefAgentResponse;
}

export async function requestReferenceRead(
  input: BriefReferenceReadRequest,
  apiKey?: string | null,
): Promise<BriefReferenceReadResponse> {
  const response = await fetch("/api/brief-agent/read-references", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...localGeminiHeaders(apiKey),
    },
    body: JSON.stringify(input),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = apiErrorMessage(data, "Reference reader request failed.");
    const retryAfterHeader = Number(response.headers.get("retry-after"));
    const retryAfterSeconds = Number((data as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds);
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : null;
    throw new ReferenceReadRequestError(message, response.status, retryAfterMs);
  }

  return data as BriefReferenceReadResponse;
}

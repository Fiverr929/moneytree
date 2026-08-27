import type {
  BriefAgentRequest,
  BriefAgentResponse,
  BriefReferenceReadRequest,
  BriefReferenceReadResponse,
  GenerationInspectionRequest,
  GenerationInspectionResponse,
  ScenePlanRequest,
  ScenePlanResponse,
  VisualBibleDraftRequest,
  VisualBibleDraftResponse,
} from "./types";
import { localGeminiHeaders } from "@/lib/localGeminiAuth";

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

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The request was cancelled.", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("The request was cancelled.", "AbortError"));
    }, { once: true });
  });
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

function validBriefAgentResponse(value: unknown): value is BriefAgentResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<BriefAgentResponse>;
  const draft = response.draft as Partial<BriefAgentResponse["draft"]> | undefined;
  const message = response.message as Partial<BriefAgentResponse["message"]> | undefined;
  const run = response.run as Partial<BriefAgentResponse["run"]> | undefined;
  return response.brain === "model"
    && (typeof response.model === "string" || response.model === null)
    && Array.isArray(response.appActions)
    && !!draft
    && typeof draft.id === "string"
    && typeof draft.reply === "string"
    && typeof draft.finalPrompt === "string"
    && !!draft.session
    && !!message
    && typeof message.id === "string"
    && typeof message.text === "string"
    && typeof message.createdAt === "string"
    && !!run
    && run.version === 1
    && typeof run.id === "string"
    && typeof run.status === "string"
    && Array.isArray(run.steps)
    && Array.isArray(run.generationIds)
    && !!run.budget;
}

export async function requestBriefAgent(
  input: BriefAgentRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<BriefAgentResponse> {
  const body = JSON.stringify(input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("/api/brief-agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...localGeminiHeaders(apiKey),
      },
      body,
      signal,
    });

    const data = await response.json().catch(() => null);
    const requestId = response.headers.get("x-cafehtml-request-id");
    if (!response.ok) {
      const message = apiErrorMessage(data, "Brief agent request failed.");
      if (response.status === 503 && attempt < 2) {
        const retryAfterSeconds = Number((data as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds)
          || Number(response.headers.get("retry-after"))
          || [2, 5][attempt];
        await waitForRetry(Math.max(1, retryAfterSeconds) * 1_000, signal);
        continue;
      }
      const finalMessage = response.status === 503
        ? "The Gemini agent is still busy after automatic retries. Use RETRY or /retry in a moment."
        : message;
      throw new Error(requestId ? `${finalMessage} (Request ${requestId})` : finalMessage);
    }

    if (!validBriefAgentResponse(data)) {
      throw new Error(requestId
        ? `The brief agent returned an incomplete response. Try again. (Request ${requestId})`
        : "The brief agent returned an incomplete response. Try again.");
    }

    return data;
  }

  throw new Error("The Gemini agent is temporarily unavailable. Use RETRY or /retry in a moment.");
}

export async function requestReferenceRead(
  input: BriefReferenceReadRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<BriefReferenceReadResponse> {
  const response = await fetch("/api/brief-agent/read-references", {
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

export async function requestScenePlan(
  input: ScenePlanRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<ScenePlanResponse> {
  const response = await fetch("/api/brief-agent/plan-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...localGeminiHeaders(apiKey) },
    body: JSON.stringify(input),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(apiErrorMessage(data, "Scene planning failed."));
  }
  return data as ScenePlanResponse;
}

export async function requestVisualBibleDraft(
  input: VisualBibleDraftRequest,
  apiKey?: string | null,
  signal?: AbortSignal,
): Promise<VisualBibleDraftResponse> {
  const response = await fetch("/api/brief-agent/compile-bible", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...localGeminiHeaders(apiKey) },
    body: JSON.stringify(input),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiErrorMessage(data, "Visual Bible drafting failed."));
  return data as VisualBibleDraftResponse;
}

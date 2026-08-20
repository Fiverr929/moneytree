import { NextResponse } from "next/server";
import type { GenerationInspectionRequest, GenerationInspectionResponse } from "@/lib/brief-agent/types";
import { createGoogleGenAI } from "@/lib/server/googleGenAI";
import { logModelUsage } from "@/lib/server/modelUsage";

export const runtime = "nodejs";
export const maxDuration = 90;

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Generation image data is invalid.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_TYPES.has(mimeType)) throw new Error("Generation inspection supports JPEG, PNG, and WebP.");
  if (Math.floor(match[2].length * 0.75) > MAX_IMAGE_BYTES) throw new Error("A generation image is too large to inspect.");
  return { mimeType, data: match[2] };
}

function validateRequest(request: Request, value: unknown): GenerationInspectionRequest {
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV === "production" && !origin) throw new Error("Generation inspection requires a same-origin request.");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin generation inspection is not allowed.");
  if (!value || typeof value !== "object" || !Array.isArray((value as { images?: unknown }).images)) {
    throw new Error("Generation images are required.");
  }
  const images = (value as GenerationInspectionRequest).images.slice(0, MAX_IMAGES).map((image) => {
    if (!image || typeof image.generationId !== "string" || typeof image.dataUrl !== "string") {
      throw new Error("Generation image data is invalid.");
    }
    parseDataUrl(image.dataUrl);
    return {
      generationId: image.generationId.slice(0, 160),
      dataUrl: image.dataUrl,
      prompt: typeof image.prompt === "string" ? image.prompt.slice(0, 3000) : "",
    };
  });
  if (!images.length) throw new Error("At least one generation is required for inspection.");
  return { images };
}

function responseText(result: unknown) {
  if (result && typeof result === "object" && "text" in result && typeof result.text === "string") return result.text;
  return (result as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

function parseJson(text: string) {
  try {
    return JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Generation inspection returned an invalid response.");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function cleanText(value: unknown, limit = 1600) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function describeError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Generation inspection failed.";
  const lower = raw.toLowerCase();
  if (lower.includes("billing_disabled") || lower.includes("billing to be enabled") || lower.includes("billing is disabled")) {
    return { message: "Google Cloud billing is disabled for the configured Vertex AI project. Enable billing, or on localhost add a Gemini API key in Settings.", status: 403 };
  }
  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("resource exhausted") || lower.includes("quota")) {
    return { message: "Generation vision is temporarily busy. Try inspection again shortly.", status: 429 };
  }
  if (lower.includes("permission_denied") || lower.includes("permission denied") || lower.includes("403")) {
    return { message: "Vertex AI denied generation inspection. Check project permissions and API enablement.", status: 403 };
  }
  if (lower.includes("unauthenticated") || lower.includes("credential") || lower.includes("401")) {
    return { message: "Generation vision authentication is not configured. Add GEMINI_API_KEY as a server secret.", status: 401 };
  }
  return { message: raw, status: 400 };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const input = validateRequest(request, await request.json());
    const localApiKey = process.env.NODE_ENV === "production"
      ? null
      : request.headers.get("x-cafehtml-local-gemini-key");
    const model = process.env.BRIEF_GENERATION_INSPECTION_MODEL?.trim()
      || process.env.BRIEF_REFERENCE_MODEL?.trim()
      || DEFAULT_MODEL;

    const parts = [
      { text: [
        "Inspect the supplied generated image or compare the two supplied generated images.",
        "For each image, describe only visible evidence: subject, composition, lighting, color, style, details, text, artifacts, and quality.",
        "Use its prompt only to identify matches or deviations. Do not invent invisible details.",
        "When two images are present, give a concise evidence-based comparison.",
        "Return JSON only: {\"observations\":[{\"generationId\":\"string\",\"visualRead\":\"string\"}],\"comparison\":\"string or empty\"}.",
        `Generation metadata: ${JSON.stringify(input.images.map(({ generationId, prompt }) => ({ generationId, prompt })))}`,
      ].join("\n") },
      ...input.images.flatMap((image, index) => {
        const parsed = parseDataUrl(image.dataUrl);
        return [
          { text: `Generation ${index + 1}: ${image.generationId}` },
          { inlineData: { mimeType: parsed.mimeType, data: parsed.data } },
        ];
      }),
    ];
    const ai = createGoogleGenAI({ apiKey: localApiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });
    logModelUsage("brief-agent.inspect-generations", model, result, {
      requestId,
      imageCount: input.images.length,
      durationMs: Date.now() - startedAt,
    });
    const json = parseJson(responseText(result));
    const rawObservations = Array.isArray(json.observations) ? json.observations : [];
    const observations = input.images.map((image) => {
      const found = rawObservations.find((item) => item && typeof item === "object"
        && (item as { generationId?: unknown }).generationId === image.generationId) as { visualRead?: unknown } | undefined;
      return { generationId: image.generationId, visualRead: cleanText(found?.visualRead) };
    });
    const response: GenerationInspectionResponse = {
      model,
      observations,
      comparison: input.images.length > 1 ? cleanText(json.comparison) || null : null,
    };
    return NextResponse.json(response, { headers: { "X-CafeHTML-Request-Id": requestId } });
  } catch (error) {
    const described = describeError(error);
    return NextResponse.json(
      { error: described.message },
      { status: described.status, headers: { "X-CafeHTML-Request-Id": requestId } },
    );
  }
}

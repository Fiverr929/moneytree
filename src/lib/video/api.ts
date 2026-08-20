export type VeoGenerationRequest = {
  modelId: string;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8;
  resolution: "720p" | "1080p" | "4k";
  seed?: number;
  startFrame?: string;
  endFrame?: string;
  referenceImages?: string[];
  motionProfile?: "subtle" | "natural" | "dynamic";
  cameraMotion?: "auto" | "locked" | "push-in" | "pull-out" | "pan-left" | "pan-right" | "orbit" | "tracking";
  negativePrompt?: string;
  enhancePrompt?: boolean;
};

export type GeneratedVideoResult = {
  blob: Blob;
};

function localGeminiHeaders(apiKey?: string | null): Record<string, string> {
  if (typeof window === "undefined" || !apiKey?.trim()) return {};
  const hostname = window.location.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return {};
  return { "X-CafeHTML-Local-Gemini-Key": apiKey.trim() };
}

export async function generateVeoVideo(
  request: VeoGenerationRequest,
  apiKey?: string | null,
): Promise<GeneratedVideoResult> {
  const response = await fetch("/api/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...localGeminiHeaders(apiKey),
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "The video server returned an invalid response." })) as {
      error?: string;
    };
    throw new Error(payload.error || `Video generation failed with status ${response.status}.`);
  }

  return { blob: await response.blob() };
}

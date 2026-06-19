export type VeoGenerationRequest = {
  modelId: string;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8;
  resolution: "720p" | "1080p";
  seed?: number;
  startFrame?: string;
  endFrame?: string;
  referenceImages?: string[];
};

export type GeneratedVideoResult = {
  blob: Blob;
};

export async function generateVeoVideo(request: VeoGenerationRequest): Promise<GeneratedVideoResult> {
  const response = await fetch("/api/video/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

type MaskValidation = {
  valid: boolean;
  reason?: string;
};

function parseDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  return { base64, mimeType: mimeMatch ? mimeMatch[1] : "image/png" };
}

export async function requestGeminiMask(opts: {
  apiKey: string;
  modelId: string;
  imageUrl: string;
  instruction: string;
}) {
  const parsed = parseDataUrl(opts.imageUrl);
  const prompt = [
    "Create a 2D alpha mask image. Do not edit the photo.",
    "Return one PNG image only: a black, white, and gray mask matching the input image exactly.",
    "Follow the user instruction exactly when deciding what stays visible.",
    "Pure white (#ffffff) = keep visible.",
    "Pure black (#000000) = make transparent.",
    "Use gray only for 1-3 pixel soft antialiasing at edges.",
    "The returned image must not contain red, blue, green, skin tones, original photo colors, checkerboards, outlines, labels, captions, or explanations.",
    "Every pixel should be neutral grayscale, meaning red equals green equals blue.",
    "If you include the original photo or any colored background, the result is invalid.",
    "Do not crop, resize, move, rotate, redraw, or stylize anything.",
    "The mask must preserve the input's exact framing, scale, and composition.",
    "",
    "User instruction:",
    opts.instruction,
  ].join("\n");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        imageSize: "1K",
        imageOutputOptions: { mimeType: "image/png" },
      },
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    ],
  };

  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${opts.modelId}:generateContent?key=${opts.apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Gemini request failed before response: ${err instanceof Error ? err.message : String(err)}`);
  }
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${JSON.stringify(data)}`);
  }

  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        return `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}`;
      }
    }
  }

  throw new Error("Gemini returned no mask image");
}

export function validateMask(maskData: Uint8ClampedArray): MaskValidation {
  let saturatedPixels = 0;
  let nonGrayPixels = 0;
  let total = 0;

  for (let i = 0; i < maskData.length; i += 4) {
    const r = maskData[i];
    const g = maskData[i + 1];
    const b = maskData[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    total += 1;

    if (chroma > 18) nonGrayPixels += 1;
    if (chroma > 45 && max > 80) saturatedPixels += 1;
  }

  const nonGrayRatio = nonGrayPixels / Math.max(1, total);
  const saturatedRatio = saturatedPixels / Math.max(1, total);

  if (saturatedRatio > 0.02 || nonGrayRatio > 0.08) {
    return {
      valid: false,
      reason: "Gemini returned a colored/edited image instead of a grayscale mask. Try a stricter instruction like: keep only the shirt and text; make everything else black.",
    };
  }

  return { valid: true };
}

"use client";

export function formatDataUrlSize(url: string) {
  const base64 = url.split(",")[1] || "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${kb} KB`;
}

export function deriveEditedName(name: string) {
  const trimmed = (name || "IMAGE").trim();
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const ext = dot > 0 ? trimmed.slice(dot) : ".png";
  return / EDIT$/i.test(stem) ? `${stem}${ext}` : `${stem} EDIT${ext}`;
}

export function dimensionsToRatio(width: number, height: number) {
  if (!width || !height) return "1:1";
  const presets = [
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "21:9", value: 21 / 9 },
  ];
  const actual = width / height;
  const closest = presets.reduce((best, preset) => {
    return Math.abs(preset.value - actual) < Math.abs(best.value - actual) ? preset : best;
  });
  return Math.abs(closest.value - actual) <= 0.08 ? closest.label : width >= height ? "16:9" : "9:16";
}

export function loadImageMetadata(url: string) {
  return new Promise<{ width: number; height: number; dims: string; ratio: string; size: string }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      resolve({
        width,
        height,
        dims: `${width}x${height}`,
        ratio: dimensionsToRatio(width, height),
        size: formatDataUrlSize(url),
      });
    };
    img.onerror = () => reject(new Error("Failed to read image metadata"));
    img.src = url;
  });
}

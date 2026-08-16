import { createBluePreview, loadImage, type MaskResult } from "./canvasAlpha";

export type BgCommand = {
  mode: "color" | "auto";
  color?: [number, number, number];
  colorName?: string;
  edgeMode: "balanced" | "strict" | "soft" | "max";
};

export type ColorCommand = BgCommand;

const NAMED_BG_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  pink: [255, 192, 203],
  purple: [128, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

export function parseBgCommand(instruction: string): BgCommand | null {
  return parseColorLikeCommand(instruction, "bg");
}

export function parseColorCommand(instruction: string): ColorCommand | null {
  return parseColorLikeCommand(instruction, "color");
}

function parseColorLikeCommand(instruction: string, commandName: "bg" | "color"): BgCommand | null {
  const trimmed = instruction.trim();
  const match = trimmed.match(new RegExp(`^/${commandName}(?:\\s+([^\\s]+))?(?:\\s+([^\\s]+))?`, "i"));
  if (!match) return null;

  const value = (match[1] || "auto").toLowerCase();
  const modifier = (match[2] || "").toLowerCase();
  const edgeMode = modifier === "strict" || modifier === "soft" || modifier === "max" ? modifier : "balanced";

  if (value === "auto") return { mode: "auto", edgeMode };

  const named = NAMED_BG_COLORS[value];
  if (named) return { mode: "color", color: named, colorName: value, edgeMode };

  const hex = value.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    return {
      mode: "color",
      colorName: `#${raw.toUpperCase()}`,
      edgeMode,
      color: [
        parseInt(raw.slice(0, 2), 16),
        parseInt(raw.slice(2, 4), 16),
        parseInt(raw.slice(4, 6), 16),
      ],
    };
  }

  return { mode: "auto", edgeMode };
}

export async function removeEdgeBackground(originalUrl: string, invert: boolean, command: BgCommand): Promise<MaskResult> {
  const original = await loadImage(originalUrl);
  const canvas = document.createElement("canvas");
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  ctx.drawImage(original, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const visited = new Uint8Array(width * height);
  const alphaMap = new Uint8ClampedArray(width * height);
  const queue: number[] = [];
  const target = command.mode === "auto" ? sampleBorderColor(data, width, height) : command.color!;
  const toleranceBase = command.mode === "auto" ? 34 : 42;
  const tolerance = command.edgeMode === "strict"
    ? Math.max(20, toleranceBase - 16)
    : command.edgeMode === "max"
      ? toleranceBase + 24
    : command.edgeMode === "soft"
      ? toleranceBase + 10
      : toleranceBase;
  const targetAvg = (target[0] + target[1] + target[2]) / 3;

  function colorDistance(index: number) {
    const i = index * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dr = r - target[0];
    const dg = g - target[1];
    const db = b - target[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function pixelStats(index: number) {
    const i = index * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return {
      avg: (r + g + b) / 3,
      spread: Math.max(r, g, b) - Math.min(r, g, b),
    };
  }

  function isTargetLike(index: number) {
    return colorDistance(index) <= tolerance;
  }

  function push(index: number) {
    if (index < 0 || index >= visited.length || visited[index] || !isTargetLike(index)) return;
    visited[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  for (let q = 0; q < queue.length; q += 1) {
    const index = queue[q];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  alphaMap.fill(255);
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) alphaMap[index] = 0;
  }

  function hasRemovedNeighbor(index: number, radius: number) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (visited[ny * width + nx]) return true;
      }
    }
    return false;
  }

  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) continue;
    if (!hasRemovedNeighbor(index, 2)) continue;

    const distance = colorDistance(index);
    const stats = pixelStats(index);
    const likelyLightFringe = targetAvg > 220 && stats.avg > 176 && stats.spread < 62;
    const likelyDarkFringe = targetAvg < 36 && stats.avg < 86 && stats.spread < 62;
    const fringeReachBase = command.edgeMode === "strict" ? 32 : command.edgeMode === "max" ? 170 : command.edgeMode === "soft" ? 132 : 108;
    const neutralReachBase = command.edgeMode === "strict" ? 20 : command.edgeMode === "max" ? 108 : command.edgeMode === "soft" ? 72 : 50;
    const fringeReach = likelyLightFringe || likelyDarkFringe ? tolerance + fringeReachBase : tolerance + neutralReachBase;

    if (distance <= tolerance + 10) {
      alphaMap[index] = 0;
    } else if (distance <= fringeReach) {
      const t = (distance - tolerance - 10) / Math.max(1, fringeReach - tolerance - 10);
      alphaMap[index] = Math.max(24, Math.min(220, Math.round(t * 255)));
    }
  }

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Mask canvas is unavailable");
  const maskData = maskCtx.createImageData(width, height);

  for (let index = 0; index < visited.length; index += 1) {
    const i = index * 4;
    const alpha = alphaMap[index];
    const finalAlpha = invert ? 255 - alpha : alpha;
    data[i + 3] = finalAlpha;
    maskData.data[i] = finalAlpha;
    maskData.data[i + 1] = finalAlpha;
    maskData.data[i + 2] = finalAlpha;
    maskData.data[i + 3] = 255;
  }

  maskCtx.putImageData(maskData, 0, 0);
  ctx.putImageData(imageData, 0, 0);

  return {
    rawMaskUrl: maskCanvas.toDataURL("image/png"),
    outputUrl: canvas.toDataURL("image/png"),
    previewUrl: createBluePreview(canvas),
    source: "local-bg",
    sourceLabel: formatBgLabel(command, target),
  };
}

export async function removeGlobalColor(originalUrl: string, invert: boolean, command: ColorCommand): Promise<MaskResult> {
  const original = await loadImage(originalUrl);
  const canvas = document.createElement("canvas");
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  ctx.drawImage(original, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  const target = command.mode === "auto" ? sampleBorderColor(data, width, height) : command.color!;
  const baseTolerance = command.mode === "auto" ? 36 : 44;
  const tolerance = command.edgeMode === "strict"
    ? Math.max(18, baseTolerance - 18)
    : command.edgeMode === "max"
      ? baseTolerance + 42
    : command.edgeMode === "soft"
      ? baseTolerance + 18
      : baseTolerance;
  const feather = command.edgeMode === "strict" ? 18 : command.edgeMode === "max" ? 120 : command.edgeMode === "soft" ? 82 : 46;
  const targetAvg = (target[0] + target[1] + target[2]) / 3;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Mask canvas is unavailable");
  const maskData = maskCtx.createImageData(width, height);
  const alphaMap = new Uint8ClampedArray(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const i = index * 4;
    const dr = data[i] - target[0];
    const dg = data[i + 1] - target[1];
    const db = data[i + 2] - target[2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const spread = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    const maxLightCleanup = command.edgeMode === "max" && targetAvg > 220 && avg > 156 && spread < 72;
    const maxDarkCleanup = command.edgeMode === "max" && targetAvg < 35 && avg < 100 && spread < 72;
    let alpha = 255;

    if (maxLightCleanup || maxDarkCleanup || distance <= tolerance) {
      alpha = 0;
    } else if (distance <= tolerance + feather) {
      const t = (distance - tolerance) / feather;
      alpha = Math.max(24, Math.min(255, Math.round(t * 255)));
    }

    alphaMap[index] = alpha;
  }

  if (command.edgeMode === "max" && !invert) {
    defringeAlphaMap(alphaMap, data, width, height, target);
  }

  for (let index = 0; index < width * height; index += 1) {
    const i = index * 4;
    const alpha = alphaMap[index];
    const finalAlpha = invert ? 255 - alpha : alpha;
    data[i + 3] = finalAlpha;
    maskData.data[i] = finalAlpha;
    maskData.data[i + 1] = finalAlpha;
    maskData.data[i + 2] = finalAlpha;
    maskData.data[i + 3] = 255;
  }

  maskCtx.putImageData(maskData, 0, 0);
  ctx.putImageData(imageData, 0, 0);

  return {
    rawMaskUrl: maskCanvas.toDataURL("image/png"),
    outputUrl: canvas.toDataURL("image/png"),
    previewUrl: createBluePreview(canvas),
    source: "color",
    sourceLabel: formatColorLabel(command, target),
  };
}

function defringeAlphaMap(
  alphaMap: Uint8ClampedArray,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  target: [number, number, number],
) {
  const nextAlpha = new Uint8ClampedArray(alphaMap);
  const targetAvg = (target[0] + target[1] + target[2]) / 3;

  function hasTransparentNeighbor(index: number, radius: number) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (alphaMap[ny * width + nx] <= 12) return true;
      }
    }
    return false;
  }

  for (let index = 0; index < alphaMap.length; index += 1) {
    const alpha = alphaMap[index];
    if (alpha <= 0 || alpha >= 255 || !hasTransparentNeighbor(index, 2)) continue;

    const i = index * 4;
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const spread = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    const lightFringe = targetAvg > 220 && avg > 118 && spread < 96;
    const darkFringe = targetAvg < 35 && avg < 138 && spread < 96;

    if (lightFringe || darkFringe) {
      nextAlpha[index] = Math.min(alpha, 48);
    }

    if (alpha > 0 && alpha < 245) {
      const a = Math.max(0.08, alpha / 255);
      data[i] = Math.max(0, Math.min(255, Math.round((data[i] - target[0] * (1 - a)) / a)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round((data[i + 1] - target[1] * (1 - a)) / a)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round((data[i + 2] - target[2] * (1 - a)) / a)));
    }
  }

  alphaMap.set(nextAlpha);
}

function formatBgLabel(command: BgCommand, target: [number, number, number]) {
  const mode = command.mode === "auto"
    ? `/bg auto #${target.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`
    : `/bg ${command.colorName || "color"}`;

  return command.edgeMode === "balanced" ? mode : `${mode} ${command.edgeMode}`;
}

function formatColorLabel(command: ColorCommand, target: [number, number, number]) {
  const mode = command.mode === "auto"
    ? `/color auto #${target.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`
    : `/color ${command.colorName || "color"}`;

  return command.edgeMode === "balanced" ? mode : `${mode} ${command.edgeMode}`;
}

function sampleBorderColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

  function addPixel(x: number, y: number) {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${Math.round(r / 16)},${Math.round(g / 16)},${Math.round(b / 16)}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  for (let x = 0; x < width; x += 1) {
    addPixel(x, 0);
    addPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    addPixel(0, y);
    addPixel(width - 1, y);
  }

  let best = { count: 0, r: 255, g: 255, b: 255 };
  buckets.forEach((bucket) => {
    if (bucket.count > best.count) best = bucket;
  });

  return [
    Math.round(best.r / Math.max(1, best.count)),
    Math.round(best.g / Math.max(1, best.count)),
    Math.round(best.b / Math.max(1, best.count)),
  ];
}

import { validateMask } from "./maskGemini";

export type MaskSource = "gemini" | "local-bg" | "color";

export type MaskResult = {
  rawMaskUrl: string;
  outputUrl: string;
  previewUrl: string;
  source: MaskSource;
  sourceLabel: string;
};

export function parseDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  return { base64, mimeType: mimeMatch ? mimeMatch[1] : "image/png" };
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function createBluePreview(source: HTMLCanvasElement) {
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = source.width;
  previewCanvas.height = source.height;
  const previewCtx = previewCanvas.getContext("2d");
  if (!previewCtx) throw new Error("Preview canvas is unavailable");

  previewCtx.fillStyle = "#145ad2";
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(source, 0, 0);
  return previewCanvas.toDataURL("image/png");
}

export function shouldAutoInvertMask(maskData: Uint8ClampedArray, width: number, height: number) {
  let borderSum = 0;
  let borderCount = 0;
  let centerSum = 0;
  let centerCount = 0;

  const centerLeft = Math.floor(width * 0.25);
  const centerRight = Math.ceil(width * 0.75);
  const centerTop = Math.floor(height * 0.25);
  const centerBottom = Math.ceil(height * 0.75);

  function brightnessAt(x: number, y: number) {
    const i = (y * width + x) * 4;
    return (maskData[i] + maskData[i + 1] + maskData[i + 2]) / 3;
  }

  for (let x = 0; x < width; x += 1) {
    borderSum += brightnessAt(x, 0) + brightnessAt(x, height - 1);
    borderCount += 2;
  }
  for (let y = 1; y < height - 1; y += 1) {
    borderSum += brightnessAt(0, y) + brightnessAt(width - 1, y);
    borderCount += 2;
  }
  for (let y = centerTop; y < centerBottom; y += 1) {
    for (let x = centerLeft; x < centerRight; x += 1) {
      centerSum += brightnessAt(x, y);
      centerCount += 1;
    }
  }

  const borderAvg = borderSum / Math.max(1, borderCount);
  const centerAvg = centerSum / Math.max(1, centerCount);
  return borderAvg > 170 && centerAvg < borderAvg - 20;
}

function cleanMaskAlpha(alphaMap: Uint8ClampedArray, width: number, height: number) {
  const binary = new Uint8Array(width * height);
  const queue: number[] = [];
  const removeTinyForegroundBelow = Math.max(24, Math.round(width * height * 0.00018));
  const fillTinyHolesBelow = Math.max(20, Math.round(width * height * 0.00012));

  for (let i = 0; i < alphaMap.length; i += 1) {
    const alpha = alphaMap[i];
    if (alpha < 48) alphaMap[i] = 0;
    else if (alpha > 210) alphaMap[i] = 255;
    binary[i] = alphaMap[i] > 0 ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  function collectComponent(start: number, target: 0 | 1) {
    const component: number[] = [];
    let touchesBorder = false;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    for (let q = 0; q < queue.length; q += 1) {
      const index = queue[q];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];

      for (const next of neighbors) {
        if (next < 0 || visited[next] || binary[next] !== target) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    return { component, touchesBorder };
  }

  for (let i = 0; i < binary.length; i += 1) {
    if (visited[i] || binary[i] !== 1) continue;
    const { component } = collectComponent(i, 1);
    if (component.length < removeTinyForegroundBelow) {
      component.forEach((index) => {
        binary[index] = 0;
        alphaMap[index] = 0;
      });
    }
  }

  visited.fill(0);
  for (let i = 0; i < binary.length; i += 1) {
    if (visited[i] || binary[i] !== 0) continue;
    const { component, touchesBorder } = collectComponent(i, 0);
    if (!touchesBorder && component.length < fillTinyHolesBelow) {
      component.forEach((index) => {
        binary[index] = 1;
        alphaMap[index] = 255;
      });
    }
  }
}

export async function applyMask(originalUrl: string, maskUrl: string, invert: boolean): Promise<MaskResult> {
  const [original, mask] = await Promise.all([loadImage(originalUrl), loadImage(maskUrl)]);

  const canvas = document.createElement("canvas");
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  ctx.drawImage(original, 0, 0);
  const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = canvas.width;
  maskCanvas.height = canvas.height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Mask canvas is unavailable");

  maskCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height).data;
  const validation = validateMask(maskData);
  if (!validation.valid) {
    throw new Error(validation.reason || "Gemini returned an invalid mask");
  }
  const shouldInvert = shouldAutoInvertMask(maskData, canvas.width, canvas.height) !== invert;
  const alphaMap = new Uint8ClampedArray(canvas.width * canvas.height);

  for (let i = 0; i < alphaMap.length; i += 1) {
    const dataIndex = i * 4;
    const brightness = Math.round((maskData[dataIndex] + maskData[dataIndex + 1] + maskData[dataIndex + 2]) / 3);
    alphaMap[i] = shouldInvert ? 255 - brightness : brightness;
  }

  cleanMaskAlpha(alphaMap, canvas.width, canvas.height);

  for (let i = 0; i < originalData.data.length; i += 4) {
    originalData.data[i + 3] = alphaMap[i / 4];
    maskData[i] = alphaMap[i / 4];
    maskData[i + 1] = alphaMap[i / 4];
    maskData[i + 2] = alphaMap[i / 4];
    maskData[i + 3] = 255;
  }

  maskCtx.putImageData(new ImageData(maskData, canvas.width, canvas.height), 0, 0);
  ctx.putImageData(originalData, 0, 0);

  return {
    rawMaskUrl: maskCanvas.toDataURL("image/png"),
    outputUrl: canvas.toDataURL("image/png"),
    previewUrl: createBluePreview(canvas),
    source: "gemini",
    sourceLabel: "/mask",
  };
}

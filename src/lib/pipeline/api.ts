/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchJSON } from './net';
import { getGenerationModuleImages } from './module-order';
import {
  describeReferenceStrength,
  normalizeStrength,
  type ReferenceRole
} from './strength';

function parseDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(',')[1];
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  return { base64, mimeType };
}

type GenerateOptions = {
  modelId: string;
  apiKey: string;
  prompt: string;
  numImages: number;
  aspectRatio: string;
  imageRefs?: string[];
  imageSize?: string;
  thinkingLevel?: string;
  onVariationReady?: (dataUrl: string, idx: number) => void;
  onVariationFailed?: (idx: number, statusLabel?: string) => void;
  onVariationBlocked?: (idx: number, statusLabel?: string) => void;
};

function classifyGenerationError(err: unknown): "BLOCKED" | "QUOTA" | "TIMEOUT" | "FAILED" {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("IMAGE_PROHIBITED_CONTENT") || message.includes("Prompt blocked")) return "BLOCKED";
  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("[CafeAPI] 429") || message.includes(" 429:")) return "QUOTA";
  if ((err instanceof Error && err.name === "AbortError") || message.includes("timed out")) return "TIMEOUT";
  return "FAILED";
}

function isRetryMeaningful(statusLabel?: string): boolean {
  return statusLabel === "TIMEOUT" || statusLabel === "FAILED";
}

export async function googleGenerate(opts: GenerateOptions) {
  const { modelId, apiKey, prompt, numImages, aspectRatio, imageRefs, imageSize, thinkingLevel, onVariationReady, onVariationFailed, onVariationBlocked } = opts;
  
  const arMap: Record<string, string> = { '1:1': '1:1', '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4' };
  const ar = arMap[aspectRatio] || '1:1';

  const parts: {text?: string, inline_data?: {mime_type: string, data: string}}[] = [{ text: prompt }];
  if (imageRefs && imageRefs.length) {
    imageRefs.forEach(ref => {
      const parsed = parseDataUrl(ref);
      parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } });
    });
  }

  const generationConfig: Record<string, any> = {
    responseModalities: ['IMAGE'],
    imageConfig: { aspectRatio: ar, imageSize: imageSize || '1K', imageOutputOptions: { mimeType: 'image/png' } }
  };
  
  if (thinkingLevel && thinkingLevel !== 'none') {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  const systemInstruction = {
    parts: [{
      text: [
        'Follow the user prompt and attached reference images.',
        'The inline images are supplied in the same Image N order named in the prompt.',
        'Use each image according to its label, folder, and any direct user instruction.',
        'Do not create a collage, pasted cutout, side-by-side composite, contact sheet, or flat overlay.',
        'Generate one coherent final image with matching perspective, lighting, shadows, scale, and physical integration.'
      ].join(' ')
    }]
  };

  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${modelId}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' }
    ],
    systemInstruction
  };

  console.log('[CafeAPI] → POST', modelId, '| ar:', ar, '| size:', imageSize, '| thinking:', thinkingLevel || 'none', '| image refs:', imageRefs?.length || 0);

  const calls = Array.from({ length: numImages }).map(async (_, idx) => {
    try {
      const result = await fetchJSON(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, { label: '[CafeAPI]', timeoutMs: 90000 });

      let prediction: any = null;
      let blocked = !!(result.promptFeedback && result.promptFeedback.blockReason);
      
      (result.candidates || []).forEach((candidate: any) => {
        if (candidate.finishReason && candidate.finishReason !== 'STOP') blocked = true;
        if (prediction) return;
        (candidate.content?.parts || []).forEach((part: any) => {
          if (prediction) return;
          const id = part.inlineData || part.inline_data;
          if (id && id.data) {
            prediction = { mimeType: id.mimeType || id.mime_type || 'image/png', bytesBase64Encoded: id.data };
          }
        });
      });

      if (prediction && onVariationReady) {
        onVariationReady(`data:${prediction.mimeType};base64,${prediction.bytesBase64Encoded}`, idx);
      } else if (blocked && onVariationBlocked) {
        onVariationBlocked(idx, 'BLOCKED');
      }
      return result;
    } catch (err) {
      if (onVariationFailed) onVariationFailed(idx, classifyGenerationError(err));
      throw err;
    }
  });

  const settled = await Promise.allSettled(calls);
  const predictions: {mimeType: string, bytesBase64Encoded: string}[] = [];
  let blockReason = null;
  const finishReasons: string[] = [];
  let firstError: Error | null = null;

  settled.forEach(outcome => {
    if (outcome.status === 'rejected') {
      if (!firstError) firstError = outcome.reason;
      console.warn('[CafeAPI] Variation call failed:', outcome.reason?.message || outcome.reason);
      return;
    }
    const result = outcome.value;
    if (result.promptFeedback?.blockReason) {
      blockReason = result.promptFeedback.blockReason;
    }
    (result.candidates || []).forEach((candidate: any) => {
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        finishReasons.push(candidate.finishReason);
      }
      (candidate.content?.parts || []).forEach((part: any) => {
        const id = part.inlineData || part.inline_data;
        if (id && id.data) {
          predictions.push({ mimeType: id.mimeType || id.mime_type || 'image/png', bytesBase64Encoded: id.data });
        }
      });
    });
  });

  if (!predictions.length) {
    if (firstError) throw firstError;
    const reason = blockReason
      ? `Prompt blocked - ${blockReason}`
      : finishReasons.length
        ? `Generation stopped - ${finishReasons.join(', ')}`
        : 'Model returned no images - check console for raw response';
    throw new Error(reason);
  }

  return { predictions };
}

export type GenerationCallbacks = {
  onStart: (count: number) => void;
  onLoadingIds: (ids: string[]) => void;
  onVariationReady: (dataUrl: string, lid: string, cellData: Record<string, any>) => void;
  onVariationBlocked: (lid: string, statusLabel?: string) => void;
  onVariationFailed: (lid: string, retryFn?: (newLid: string) => void, statusLabel?: string) => void;
  onGenerationError?: (ids: string[], statusLabel: string) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
};

export type GenerationSettings = { aspectRatio?: string, variation?: number, activeModel?: { label: string, id: string }, costPerImage?: number, activeResolution?: string, activeThinkingLevel?: string | null, [key: string]: any };
export type GenerationPayload = {
  mode?: string;
  prompt?: string;
  userPrompt?: string;
  effectivePrompt?: string;
  settings?: GenerationSettings;
  moduleSnapshot?: any;
  usedImages?: any[];
  [key: string]: any;
};

declare global {
  interface Window {
    __cafeLastGenerationDebug?: Record<string, any>;
  }
}

function truncateDebugValue(value: any): any {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return `${value.slice(0, 96)}...[trimmed ${Math.max(0, value.length - 96)} chars]`;
    }
    if (value.length > 2000) {
      return `${value.slice(0, 2000)}...[trimmed ${value.length - 2000} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(truncateDebugValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, truncateDebugValue(entry)])
    );
  }
  return value;
}

export function storeGenerationDebug(data: Record<string, any>) {
  if (typeof window === 'undefined') return;
  window.__cafeLastGenerationDebug = truncateDebugValue(data);
}

function patchGenerationDebug(patch: Record<string, any>) {
  if (typeof window === 'undefined') return;
  const current = window.__cafeLastGenerationDebug;
  if (!current) return;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  storeGenerationDebug(next);
}

function getVisibleImageFiles(files?: Record<string, any>[]) {
  return getGenerationModuleImages(files);
}

function normalizeRole(file: Record<string, any>): ReferenceRole {
  const mode = String(file.mode || '').toUpperCase();
  if (mode === 'SCENE') return 'SCENE';
  if (mode === 'STYLE') return 'STYLE';
  if (mode === 'SUBJECT') return 'SUBJECT';
  return 'UNASSIGNED';
}

function describeRoleInstruction(role: ReferenceRole) {
  const instructions: Record<ReferenceRole, string> = {
    SUBJECT: 'Use as the main subject reference.',
    SCENE: 'Use as the environment, layout, props, lighting, and spatial context.',
    STYLE: 'Use only for visual treatment: palette, lens, lighting quality, texture, and mood.',
    UNASSIGNED: 'Use as a general visual reference.'
  };
  return instructions[role];
}

function buildSimplePrompt(rawPrompt: string, imageFiles: Record<string, any>[]) {
  const task = rawPrompt.trim() || 'Create one finished image from the provided references.';
  const lines = ['Task:', task];

  if (imageFiles.length) {
    lines.push('', 'References:');
    imageFiles.forEach((file, index) => {
      const label = file.label || file.name || 'UNASSIGNED';
      const role = normalizeRole(file);
      lines.push(`Image ${index + 1} - ${label}`);
      lines.push(`Role: ${role}`);
      lines.push(describeRoleInstruction(role));
    });
  }

  return lines.join('\n');
}

export async function generate(payload: GenerationPayload, settings: GenerationSettings, apiKey: string, callbacks: GenerationCallbacks, files?: Record<string, any>[]) {
  if (!apiKey) {
    callbacks.onError(new Error('API key is required'));
    return;
  }

  const model = settings.activeModel;
  const ratio = payload.settings?.aspectRatio || '1:1';
  const numImages = payload.settings?.variation || 1;
  const userPrompt = payload.userPrompt ?? payload.prompt ?? '';
  const imageFiles = getVisibleImageFiles(files);

  if (!userPrompt.trim() && !imageFiles.length) {
    callbacks.onError(new Error('No prompt and no images - type something or add module layers.'));
    return;
  }

  callbacks.onStart(numImages);

  try {
    const effectivePrompt = buildSimplePrompt(userPrompt, imageFiles);
    const imageRefs = imageFiles.map(file => file.url as string);
    const manifest = imageFiles.map((file, index) => ({
      ...describeReferenceStrength(file.strength, normalizeRole(file)),
      kind: 'image',
      position: index + 1,
      imgUrl: file.url,
      uuid: file.uuid || null,
      label: file.label || file.name || 'UNASSIGNED',
      folder: file.folder || null,
      role: normalizeRole(file),
      strength: normalizeStrength(file.strength)
    }));

    const loadingIds = Array.from({ length: numImages }).map((_, i) => `loading-${Date.now()}-${i}`);
    callbacks.onLoadingIds(loadingIds);

    const imageSize = settings.activeResolution || '1K';
    const thinkingLevel = settings.activeThinkingLevel;
    const startedAt = new Date().toISOString();

    storeGenerationDebug({
      status: 'started',
      startedAt,
      updatedAt: startedAt,
      userPrompt,
      effectivePrompt,
      rawPrompt: userPrompt,
      finalPrompt: effectivePrompt,
      manifest: manifest.map(({ imgUrl, ...item }) => ({
        ...item,
        hasImage: !!imgUrl
      })),
      model: model ? { label: model.label, id: model.id } : null,
      aspectRatio: ratio,
      imageSize,
      thinkingLevel: thinkingLevel || null,
      variationCount: numImages,
      loadingIds,
      results: []
    });

    function buildCellData(dataUrl: string) {
      const createdAt = new Date().toISOString();
      return {
        id: Date.now() + Math.random(),
        uuid: crypto.randomUUID(),
        ratio,
        imgUrl: dataUrl,
        date: createdAt,
        type: 'Generation',
        kind: 'image',
        origin: 'generation',
        createdAt,
        dims: '-', // calculated on image load
        userPrompt,
        effectivePrompt,
        prompt: effectivePrompt,
        manifest,
        model: model?.label || 'any',
        cost: settings.costPerImage || 0,
        generated: true,
        moduleSnapshot: payload.moduleSnapshot || null,
        usedImages: payload.usedImages || []
      };
    }

    await googleGenerate({
      modelId: model!.id,
      apiKey,
      prompt: effectivePrompt,
      numImages,
      aspectRatio: ratio,
      imageRefs,
      imageSize,
      thinkingLevel: thinkingLevel || undefined,
      onVariationReady: (dataUrl, idx) => {
        const lid = loadingIds[idx] || loadingIds[0];
        const previousResults = window.__cafeLastGenerationDebug?.results || [];
        patchGenerationDebug({
          status: 'running',
          results: [
            ...previousResults,
            { idx, loadingId: lid, status: 'ready', dataUrlPreview: dataUrl.slice(0, 64) }
          ]
        });
        callbacks.onVariationReady(dataUrl, lid, buildCellData(dataUrl));
      },
      onVariationBlocked: (idx, statusLabel) => {
        const lid = loadingIds[idx];
        const previousResults = window.__cafeLastGenerationDebug?.results || [];
        patchGenerationDebug({
          status: 'running',
          results: [
            ...previousResults,
            { idx, loadingId: lid, status: statusLabel || 'blocked' }
          ]
        });
        callbacks.onVariationBlocked(lid, statusLabel);
      },
      onVariationFailed: (idx, statusLabel) => {
        const lid = loadingIds[idx];
        const previousResults = window.__cafeLastGenerationDebug?.results || [];
        patchGenerationDebug({
          status: 'running',
          results: [
            ...previousResults,
            { idx, loadingId: lid, status: statusLabel || 'failed' }
          ]
        });
        const retryFn = isRetryMeaningful(statusLabel) ? (newLid: string) => {
          googleGenerate({
            modelId: model!.id, apiKey, prompt: effectivePrompt, numImages: 1, aspectRatio: ratio, imageRefs, imageSize, thinkingLevel: thinkingLevel || undefined,
            onVariationReady: (dataUrl) => {
              const retryResults = window.__cafeLastGenerationDebug?.results || [];
              patchGenerationDebug({
                status: 'running',
                results: [
                  ...retryResults,
                  { idx, loadingId: newLid, status: 'retry-ready', dataUrlPreview: dataUrl.slice(0, 64) }
                ]
              });
              callbacks.onVariationReady(dataUrl, newLid, buildCellData(dataUrl));
            },
            onVariationFailed: (_retryIdx, retryStatusLabel) => callbacks.onVariationFailed(newLid, undefined, retryStatusLabel),
            onVariationBlocked: (_retryIdx, retryStatusLabel) => callbacks.onVariationBlocked(newLid, retryStatusLabel)
          });
        } : undefined;
        callbacks.onVariationFailed(lid, retryFn, statusLabel);
      }
    });

    patchGenerationDebug({ status: 'complete', completedAt: new Date().toISOString() });
    callbacks.onComplete();

  } catch (err: any) {
    if (typeof callbacks.onGenerationError === 'function') {
      const loadingIds = Array.isArray(window.__cafeLastGenerationDebug?.loadingIds)
        ? window.__cafeLastGenerationDebug!.loadingIds as string[]
        : [];
      callbacks.onGenerationError(loadingIds, classifyGenerationError(err));
    }
    patchGenerationDebug({
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    });
    callbacks.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

export type StudioGenerateOptions = {
  modelId: string;
  apiKey: string;
  prompt: string;
  baseImageUrl: string;
  annotationImageUrl?: string;
  references?: Array<{ action: string, name: string, url: string }>;
  imageSize?: string;
  aspectRatio?: string;
};

export async function studioGenerate(opts: StudioGenerateOptions): Promise<string> {
  const { modelId, apiKey, prompt, baseImageUrl, annotationImageUrl, references, imageSize, aspectRatio } = opts;

  const fullPrompt = (prompt + (annotationImageUrl ? ' Focus on the annotated area.' : '')).trim();
  const parts: {text?: string, inline_data?: {mime_type: string, data: string}}[] = [];
  if (fullPrompt) parts.push({ text: fullPrompt });

  const baseParsed = parseDataUrl(baseImageUrl);
  parts.push({ inline_data: { mime_type: baseParsed.mimeType, data: baseParsed.base64 } });

  if (annotationImageUrl) {
    const annoParsed = parseDataUrl(annotationImageUrl);
    parts.push({ inline_data: { mime_type: 'image/png', data: annoParsed.base64 } });
  }

  if (references) {
    references.forEach(ref => {
      parts.push({ text: `Reference action: ${ref.action || 'TRANSFER'}\nIntent: ${ref.name}\nUse this reference only for the stated action and intent:` });
      const refParsed = parseDataUrl(ref.url);
      parts.push({ inline_data: { mime_type: refParsed.mimeType, data: refParsed.base64 } });
    });
  }

  const imageConfig: { aspectRatio?: string, imageSize: string, imageOutputOptions: { mimeType: string } } = {
    imageSize: imageSize || '1K',
    imageOutputOptions: { mimeType: 'image/png' }
  };
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;

  const generationConfig = {
    responseModalities: ['IMAGE'],
    imageConfig
  };

  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${modelId}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' }
    ]
  };

  console.log('[CafeAPI] → POST (Studio)', modelId, '| refs:', references?.length || 0);

  const result = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, { label: '[CafeAPI Studio]', timeoutMs: 90000 });

  let prediction: any = null;
  (result.candidates || []).forEach((candidate: any) => {
    if (prediction) return;
    (candidate.content?.parts || []).forEach((part: any) => {
      if (prediction) return;
      const id = part.inlineData || part.inline_data;
      if (id && id.data) {
        prediction = { mimeType: id.mimeType || id.mime_type || 'image/png', bytesBase64Encoded: id.data };
      }
    });
  });

  if (!prediction) {
    const block = result.promptFeedback?.blockReason;
    if (block) throw new Error(`Prompt blocked - ${block}`);
    throw new Error('Model returned no image for studio refine');
  }

  return `data:${prediction.mimeType};base64,${prediction.bytesBase64Encoded}`;
}


















/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchJSON } from './net';
import { parseDataUrl } from './vision';
import { enhancePrompt } from './enhancer';
import { buildComposition } from './composition';

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
  onVariationFailed?: (idx: number) => void;
  onVariationBlocked?: (idx: number) => void;
};

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
        'Follow the user brief as an ordered visual reference manifest.',
        'The inline images are supplied in the same Image N order named in the brief.',
        'Use the brief to decide whether an image is a subject source, wardrobe source, scene source, style source, loose supporting reference, or base composition.',
        'When an image is the base or main reference, preserve its camera, framing, perspective, lighting, colour grade, environment, and atmosphere.',
        'When subjects or garments are replaced or inserted, integrate them physically into that base scene with matching scale, occlusion, shadows, reflections, and light response.',
        'Do not create a collage, pasted cutout, side-by-side composite, contact sheet, or flat overlay.',
        'Preserve concrete identifying details from referenced images only according to their assigned role in the brief; avoid generic substitutions.'
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
      }, { label: '[CafeAPI]' });

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
        onVariationBlocked(idx);
      }
      return result;
    } catch (err) {
      if (onVariationFailed) onVariationFailed(idx);
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
  onVariationBlocked: (lid: string) => void;
  onVariationFailed: (lid: string, retryFn: (newLid: string) => void) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
};

export type GenerationSettings = { aspectRatio?: string, variation?: number, activeModel?: { label: string, id: string }, costPerImage?: number, activeResolution?: string, activeThinkingLevel?: string | null, [key: string]: any };
export type GenerationPayload = { mode?: string, prompt?: string, settings?: GenerationSettings, moduleSnapshot?: any, usedImages?: any[], [key: string]: any };
export async function generate(payload: GenerationPayload, settings: GenerationSettings, apiKey: string, callbacks: GenerationCallbacks, files?: Record<string, any>[]) {
  if (!apiKey) {
    callbacks.onError(new Error('API key is required'));
    return;
  }

  const model = settings.activeModel;
  const ratio = payload.settings?.aspectRatio || '1:1';
  const numImages = payload.settings?.variation || 1;
  const rawPrompt = payload.prompt || '';
  
  const composition = buildComposition(payload, files);
  const hasImages = composition.some(i => i.kind === 'image');

  if (!rawPrompt && !hasImages) {
    callbacks.onError(new Error('No prompt and no images - type something or add module layers.'));
    return;
  }

  callbacks.onStart(numImages);

  try {
    // 1. Describe missing images if needed (catch-up scan logic would go here if we implemented DescriptionRegistry)
    // For now we will rely on enhancer.ts to skip them if desc is missing.
    // TODO: implement DescriptionRegistry.ensureAll in the future if needed.

    // 2. Enhance Prompt
    const enhanced = await enhancePrompt(payload, apiKey);
    const finalPrompt = enhanced.prompt;
    const manifest = enhanced.manifest;

    const loadingIds = Array.from({ length: numImages }).map((_, i) => `loading-${Date.now()}-${i}`);
    callbacks.onLoadingIds(loadingIds);

    const imageRefs = manifest
      .filter((item: {kind?: string, imgUrl?: string, position?: number}) => item.kind === 'image' && item.imgUrl)
      .sort((a: {position?: number}, b: {position?: number}) => {
        if (a.position == null && b.position == null) return 0;
        if (a.position == null) return 1;
        if (b.position == null) return -1;
        return a.position - b.position;
      })
      .map((item: {kind?: string, imgUrl?: string, position?: number}) => item.imgUrl as string);

    const imageSize = settings.activeResolution || '1K';
    const thinkingLevel = settings.activeThinkingLevel;

    function buildCellData(dataUrl: string) {
      return {
        id: Date.now() + Math.random(),
        uuid: crypto.randomUUID(),
        ratio,
        imgUrl: dataUrl,
        date: new Date().toISOString(), // format properly later
        type: 'Image',
        dims: '-', // calculated on image load
        prompt: finalPrompt,
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
      prompt: finalPrompt,
      numImages,
      aspectRatio: ratio,
      imageRefs,
      imageSize,
      thinkingLevel: thinkingLevel || undefined,
      onVariationReady: (dataUrl, idx) => {
        const lid = loadingIds[idx] || loadingIds[0];
        callbacks.onVariationReady(dataUrl, lid, buildCellData(dataUrl));
      },
      onVariationBlocked: (idx) => {
        callbacks.onVariationBlocked(loadingIds[idx]);
      },
      onVariationFailed: (idx) => {
        const lid = loadingIds[idx];
        callbacks.onVariationFailed(lid, (newLid) => {
          googleGenerate({
            modelId: model!.id, apiKey, prompt: finalPrompt, numImages: 1, aspectRatio: ratio, imageRefs, imageSize, thinkingLevel: thinkingLevel || undefined,
            onVariationReady: (dataUrl) => {
              callbacks.onVariationReady(dataUrl, newLid, buildCellData(dataUrl));
            },
            onVariationFailed: () => callbacks.onVariationFailed(newLid, () => {}),
            onVariationBlocked: () => callbacks.onVariationBlocked(newLid)
          });
        });
      }
    });

    callbacks.onComplete();

  } catch (err: any) {
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

  const generationConfig = {
    responseModalities: ['IMAGE'],
    imageConfig: { aspectRatio: aspectRatio || '1:1', imageSize: imageSize || '1K', imageOutputOptions: { mimeType: 'image/png' } }
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
  }, { label: '[CafeAPI Studio]' });

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


















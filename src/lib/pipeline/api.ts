/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGenerationModuleImages } from './module-order';
import DB from '@/lib/db';
import {
  describeGenAIError,
  findImagePrediction,
  GENERATION_SAFETY_SETTINGS,
  isQuotaError,
  sendGenerationRequest,
  toThinkingLevel,
  type GenAIRequest,
  type GenerateContentConfig,
  type Part,
} from './genai-client';
import {
  getGenerationDebug,
  patchGenerationDebug,
  storeGenerationDebug,
} from './generation-debug';
import {
  describeReferenceStrength,
  normalizeStrength,
  type ReferenceRole,
  classifyLabel
} from './strength';

export const IMAGE_PIPELINE_VERSION = 'subject-v4-scene-reframe';

function parseDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(',')[1];
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  return { base64, mimeType };
}

type GenerateOptions = {
  modelId: string;
  prompt: string;
  numImages: number;
  aspectRatio: string;
  imageRefs?: ImageReferenceInput[];
  imageSize?: string;
  thinkingLevel?: string;
  debugRunId?: string;
  onVariationReady?: (dataUrl: string, idx: number) => void;
  onVariationFailed?: (idx: number, statusLabel?: string) => void;
  onVariationBlocked?: (idx: number, statusLabel?: string) => void;
};

type ImageReferenceInput = {
  url: string;
};

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "IMAGE_PROHIBITED_CONTENT",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

function classifyGenerationError(err: unknown): "BLOCKED" | "QUOTA" | "TIMEOUT" | "FAILED" {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("IMAGE_PROHIBITED_CONTENT") || message.includes("Prompt blocked")) return "BLOCKED";
  if (isQuotaError(err)) return "QUOTA";
  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("[CafeAPI] 429") || message.includes(" 429:")) return "QUOTA";
  if ((err instanceof Error && err.name === "AbortError") || message.includes("timed out")) return "TIMEOUT";
  return "FAILED";
}

function isRetryMeaningful(statusLabel?: string): boolean {
  return statusLabel === "QUOTA" || statusLabel === "TIMEOUT" || statusLabel === "FAILED";
}

export async function googleGenerate(opts: GenerateOptions) {
  const { modelId, prompt, numImages, aspectRatio, imageRefs, imageSize, thinkingLevel, debugRunId, onVariationReady, onVariationFailed, onVariationBlocked } = opts;
  
  const arMap: Record<string, string> = { '1:1': '1:1', '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4' };
  const ar = arMap[aspectRatio] || '1:1';

  const parts: Part[] = [{ text: prompt }];
  if (imageRefs && imageRefs.length) {
    imageRefs.forEach((ref) => {
      const parsed = parseDataUrl(ref.url);
      parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
    });
  }

  const generationConfig: GenerateContentConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: ar,
      imageSize: imageSize || '1K',
      outputMimeType: 'image/png'
    },
    safetySettings: GENERATION_SAFETY_SETTINGS
  };
  
  const sdkThinkingLevel = toThinkingLevel(thinkingLevel);
  if (sdkThinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: sdkThinkingLevel };
  }

  const request: GenAIRequest = {
    model: modelId,
    contents: [{ role: 'user', parts }],
    config: generationConfig
  };
  const serializedBody = JSON.stringify(request);

  patchGenerationDebug({
    request: {
      transport: 'next-server-vertex',
      apiMode: 'vertex-adc',
      modelId,
      numImages,
      aspectRatio: ar,
      imageSize: imageSize || '1K',
      thinkingLevel: thinkingLevel || null,
      promptCharacters: prompt.length,
      imageReferenceCount: imageRefs?.length || 0,
      serializedBodyCharacters: serializedBody.length
    }
  }, debugRunId);

  const results: PromiseSettledResult<Awaited<ReturnType<typeof sendGenerationRequest>>>[] = [];

  for (let idx = 0; idx < numImages; idx += 1) {
    try {
      const result = await sendGenerationRequest(request);
      const prediction = findImagePrediction(result);
      let blockedReason = result.promptFeedback?.blockReason
        ? String(result.promptFeedback.blockReason)
        : null;
      const finishReasons: string[] = [];

      (result.candidates || []).forEach((candidate) => {
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
          finishReasons.push(candidate.finishReason);
          if (BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
            blockedReason = candidate.finishReason;
          }
        }
      });

      if (prediction && onVariationReady) {
        onVariationReady(`data:${prediction.mimeType};base64,${prediction.bytesBase64Encoded}`, idx);
      } else if (blockedReason && onVariationBlocked) {
        onVariationBlocked(idx, blockedReason);
      } else if (onVariationFailed) {
        onVariationFailed(idx, finishReasons[0] || 'FAILED');
      }
      results.push({ status: 'fulfilled', value: result });
    } catch (err) {
      patchGenerationDebug({
        lastApiError: {
          variationIndex: idx,
          classification: classifyGenerationError(err),
          ...describeGenAIError(err)
        }
      }, debugRunId);
      if (onVariationFailed) onVariationFailed(idx, classifyGenerationError(err));
      results.push({ status: 'rejected', reason: err });
    }
  }

  const predictions: {mimeType: string, bytesBase64Encoded: string}[] = [];
  let blockReason = null;
  const finishReasons: string[] = [];
  let firstError: Error | null = null;

  results.forEach(outcome => {
    if (outcome.status === 'rejected') {
      if (!firstError) firstError = outcome.reason;
      console.warn('[CafeAPI] Variation call failed:', outcome.reason?.message || outcome.reason);
      return;
    }
    const result = outcome.value;
    if (result.promptFeedback?.blockReason) {
      blockReason = result.promptFeedback.blockReason;
    }
    (result.candidates || []).forEach((candidate) => {
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        finishReasons.push(candidate.finishReason);
      }
      (candidate.content?.parts || []).forEach((part) => {
        if (part.inlineData?.data) {
          predictions.push({
            mimeType: part.inlineData.mimeType || 'image/png',
            bytesBase64Encoded: part.inlineData.data
          });
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

export type GenerationSettings = { aspectRatio?: string, variation?: number, projectId?: number | null, activeModel?: { label: string, id: string }, costPerImage?: number, activeResolution?: string, activeThinkingLevel?: string | null, [key: string]: any };
export type GenerationPayload = {
  mode?: string;
  prompt?: string;
  userPrompt?: string;
  effectivePrompt?: string;
  executionSource?: string;
  agentDraft?: any;
  settings?: GenerationSettings;
  moduleSnapshot?: any;
  usedImages?: any[];
  [key: string]: any;
};

export { storeGenerationDebug } from './generation-debug';

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

export function buildSimplePrompt(rawPrompt: string, imageFiles: Record<string, any>[]) {
  const task = rawPrompt.trim() || defaultTaskForReferences(imageFiles);
  const lines = ['Task:', task];

  if (imageFiles.length) {
    lines.push('', 'References:');

    imageFiles.forEach((file, index) => {
      const label = file.label || file.name || 'UNASSIGNED';
      const role = normalizeRole(file);
      const perf = describeReferenceStrength(file.strength, role, label);

      lines.push(
        `- Image ${index + 1}, ${label}: ${perf.contract}`
      );
    });

    lines.push('', 'Rules:');
    
    if (imageFiles.length === 1) {
      const single = imageFiles[0];
      const semantic = classifyLabel(single.label || single.name || 'UNASSIGNED');
      const role = normalizeRole(single);
      if (role === 'SUBJECT') {
        lines.push(`- Preserve the same ${semantic}. Only change pose, action, or orientation when the task asks for it.`);
        lines.push(`- Keep a plain source background plain unless the Task asks for a scene.`);
      } else if (role === 'SCENE') {
        lines.push(`- Use Image 1 only as the stage/background. Do not add a main subject unless the Task asks.`);
      } else if (role === 'STYLE') {
        lines.push(`- Apply only Image 1's visual treatment; ignore its content/background/layout.`);
      } else {
        lines.push(`- Use Image 1 as a general reference.`);
      }
    } else {
      const subjects = imageFiles.filter(f => normalizeRole(f) === 'SUBJECT');
      const scenes = imageFiles.filter(f => normalizeRole(f) === 'SCENE');
      const styles = imageFiles.filter(f => normalizeRole(f) === 'STYLE');
      const subNoun = subjects.length > 1 ? "subjects" : "subject";

      let rule = "- ";
      if (subjects.length && scenes.length && styles.length) {
        rule += `Use Subject for ${subNoun}, Scene for background/camera/layout, Style only for rendering.`;
      } else if (subjects.length && scenes.length) {
        rule += `Use Subject for ${subNoun} and Scene for background/camera/layout.`;
      } else if (subjects.length && styles.length) {
        rule += `Use Subject for ${subNoun}; apply Style only as rendering, not content/background.`;
      } else if (scenes.length && styles.length) {
        rule += `Use Scene for background/camera/layout; apply Style only as rendering, not content/background.`;
      } else {
        rule += `Respect each image's assigned module role; do not blend whole images together.`;
      }
      rule += " Keep lighting, shadows, scale, and integration natural.";
      lines.push(rule);
    }
  }

  return lines.join('\n');
}

function defaultTaskForReferences(imageFiles: Record<string, any>[]) {
  if (imageFiles.length === 1) {
    const role = normalizeRole(imageFiles[0]);
    if (role === 'SUBJECT') {
      return 'Create a reference-preserving image of the same subject. Only adjust the controlled subject axis if needed; do not redesign the subject or change the background.';
    }
    if (role === 'SCENE') {
      return 'Create a new view of the same scene.';
    }
    if (role === 'STYLE') {
      return 'Create an image using only the visual style of the reference. Do not copy its content, background, layout, or objects.';
    }
  }
  return 'Create one finished image from the provided module references while respecting each image role.';
}

function buildImageReferenceInputs(imageFiles: Record<string, any>[]): ImageReferenceInput[] {
  return imageFiles.map((file) => ({ url: file.url as string }));
}

export async function generate(payload: GenerationPayload, settings: GenerationSettings, callbacks: GenerationCallbacks, files?: Record<string, any>[]) {
  const model = settings.activeModel;
  const ratio = payload.settings?.aspectRatio || '1:1';
  const numImages = payload.settings?.variation || 1;
  const userPrompt = payload.userPrompt ?? payload.prompt ?? '';
  const imageFiles = getVisibleImageFiles(files);
  const cleanPromptManaged = (
    payload.executionSource === 'agent-final-prompt' ||
    payload.executionSource === 'generate-command'
  ) && !!payload.effectivePrompt?.trim();

  if (!userPrompt.trim() && !imageFiles.length) {
    callbacks.onError(new Error('No prompt and no images - type something or add module layers.'));
    return;
  }

  callbacks.onStart(numImages);
  let terminalOutcomeReported = false;
  const debugRunId = crypto.randomUUID();

  try {
    const effectivePrompt = cleanPromptManaged
      ? payload.effectivePrompt!.trim()
      : buildSimplePrompt(userPrompt, imageFiles);
    const imageRefs = buildImageReferenceInputs(imageFiles);
    const manifest = imageFiles.map((file, index) => ({
      kind: 'image',
      position: index + 1,
      imgUrl: file.url,
      uuid: file.uuid || null,
      label: file.label || file.name || 'UNASSIGNED',
      folder: file.folder || null,
      role: normalizeRole(file),
      ...describeReferenceStrength(file.strength, normalizeRole(file), file.label || file.name || 'UNASSIGNED'),
      strength: normalizeStrength(file.strength)
    }));

    const loadingIds = Array.from({ length: numImages }).map((_, i) => `loading-${Date.now()}-${i}`);
    callbacks.onLoadingIds(loadingIds);

    const imageSize = settings.activeResolution || '1K';
    const thinkingLevel = settings.activeThinkingLevel;
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();
    const persistentJobId = `image-job-${debugRunId}`;

    if (settings.projectId) {
      await DB.generationJobs.put({
        id: persistentJobId,
        project_id: settings.projectId,
        kind: "image",
        status: "running",
        loadingIds,
        prompt: effectivePrompt,
        ratio,
        mode: payload.mode || "FRAME",
        createdAt: startedAt,
        updatedAt: startedAt,
      }).catch((error) => console.error("Failed to persist image generation job", error));
    }

    storeGenerationDebug({
      runId: debugRunId,
      status: 'started',
      startedAt,
      updatedAt: startedAt,
      userPrompt,
      effectivePrompt,
      rawPrompt: userPrompt,
      finalPrompt: effectivePrompt,
      executionSource: payload.executionSource || 'prompt-bar',
      agentDraft: payload.agentDraft || null,
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
        usedImages: payload.usedImages || [],
        executionSource: payload.executionSource || 'prompt-bar',
        agentDraft: payload.agentDraft || null,
        pipelineVersion: IMAGE_PIPELINE_VERSION,
        modelId: model?.id,
        generationSettings: {
          aspectRatio: ratio,
          imageSize,
          thinkingLevel: thinkingLevel || null
        },
        generationTimeMs: Date.now() - startTimeMs
      };
    }

    await googleGenerate({
      modelId: model!.id,
      prompt: effectivePrompt,
      numImages,
      aspectRatio: ratio,
      imageRefs,
      imageSize,
      thinkingLevel: thinkingLevel || undefined,
      debugRunId,
      onVariationReady: (dataUrl, idx) => {
        const lid = loadingIds[idx] || loadingIds[0];
        const previousResults = getGenerationDebug()?.results;
        patchGenerationDebug({
          status: 'running',
          results: [
            ...(Array.isArray(previousResults) ? previousResults : []),
            { idx, loadingId: lid, status: 'ready', dataUrlPreview: dataUrl.slice(0, 64) }
          ]
        }, debugRunId);
        callbacks.onVariationReady(dataUrl, lid, buildCellData(dataUrl));
      },
      onVariationBlocked: (idx, statusLabel) => {
        terminalOutcomeReported = true;
        const lid = loadingIds[idx];
        const previousResults = getGenerationDebug()?.results;
        patchGenerationDebug({
          status: 'running',
          results: [
            ...(Array.isArray(previousResults) ? previousResults : []),
            { idx, loadingId: lid, status: statusLabel || 'blocked' }
          ]
        }, debugRunId);
        callbacks.onVariationBlocked(lid, statusLabel);
      },
      onVariationFailed: (idx, statusLabel) => {
        terminalOutcomeReported = true;
        const lid = loadingIds[idx];
        const previousResults = getGenerationDebug()?.results;
        patchGenerationDebug({
          status: 'running',
          results: [
            ...(Array.isArray(previousResults) ? previousResults : []),
            { idx, loadingId: lid, status: statusLabel || 'failed' }
          ]
        }, debugRunId);
        const runRetry = (newLid: string) => {
          void googleGenerate({
            modelId: model!.id, prompt: effectivePrompt, numImages: 1, aspectRatio: ratio, imageRefs, imageSize, thinkingLevel: thinkingLevel || undefined, debugRunId,
            onVariationReady: (dataUrl) => {
              const retryResults = getGenerationDebug()?.results;
              patchGenerationDebug({
                status: 'running',
                results: [
                  ...(Array.isArray(retryResults) ? retryResults : []),
                  { idx, loadingId: newLid, status: 'retry-ready', dataUrlPreview: dataUrl.slice(0, 64) }
                ]
              }, debugRunId);
              callbacks.onVariationReady(dataUrl, newLid, buildCellData(dataUrl));
            },
            onVariationFailed: (_retryIdx, retryStatusLabel) => {
              callbacks.onVariationFailed(
                newLid,
                isRetryMeaningful(retryStatusLabel) ? runRetry : undefined,
                retryStatusLabel
              );
            },
            onVariationBlocked: (_retryIdx, retryStatusLabel) => callbacks.onVariationBlocked(newLid, retryStatusLabel)
          }).catch(() => {});
        };
        const retryFn = isRetryMeaningful(statusLabel) ? runRetry : undefined;
        callbacks.onVariationFailed(lid, retryFn, statusLabel);
      }
    });

    patchGenerationDebug({ status: 'complete', completedAt: new Date().toISOString() }, debugRunId);
    if (settings.projectId) {
      void DB.generationJobs.delete(persistentJobId).catch((error) => console.error("Failed to clear image generation job", error));
    }
    callbacks.onComplete();

  } catch (err: any) {
    if (!terminalOutcomeReported && typeof callbacks.onGenerationError === 'function') {
      const debugLoadingIds = getGenerationDebug()?.loadingIds;
      const loadingIds = Array.isArray(debugLoadingIds)
        ? debugLoadingIds as string[]
        : [];
      callbacks.onGenerationError(loadingIds, classifyGenerationError(err));
    }
    patchGenerationDebug({
      status: 'error',
      error: describeGenAIError(err)
    }, debugRunId);
    if (settings.projectId) {
      void DB.generationJobs.delete(`image-job-${debugRunId}`).catch((error) => console.error("Failed to clear image generation job", error));
    }
    if (!terminalOutcomeReported) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export type StudioGenerateOptions = {
  modelId: string;
  prompt: string;
  baseImageUrl: string;
  annotationImageUrl?: string;
  references?: Array<{ action: string, name: string, url: string }>;
  imageSize?: string;
  aspectRatio?: string;
  flavor?: 'normal' | 'creative';
};

type StudioReferenceAction = 'INSERT' | 'REPLACE' | 'REMOVE' | 'KEEP';

function normalizeStudioAction(action?: string): StudioReferenceAction {
  const upper = String(action || '').toUpperCase();
  if (upper === 'SWAP' || upper === 'TRANSFER') return 'REPLACE';
  if (upper === 'PRESERVE') return 'KEEP';
  if (upper === 'REMOVE') return 'REMOVE';
  if (upper === 'KEEP') return 'KEEP';
  if (upper === 'REPLACE') return 'REPLACE';
  return 'INSERT';
}

function studioReferenceRole(action: StudioReferenceAction, creative: boolean) {
  if (creative) {
    const creativeRoles: Record<StudioReferenceAction, string> = {
      INSERT: 'creative addition source',
      REPLACE: 'creative transformation language',
      REMOVE: 'removal target identifier',
      KEEP: 'protected visual anchor',
    };
    return creativeRoles[action];
  }

  const roles: Record<StudioReferenceAction, string> = {
    INSERT: 'controlled addition source',
    REPLACE: 'direct replacement source',
    REMOVE: 'removal target identifier',
    KEEP: 'protected visual anchor',
  };
  return roles[action];
}

function studioReferenceInstruction(action: StudioReferenceAction, target: string, creative: boolean) {
  if (creative) {
    const creativeInstructions: Record<StudioReferenceAction, string> = {
      INSERT: `Introduce the reference as a creative addition related to ${target}. Integrate it into the existing image rather than reimagining the whole frame. Adapt placement, scale, lighting, shadows, and perspective to the base image.`,
      REPLACE: `Use the reference as design language for creatively reinterpreting ${target}. Borrow relevant form, material, texture, color, structure, mood, or styling while preserving the target's role, placement, scale, and surrounding relationships in the base image.`,
      REMOVE: `Use the reference only to identify matching visual details of ${target} that should be removed. Do not add or copy content from the reference. Reconstruct the affected area naturally within the base image.`,
      KEEP: `Use the reference to protect ${target}. Preserve its identity and defining details while allowing the user's creative edit to affect other parts of the image.`,
    };
    return creativeInstructions[action];
  }

  const instructions: Record<StudioReferenceAction, string> = {
    INSERT: `Add the referenced subject/object as ${target} in the base image. Preserve the rest of the image unless the user asks otherwise. Match lighting, perspective, scale, contact shadows, and material response.`,
    REPLACE: `Replace ${target} in the base image with the referenced subject/object. Preserve the scene function, position, scale, camera angle, lighting, and surrounding relationships unless the user asks otherwise.`,
    REMOVE: `Use the reference only to identify ${target} for removal. Remove matching details from the base image, fill the area naturally, and do not import visual content from the reference.`,
    KEEP: `Keep ${target} protected. Preserve matching identity, shape, color, texture, and defining details while applying the user's edit around it.`,
  };
  return instructions[action];
}

function buildStudioPrompt(prompt: string, hasReferences: boolean, hasAnnotation: boolean, flavor: 'normal' | 'creative') {
  const userRequest = prompt.trim() || (flavor === 'creative'
    ? 'Creatively reinterpret the image while preserving its core composition.'
    : 'Refine the image while preserving unrelated parts.');
  const lines = [
    'Studio edit request:',
    userRequest,
    '',
    `Studio mode: ${flavor === 'creative' ? 'creative reinterpretation' : 'direct controlled edit'}`,
    '',
    'Global rules:',
    '- Edit the base image. Do not create a new unrelated scene.',
    '- Preserve unrelated parts of the base image unless the user request or reference actions say to change them.',
    '- Match camera, perspective, lighting, shadows, scale, and material response so edits feel native to the image.',
  ];

  if (flavor === 'creative') {
    if (hasReferences) {
      lines.push('- Use references as controlled creative direction for their named targets, not as generic style blending for the whole frame.');
    } else {
      lines.push('- With no references, use the prompt to creatively reinterpret the current image while keeping its composition and visual identity more stable than a fresh generation.');
    }
  } else if (hasReferences) {
    lines.push('- Treat each reference as a precise tool for its action and target.');
  }

  if (hasAnnotation) {
    lines.push('- Prioritize the annotated area when deciding where the edit should happen.');
  }

  return lines.join('\n');
}

export async function studioGenerate(opts: StudioGenerateOptions): Promise<string> {
  const { modelId, prompt, baseImageUrl, annotationImageUrl, references, imageSize, aspectRatio, flavor = 'normal' } = opts;

  const parts: Part[] = [];
  parts.push({ text: buildStudioPrompt(prompt, !!references?.length, !!annotationImageUrl, flavor) });

  const baseParsed = parseDataUrl(baseImageUrl);
  parts.push({ inlineData: { mimeType: baseParsed.mimeType, data: baseParsed.base64 } });

  if (annotationImageUrl) {
    const annoParsed = parseDataUrl(annotationImageUrl);
    parts.push({ inlineData: { mimeType: 'image/png', data: annoParsed.base64 } });
  }

  if (references) {
    references.forEach((ref, index) => {
      const action = normalizeStudioAction(ref.action);
      const target = (ref.name || 'TARGET').trim().toUpperCase();
      parts.push({
        text: [
          `Studio reference ${index + 1}`,
          `Action: ${action}`,
          `Target: ${target}`,
          `Reference role: ${studioReferenceRole(action, flavor === 'creative')}`,
          `Instruction: ${studioReferenceInstruction(action, target, flavor === 'creative')}`,
        ].join('\n')
      });
      const refParsed = parseDataUrl(ref.url);
      parts.push({ inlineData: { mimeType: refParsed.mimeType, data: refParsed.base64 } });
    });
  }

  const imageConfig: NonNullable<GenerateContentConfig['imageConfig']> = {
    imageSize: imageSize || '1K',
    outputMimeType: 'image/png'
  };
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;

  const generationConfig: GenerateContentConfig = {
    responseModalities: ['IMAGE'],
    imageConfig,
    safetySettings: GENERATION_SAFETY_SETTINGS
  };

  const request = {
    model: modelId,
    contents: [{ role: 'user', parts }],
    config: generationConfig
  };

  const result = await sendGenerationRequest(request);
  const prediction = findImagePrediction(result);

  if (!prediction) {
    const block = result.promptFeedback?.blockReason;
    if (block) throw new Error(`Prompt blocked - ${block}`);
    throw new Error('Model returned no image for studio refine');
  }

  return `data:${prediction.mimeType};base64,${prediction.bytesBase64Encoded}`;
}

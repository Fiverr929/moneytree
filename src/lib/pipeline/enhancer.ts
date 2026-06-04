/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchJSON } from './net';
import { buildComposition, CompositionItem } from './composition';
import { parseDataUrl } from './vision';

const MODEL = 'gemini-2.5-flash';

const SYSTEM_INSTRUCTION = [
  'You are a generation brief writer for an AI image model.',
  '',
  'The inputs you receive come from a structured composition tool with three base modules plus one loose reference layer:',
  '- SUBJECT MODULE: who or what appears in the scene. May have multiple independent slots (A, B, C...) — each slot is a completely separate subject, not the same thing from multiple angles.',
  '- SCENE MODULE: where and when the scene takes place.',
  '- STYLE MODULE: visual treatment only — colour grade, lens, rendering, mood. Never a person or a location.',
  '- REFERENCE LAYER: loose supporting images with no assigned module. Use them only as named supporting context when the user intent or image name makes their purpose clear; do not let them override Subject, Scene, or Style.',
  '',
  'Within a single slot, multiple images of the same layer are different angles or views of the same subject — treat them as one thing.',
  'Your task: write a complete generation brief by analysing the provided inputs — attached inline images and pre-scanned text descriptions — and their assigned roles.',
  'Before writing, act as a creative director: decide the final image, not a pile of assets.',
  'Use specific, concrete language drawn directly from the images and descriptions — never generic placeholders.',
  '',
  'Rules:',
  '- The generation model receives the actual images alongside this brief.',
  '- The final output must be one newly generated coherent image, not transferred pixels from one reference onto another.',
  '- Write an edit/composition brief, not an inventory of separate assets.',
  '- If the user prompt is empty, infer the default production move from the modules and references.',
  '- Default production move: SUBJECT provides identity/objects, SCENE provides world/camera/environment, STYLE provides rendering only, and REFERENCE only supports those choices.',
  '- Use positional image references ("the person in Image N", "the outfit in Image N", "the lighting from Image N") to anchor every concrete subject, garment, scene, and style source.',
  '- Only use Image N references for images explicitly listed in the user message.',
  '- If multiple subject slots are present, each is a separate independent subject — keep them distinct.',
  '- When one image is the base scene or main reference, preserve its camera, framing, environment, lighting, colour grade, perspective, and atmosphere.',
  '- When replacing or inserting subjects, integrate them into that base scene with matching scale, occlusion, shadows, reflections, skin/clothing light response, and perspective.',
  '- Prefer language like "redraw the whole scene as one coherent image" over "place X on Y" when combining references.',
  '- Module images with a pre-scanned description are provided as description text — use the description directly, no Image N needed.',
  '- Inline images (refs and any module images without descriptions) are attached as Image N — reference them by position.',
  '- Place the subject in the scene using the SCENE MODULE. If no scene, derive from user intent or omit.',
  '- Close with the style treatment as visual rendering only — never as a location or character.',
  '- Every detail must come from the attached images or user intent. Do not invent anything.',
  '- Preserve distinctive details: printed text, logos, garment cuts, colours, materials, facial traits, props, architecture, camera angle, lens feel, and light direction.',
  '- Never ask for a collage, pasted cutout, side-by-side composite, contact sheet, or flat overlay.',
  '- Never use filler phrases like "dynamic pose", "vibrant atmosphere", "stunning", or "beautiful".',
  '- One flowing paragraph. Under 170 words. No labels, no headers, no preamble.',
  'Output only the brief.'
].join('\n');

function buildDirectorPlan(userIntent: string, imageContext: CompositionItem[]) {
  const text = (userIntent || '').trim();
  const subjectItems = imageContext.filter(i => i.section === 'subject');
  const stageItems = imageContext.filter(i => i.section === 'stage');
  const styleItems = imageContext.filter(i => i.section === 'style');
  const referenceItems = imageContext.filter(i => i.section === 'reference');

  const plan = {
    goal: 'single_coherent_generated_image',
    userIntent: text || '(none)',
    defaultAction: 'synthesize_modules_into_one_scene',
    subjectSources: subjectItems.map(i => {
      const ref = `${i.role || i.layerName} Slot ${i.slot || '-'}`;
      return i.position ? `${ref} / Image ${i.position}` : ref;
    }),
    referenceSources: referenceItems.map(i => {
      const ref = i.role || i.layerName || 'REFERENCE';
      return i.position ? `${ref} / Image ${i.position}` : ref;
    }),
    sceneSource: null as string | null,
    styleSource: null as string | null,
    compositionSource: null as string | null,
    preserve: ['physical integration', 'matching perspective', 'matching light direction', 'contact shadows', 'occlusion', 'edge softness'],
    avoid: ['collage', 'cutout', 'sticker overlay', 'side-by-side composite', 'literal pasted reference pixels']
  };

  const stageImage = stageItems[0];
  const styleImage = styleItems[0];
  const wantsPose = /\b(same\s+pose|pose|posture|framing|composition)\b/i.test(text);

  if (subjectItems.length && stageImage) {
    plan.defaultAction = 'integrate_subject_sources_into_a_base_world';
  }
  if (stageImage) {
    const stageRef = `${stageImage.role || stageImage.layerName} Slot ${stageImage.slot || '-'}`;
    plan.sceneSource = stageImage.position ? `${stageRef} / Image ${stageImage.position}` : stageRef;
    plan.compositionSource = plan.compositionSource || plan.sceneSource;
  }
  if (styleImage) {
    const styleRef = `${styleImage.role || styleImage.layerName} Slot ${styleImage.slot || '-'}`;
    plan.styleSource = styleImage.position ? `${styleRef} / Image ${styleImage.position}` : styleRef;
  }
  if (wantsPose) {
    plan.preserve.push(`pose language from ${plan.compositionSource || 'the main reference'}`);
  }

  if (!text && subjectItems.length && !stageImage) {
    plan.defaultAction = 'create_a_subject_led_image_from_available_identity_sources';
  }

  return plan;
}

function renderDirectorPlan(plan: ReturnType<typeof buildDirectorPlan>) {
  const lines = [
    'DIRECTOR PLAN (internal production contract):',
    `  Goal: ${plan.goal}`,
    `  Default action: ${plan.defaultAction}`
  ];
  if (plan.subjectSources.length) lines.push(`  Subject source(s): ${plan.subjectSources.join('; ')}`);
  if (plan.referenceSources.length) lines.push(`  Loose reference(s): ${plan.referenceSources.join('; ')}`);
  if (plan.sceneSource) lines.push(`  Scene/world source: ${plan.sceneSource}`);
  if (plan.compositionSource) lines.push(`  Composition/camera source: ${plan.compositionSource}`);
  if (plan.styleSource) lines.push(`  Style/rendering source: ${plan.styleSource}`);
  lines.push(`  Preserve: ${plan.preserve.join(', ')}`);
  lines.push(`  Avoid: ${plan.avoid.join(', ')}`);
  lines.push('  Write the final brief as if describing the finished coherent image. Do not describe stacking, overlaying, or pasting assets.');
  return lines.join('\n');
}

function renderSlotGroup(items: CompositionItem[], sectionLabel: string, lines: string[], slotType: string) {
  if (!items.length) return;
  const slotMap: Record<string, CompositionItem[]> = {};
  const slotOrder: string[] = [];
  
  items.forEach(img => {
    const key = img.slot || '_';
    if (!slotMap[key]) { slotMap[key] = []; slotOrder.push(key); }
    slotMap[key].push(img);
  });
  
  const multi = slotOrder.length > 1;
  lines.push(sectionLabel);
  
  slotOrder.forEach(key => {
    const slotItems = slotMap[key];
    if (multi) lines.push(`  Slot ${key} — independent ${slotType || 'subject'}:`);
    const indent = multi ? '    ' : '  ';
    
    slotItems.forEach(img => {
      const strength = img.strength == null ? 50 : img.strength;
      let strengthNote = ' / strength: medium';
      if (strength >= 75) strengthNote = ' / strength: high';
      else if (strength <= 25) strengthNote = ' / strength: low';
      
      if (img.kind === 'text') {
        lines.push(`${indent}[${img.layerName || 'Layer'} text] ${img.text}`);
        return;
      }
      
      const isIdentity = /CHARACTER|FACE|PERSON|MODEL|SUBJECT|HERO|IDENTITY|ACTOR/.test((img.layerName || '').toUpperCase());
      
      if (img.desc) {
        const roleLabel = isIdentity ? 'Identity anchor' : (img.layerName || 'Layer');
        lines.push(`${indent}[${roleLabel}${strengthNote}] ${img.desc}`);
      } else {
        const label = isIdentity
          ? `Identity anchor — Image ${img.position}`
          : `${img.layerName || 'Layer'} — Image ${img.position}`;
        lines.push(`${indent}[${label}${strengthNote}]`);
      }
    });
    if (multi) lines.push('');
  });
  if (!multi) lines.push('');
}

function buildUserMessage(userIntent: string, imageContext: CompositionItem[]) {
  const lines: string[] = [];

  const subjectItems = imageContext.filter(i => i.section === 'subject');
  const stageItems = imageContext.filter(i => i.section === 'stage');
  const styleItems = imageContext.filter(i => i.section === 'style');
  const referenceItems = imageContext.filter(i => i.section === 'reference');
  const directorPlan = buildDirectorPlan(userIntent, imageContext);

  lines.push(renderDirectorPlan(directorPlan));
  lines.push('');

  renderSlotGroup(subjectItems, 'SUBJECT MODULE (who or what is in the scene):', lines, 'subject');
  renderSlotGroup(stageItems, 'SCENE MODULE (where and when):', lines, 'scene');
  renderSlotGroup(styleItems, 'STYLE MODULE (visual treatment only — colour grade, lens, rendering, mood — NOT a place or person):', lines, 'style');
  renderSlotGroup(referenceItems, 'REFERENCE LAYER (loose support only; use according to its name, do not override modules):', lines, 'reference');

  if (userIntent && userIntent.trim()) {
    lines.push(`User intent: ${userIntent.trim()}`);
    lines.push('');
  }

  lines.push('Write the brief now.');
  return lines.join('\n');
}

export async function enhancePrompt(payload: any, apiKey: string, useCache: boolean = true) {
  if (!apiKey) throw new Error('[PromptEnhancer] No Google API key');

  const t0 = Date.now();
  const imageContext = buildComposition(payload);
  const userIntent = payload.prompt || '';
  const userMessage = buildUserMessage(userIntent, imageContext);
  
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${MODEL}:generateContent?key=${apiKey}`;

  const imageItems = imageContext.filter(i => i.kind === 'image' && i.imgUrl);
  const inlineItems = imageItems.filter(i => !i.desc);
  inlineItems.sort((a, b) => (a.position || 0) - (b.position || 0));

  const parts: any[] = [{ text: userMessage }];
  inlineItems.forEach(item => {
    if (item.imgUrl) {
      const parsed = parseDataUrl(item.imgUrl);
      parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } });
    }
  });

  console.log('[PromptEnhancer] → POST', MODEL, '| images inline:', inlineItems.length, '| described:', imageItems.length - inlineItems.length, '| prompt chars:', userMessage.length);

  const data = await fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 4999 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' }
      ]
    })
  }, { label: '[PromptEnhancer]' });

  const candidateParts = data.candidates?.[0]?.content?.parts;
  const text = candidateParts
    ? candidateParts.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('')
    : null;

  if (!text) {
    const blockReason = data.promptFeedback?.blockReason;
    const finishReason = data.candidates?.[0]?.finishReason;
    const errDetails = [
      blockReason ? `Blocked: ${blockReason}` : '',
      finishReason ? `Finish: ${finishReason}` : ''
    ].filter(Boolean).join(', ');
    throw new Error(`[PromptEnhancer] Empty response. ${errDetails || 'Model returned no text.'}`);
  }
  
  console.log('[PromptEnhancer] ✓', MODEL, '|', Date.now() - t0, 'ms | brief:', text.trim().slice(0, 120) + '...');
  
  return { 
    prompt: text.trim(), 
    manifest: imageContext, 
    enhancerInput: userMessage, 
    directorPlan: buildDirectorPlan(userIntent, imageContext) 
  };
}




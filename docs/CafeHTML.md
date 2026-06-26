# CafeHTML

> A living document. Update at the end of every session when rules, components, or specs change.

---

## What CafeHTML Is

A structured AI media creation pipeline. Not a prompt box — a reference-based generation system where the user builds a scene from real images and the system writes the generation brief automatically.

Current scope: Image generation (FRAME mode) and the initial Video workspace. Audio and the full Timeline remain future tabs.

---

## FRAME / SCENE — DO NOT CONFUSE

- **FRAME mode** (orange `#ea5823`) — image generation. This is what's being actively built.
- **SCENE mode** (blue `#5271ff`) — future video pipeline. **NOT being built yet — do not touch SCENE mode logic.**

---

## Stack

Current implementation is a Next.js / React app in `src/`.

Legacy docs below still reference the original plain HTML / CSS / JS build (`CafeHTML-v2.html`, `style.css`, and `logic/*.js`). Treat those sections as product and architecture history unless they have a Next.js equivalent listed here.

Current files:
- App shell: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- Components: `src/components/*`
- State: `src/context/*`
- Pipeline: `src/lib/pipeline/*`
- Storage: `src/lib/db.ts`

Local dev note:
- The working dev-server launch in this Windows workspace is a hidden non-interactive `cmd /c npm run dev` start. `Start-Process npm` is unreliable here because PowerShell sees duplicate `Path` / `PATH` entries, and Next may need approval-backed startup because the sandbox can block child-process spawning with `spawn EPERM`.

Debug capture:
- Generation runs write a local debug payload to `window.__cafeLastGenerationDebug`.
- The payload is runtime-scoped to the current browser tab and is meant for checking the latest prompt, settings, module files, manifest, request size, result status, and structured HTTP error details without manual copy/paste.

Brief Agent:
- The prompt bar owns the first mock Brief Agent console. It opens on prompt focus, collapses on outside click, and shifts the Gallery down while open.
- `src/lib/brief-agent/types.ts` defines the first `BriefDraft` contract. `src/lib/brief-agent/mockPlanner.ts` fills that contract from active module files until a real planner API is added.
- `src/app/api/brief-agent/route.ts` is the first agent harness boundary. The prompt bar calls it through `src/lib/brief-agent/client.ts`; the route tries a Vertex text planner first and falls back to the mock planner if `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` or model access is unavailable.
- `src/lib/brief-agent/skillContract.ts` holds the reusable Subject/Scene/Style and strength contract. Drafts pass through this compiler/check layer before returning to the UI, so role-boundary repairs and warnings are visible as checks.
- `src/app/api/brief-agent/read-references/route.ts` is the first image reader. The prompt bar sends active module images, roles, labels, and strengths; the route returns vision-backed `ReferenceObservation` facts before planning.
- Vision reference snapshots are cached in browser storage by module fingerprint. The console reports `CACHE: HIT`, `MISS`, `SAVED`, or `UNAVAILABLE`.
- Brief drafts include a clarification state. When the user instruction is empty or too broad, the console asks role-specific questions and withholds the final prompt preview.
- While the console is open, Enter submits a mock agent message instead of generating. The transcript renders newest-first with timestamps. Active references are read into a snapshot separately from the conversation and are reused until modules change.
- FRAME uses the agent final prompt when a clean `BriefDraft.finalPrompt` exists. If the user types after that draft, the console marks `UNSUBMITTED CHANGE` and blocks FRAME until Enter sends the new text to the agent.
- Agent-managed FRAME runs bypass the legacy `buildSimplePrompt()` wrapper. The pipeline uses `BriefDraft.finalPrompt` directly and sends only lean role/label reference instructions so the old strength prompt text does not re-wrap the agent prompt.

Legacy files:
Main file: `CafeHTML-v2.html`
Styles: `style.css`
Logic files: `logic/net.js`, `logic/api.js`, `logic/prompt-builder.js`, `logic/enhancer.js`, `logic/vision.js`, `logic/registry.js`, `logic/settings.js`, `logic/workspace.js`, `logic/storage.js`, `logic/debug-logger.js`, `logic/prompt-bar.js`, `logic/module-panel.js`, `logic/gallery.js`, `logic/sequence-bar.js`, `logic/studio.js`, `logic/studio-module.js`
Docs: `docs/` folder

---

## Current Generation Pipeline

```
1. collectPayload()         - captures the user prompt, settings, module snapshot, and provenance
2. buildSimplePrompt()      - writes the Task / reference-strength contract / role prompt
3. googleGenerate()         - sends prompt plus per-image control text and ordered inline images through @google/genai
4. Promise.allSettled()     - runs one SDK call per variation and preserves successful siblings
5. Gallery.resolveLoading() - resolves the matching tile and persists it to the launch project
```

The current transport uses the official SDK in Vertex Express mode. HTTP 429 responses are not retried automatically; the Gallery exposes an in-memory manual retry instead.

## Subject Prompt Evaluation System

The active Subject compiler is versioned as `subject-v4-scene-reframe`.

- Strength is role-axis control, not whole-image influence.
- Slider direction is left-to-right: locked/subtle -> balanced -> expressive/strong.
- Subject strength controls pose/expression/action or object orientation/placement freedom while subject identity/type, shape, wardrobe/materials, and distinctive details remain locked.
- Scene strength controls locked view -> reframe -> new shot. It must preserve the same event, environment, background, scale, lighting direction, and visible anchors instead of inventing a 360-degree orbit from a single 2D image.
- Style strength controls rendering intensity: medium, palette, texture, lighting mood, and finish. Style must not supply people, objects, background, layout, or composition.
- Single Subject references use a preservation prompt. If the source has a plain/solid background, the prompt tells the model to keep the background plain/neutral unless the user explicitly asks for a scene.
- The image label is included as the requested focus for semantic classification, so labels like `MODEL`, `ROOM`, and `STYLE` change which details the role-axis contract protects.
- Strength controls two prompt surfaces: the global module-role contract and a per-image instruction inserted immediately before that inline image. Gemini still does not receive a separate numeric image-weight parameter.
- New generated gallery records store the pipeline version, model ID, generation settings, effective prompt, references, and optional evaluation.

Completed generations enter a debounced evaluation queue. The HUD star opens the same evaluator manually; an empty star means unrated and a filled orange star means rated. Evaluation fields are:

- Task match: 1-5
- Subject match: 1-5
- Label match: 1-5 or N/A
- Strength match: 1-5
- Free-text comment

Evaluations persist on the gallery record in IndexedDB. Project `EXPORT EVALUATIONS` sends rated records only to `POST /api/evaluations/export`. The Node route writes local research files under the ignored `evaluation-exports/` directory:

```
evaluation-exports/
  latest.jsonl
  latest-report.md
  history/<timestamp>.jsonl
  history/<timestamp>-report.md
```

Exports contain prompts, pipeline/model/settings metadata, reference role/label/strength, result metadata, ratings, and comments. They exclude API keys, image base64/data URLs, and unrated generations.

Initial `subject-v1-strength` evaluation (five rated generations using the `FASHION` label) found:

- 24% subtle influence was too weak for Subject and Label matching.
- 76% strong influence produced the best overall balance.
- 100% locked influence approached reference copying and reduced Task Match.
- Unrequested backgrounds, props, and wardrobe additions were the repeated failure.
- The next Subject revision should translate labels into narrower targets and define a policy for scene/prop invention when the task does not request them.

---
## Legacy Generation Pipeline

```
1. PromptBuilder.collect()     — reads ModuleState + settings → structured payload
                                 reads clr.dataset.visionDesc from DOM
2. DescriptionRegistry         — On Load only: catch-up scan finds missing descriptions
   .collectMissing()           — ensureAll() scans via VisionScan when scanTiming === 'load'
   .ensureAll()                — results written to module DOM, then PromptBuilder re-collects
                                 On Generate skips catch-up scan and leaves missing descriptions inline
3. PromptEnhancer.enhance()    — builds text message from modules + loose references, sends only undescribed images inline
                                 calls Gemini 2.5 Flash → returns { prompt, manifest }
4. googleGenerate()            — sends enhanced prompt + all active module/reference images → returns predictions
                                 N variations = N parallel calls (allSettled — successes survive a failed call)
5. Gallery.resolveLoading()    — displays result, saves to IndexedDB via project-aware gallery storage
6. Registry.clear()            — if Keep Descriptions OFF, clears all stored descriptions
```

There is no single-request multi-image parameter for the Gemini image models, so each variation is a separate `callGoogleAPI`. They run concurrently via `Promise.allSettled`; a failed call (network / 429-after-retries / safety block) is dropped without discarding the variations that succeeded. The batch only errors when *zero* images come back.

## Current Gallery Generation Behavior
- Separate generation batches can be started while earlier batches are still running. The FRAME button remains visually busy while any batch is active but does not lock further submissions.
- HTTP 429 quota errors are not retried automatically. They render a temporary Gallery `RETRY` action that repeats only that image request when clicked; the retry closure is not persisted across refresh.
- Loading tiles resolve per variation.
- Requests time out after `90s` so hung calls stop cleanly.
- Non-success outcomes render explicit tile labels:
  - `BLOCKED`
  - `QUOTA`
  - `TIMEOUT`
  - `FAILED`
- Retry only appears when retry is meaningful (`QUOTA`, `TIMEOUT`, and generic `FAILED`).
- Gallery loading tiles use the same shimmer animation style as Studio loading thumbnails.
- Effective prompts are intentionally minimal: user text becomes `Task: ...`; an empty prompt falls back to `Create one finished image from the provided references.`
- Reference guidance emits the image label, assigned role, and one generic role instruction per active image. Absent roles are not mentioned.
- Root Module images use visible top-to-bottom layer order for prompt numbering, manifest positions, inline image order, and HUD `usedImages`.

Current Next.js Module ordering behavior:
- Root module rows reorder with pointer movement, not native HTML drag, so the cursor stays quiet/default.
- Folder/file movement still uses native drag/drop.
- Ordering currently persists through the existing `modified` sort field. A dedicated `order` field would be cleaner later, but was not added in this polish pass.

Current Next.js Module reference-card behavior:
- The Module detail image area uses `src/components/ModuleReferenceCard.tsx`, separate from Studio code but visually based on the Studio card pattern.
- Role and image-name controls live inside the card header and push the image area down when expanded.
- Uploading a brief image now asks for a role before adding it; the default is `SUBJECT`.
- Image label and stored file name stay matched on upload and rename.
- Card-level replace targets the selected card image, not whichever module row is currently active.

---

## Legacy VisionScan Pipeline

This section documents the former plain-JavaScript pipeline and is not active in the current Next.js implementation.

VisionScan (`vision.js`) describes individual images using `gemini-2.5-flash`. Its output feeds the enhancer so the enhancer call becomes text-only for described images — faster and cheaper than sending everything inline.

All caching is handled by **DescriptionRegistry** (`registry.js`) — VisionScan functions call Gemini directly, no internal cache.

### Scan Timing Setting

**On Load** — VisionScan runs immediately when an image is uploaded to a module slot. Description is stored via `DescriptionRegistry.ensure()` which populates `_store` (URL→description map). Result also written to `clr.dataset.visionDesc` in the DOM for PromptBuilder to read.

**On Generate** — No scan on upload and no catch-up scan before enhancement. Missing descriptions stay `null`; `PromptEnhancer` sends those module/reference images inline to Gemini so it reads the current pixels. This mode must not reuse enhancer output when inline images are present.

### How Descriptions Flow Into the Enhancer

- `collectImageContext()` reads `child.visionDesc` → stores as `desc` on each image item
- Items with `desc` → rendered as text in the message (`[Identity anchor] tall woman, black hair...`)
- Items without `desc` → rendered as `[Identity anchor — Image N]` and sent inline
- The final Gemini call receives: text message + only the undescribed inline images

### Keep Descriptions Setting

**Keep ON** — Description text is cached for the session.
- Registry `_store` persists across generates → described images can reuse text descriptions
- Enhancer output is cached only when there are **zero inline images**. If module/reference images are sent inline, the enhancer cache is disabled so Gemini re-reads the current image pixels.

**Keep OFF** — Always fresh.
- Registry descriptions are used for the current generation
- `Registry.clear()` is called after successful generation (`api.js`)
- Enhancer brief cache is never written
- On Load: catch-up scan can refill missing descriptions before enhancement
- On Generate: inline images go directly to PromptEnhancer; no description catch-up scan

### Scan Failure Fallback

If VisionScan fails for any image (429, timeout, network error), that image's `desc` stays null → falls back to inline automatically. The generation continues — failure is silent per image, not a pipeline abort. `ensureAll()` catches individual failures and returns `null` for failed scans.

### Retry Behavior

All Google calls share one helper — `CafeNet.fetchJSON` (`logic/net.js`) — which handles 429 retry/backoff plus an optional per-attempt timeout (used by VisionScan's AbortController path):
- Attempt 1: wait 5 seconds, retry
- Attempt 2: wait 10 seconds, retry
- After 2 retries: hard fail (VisionScan → image goes inline; enhancer → pipeline aborts; generation → that one variation is dropped, the rest of the batch still resolves)

`api.js`, `enhancer.js`, and `vision.js` all route through it; each keeps its own response parsing and logging.

---

## Module Architecture

The visible Module Panel is now the S-C reference manager: a 264px sidebar for image references, loose uploads, named modules/folders, per-image AI-use controls, and image inspection.

### Current Module Panel (`logic/module-panel.js`)

Primary state is `window.ModuleState.cafeModule`:

```js
{
  files: [
    {
      id, folder, kind: 'IMG',
      label, name, size, dims, modified,
      linked, eye, strength, mode,
      uuid, url, visionDesc
    }
  ],
  folders: [
    { id, name, accent, locked }
  ],
  openFolders: []
}
```

- **Optional preset modules** - `SUBJECT`, `STAGE`, `STYLE`; added on demand through `+ NEW MODULE`.
- **No custom modules in this iteration** - the module form only accepts inactive presets.
- **Loose images** - root-level files with `folder: null`; shown above folders, counted as `LOOSE`, and treated as the neutral Reference layer during generation.
- **Image row menu** - `STUDIO`, `RENAME`, `MOVE TO...`, `DUPLICATE`, `REMOVE`.
- **Image Inspector** - opens on row click; controls label, reference mode, strength, linked/visible state, info panel, and top-right `...` actions (`STUDIO`, `REPLACE`, `RENAME`, `REMOVE`).
- **Module action menu** - module header `...` opens `EDIT` and `DELETE`.
- **Module edit form** - reuses the old add/rename form as a preset selector plus accent swatches. Existing modules can swap to another inactive preset; if all presets are active, only color can change.
- **Module delete** - removes the module and returns its images to loose Reference layer; images are not deleted.
- **Generation inclusion** - assigned module files require `linked && eye && url`; loose Reference-layer files require `eye && url`.
- **Image names** - assigned file labels become module layer roles; loose file labels become Reference-layer roles. These names are prompt semantics, not just UI labels.

### Legacy Generation Bridge

PromptBuilder still reads `window.ModuleState.subject/stage/style` HTML snapshots. The new panel keeps that contract alive by generating hidden compatible snapshots from `cafeModule`.

Mode-to-section mapping for custom-folder files:

- `SUBJECT` -> subject
- `COMP` / `ALL` -> stage
- `STYLE` / `ALL` -> style

System folders also map directly: `SUBJECT` -> subject, `STAGE` -> stage, `STYLE` -> style.

### Legacy Layer Model

The old visible layer model is no longer the primary UI, but the shape remains important for PromptBuilder compatibility and old saved projects. Legacy project state without `cafeModule` is imported into the new flat file list when possible.

```
SUBJECT
  └── SLOT (A–G) — independent sets, each toggleable
        └── LAYER GROUP — user-named (CHARACTER, OUTFIT, BACKGROUND, etc.)
              └── CHILD (clr) — image upload OR text prompt, with visibility toggle

STAGE / STYLE
  └── LAYER GROUP — user-named
        └── CHILD (clr) — image upload OR text prompt, with visibility toggle
```

- Multiple slots = independent sets (not the same thing from multiple angles)
- Multiple image children in the same layer = multiple views of the same thing
- `window.ModuleState = { subject, stage, style, cafeModule }` — live state

---

## T Button — Compose System

Each child slot (`.clr`) has a `T` badge:

- **blue T** — empty, no text. Click opens COMPOSE row (textarea + GENERATE + SAVE)
- **orange T** — text saved in `clr.dataset.savedPrompt`. Click reopens compose pre-filled
- **SAVE** — stores text, renders slot as text-prompt child (orange T)
- **GENERATE** — calls `CafeAPI.generateLayerImage(text)`, converts slot to image on success. Sets `clr.dataset.visionDesc = text` directly, bypassing vision scan

---

## Prompt Bar Upload Shortcut

The prompt-bar `+` button is a module intake shortcut only.

- Button id: `#moduleQuickUpload`
- Action: calls `window.ModulePanel.openUpload()`
- Result: opens existing module upload form; uploaded images go into module panel flow (loose/module files)
- No separate global reference lane, no R1-R5 manifest path

Loose uploads now enter `PromptBuilder.collect().refs` as the Reference layer. They are not Subject, Stage, or Style, so the enhancer treats them as supporting context only. Moving an image into a folder promotes its name into that module's role instead.

---

## Studio Overlay

Studio is the current image editing workspace for Gallery images and Module image layers.

Current Next.js implementation note (`src/components/Studio.tsx`, `src/components/StudioModule.tsx`, `src/context/StudioContext.tsx`, `src/lib/pipeline/api.ts`):

- Studio uses the shared canvas prompt-bar visual language, without the canvas settings and `+` controls.
- Studio refine sends the active image directly and omits `imageConfig.aspectRatio` unless a caller explicitly provides one. This lets cropped/freeform images rely on API/model shape inference instead of forcing `1:1`.
- Studio prompt supports `/upscale 2k` and `/upscale 4k`, optionally followed by prompt text. The slash command is parsed locally and is not sent as model prompt text; only the text after the command is sent.
- `/upscale` sends `imageSize: "2K" | "4K"` with no `aspectRatio`, no annotation image, and no Studio reference images. This keeps upscale testing isolated to the active base image.
- Studio generations create gallery records with `STUDIO REFINE` or `STUDIO UPSCALE` metadata and `usedImages` provenance.
- Studio reference images have per-image visibility, remove, and replace controls. Replace keeps the same image UUID and updates the stored `DB.images` data URL.
- The Studio reference card visual state is centralized in `globals.css` under "Studio reference card polish": orange image/name/action borders in normal state, light-gray active command/name borders, orange tile controls with light-gray icons/borders.

- **Entry points** — Gallery HUD pencil and Module image row / Image Inspector `...` menu `STUDIO` both call `window.Studio.open({ imgUrl, uuid, ratio, caller, onDone })`
- **History is image-specific** — saved under `DB.studioState.histories[uuid]`, not shared globally
- **Active history image** — clicking a history thumbnail updates `activeUrl`; Back returns that selected active image to the caller
- **Gallery return** — replaces the original Gallery image in place with the selected active Studio image
- **Module return** — replaces the module image in place and keeps the same module image UUID so Studio history remains attached
- **References are image-specific** — Studio module/reference layers are stored as `layers` on the same per-UUID Studio session
- **No automatic Gallery publishing** — Studio outputs do not auto-add new Gallery rows. Future behavior should be an explicit “Save to Gallery” action.
- **REFINE stays active** — the Studio `REFINE` button is no longer visually disabled during in-flight Studio generations.

### Studio Reference Panel (`studio-module.js`)

Purpose-built panel — does not use `ModulePanel.makeSection`. Owns its own render/serialize cycle.

- **ACTION system** — each reference group carries one of `INSERT | SWAP | TRANSFER | REMOVE | PRESERVE` (default: `TRANSFER`). Action is sent to the API alongside the reference images.
- **Adding groups** — header `+` button opens an action-type menu; user picks action, then file picker opens. First image creates the group.
- **Adding images to a group** — add-child-row button below each group. Max 3 images per group (`MAX_IMAGES_PER_GROUP`).
- **Action drawer** — click the action button on any group to open a picker; closes all other drawers first.
- **Name editor** — click the group name label to open an inline input; Enter/Escape/blur commits. Opening name editor closes any open action drawer on the same group.
- **Serialize** — `serialize()` reads the DOM and returns `{ groups: [{ action, name, images: [{ uuid }] }] }`. Images store UUID only; `resolveMissingImages()` fetches base64 from `DB.images` on load.
- **Legacy compat** — `parseLegacyLayers()` converts old HTML-snapshot format to new shape on restore.

---

## Gallery HUD

- HUD navigation includes completed image cells only. Loading, blocked, and failed Gallery tiles remain visible in the grid but are excluded from HUD slides and its counter.
- HUD shows normalized image metadata (`Date`, `Type`, `Dimensions`) from gallery records.
- Provenance is text-only in the current build:
  - `Studio Edit` -> "Updated from an earlier gallery image."
  - `Duplicate` -> "Copied from another gallery image."
- The earlier `OPEN SOURCE IMAGE` jump control was removed because it was not reliable against filtered or deleted gallery state.
- Prompt copy in HUD falls back cleanly when the embedded browser denies `navigator.clipboard.writeText()`.

---

## Projects Panel

The Projects modal is owned by `logic/prompt-bar.js`; persistence lives in `logic/workspace.js` and `logic/storage.js`.

- **New** - creates `Project N` directly, loads it with `skipSave=true`, and closes the modal
- **Delete** - visible `×` button removes the project and cascades its related DB records
- **Delete final project** - clears the workspace and leaves the Projects list empty; it does not auto-create a replacement project
- **Storage cascade** - project/settings/module/studio/reference/gallery/sequence records delete first, then image/description records clean up by project

---

## Models

| Label | Model ID | Thinking | Resolutions |
|---|---|---|---|
| NANO BANANA | `gemini-2.5-flash-image` | none | default only |
| NANO BANANA 2 | `gemini-3.1-flash-image` | minimal / high (user-selectable, default minimal) | 512, 1K, 2K, 4K |
| NANO BANANA PRO | `gemini-3-pro-image` | on by default, not configurable | 1K, 2K, 4K |

`thinkingLevel` values are lowercase (`minimal` / `high`). Only NB2 exposes a selectable level — a "Thinking" control appears on the settings API page when NB2 is active (`CafeSettings.getActiveThinkingLevel()`). `seed` is **not** supported by any of these models (Imagen-only) and is not sent.

Enhancer model: `gemini-2.5-flash` (text + vision, not an image model)

---

## Video Generation

The Next.js Video tab lives at `src/app/video/page.tsx`. Its API client is `src/lib/video/api.ts`.

Verified Gemini API Veo model IDs:

| Label | Model ID | Stage | Resolutions | Reference assets |
|---|---|---|---|---|
| VEO 3.1 | `veo-3.1-generate-001` | GA | 720p, 1080p | Up to 3 |
| VEO 3.1 FAST | `veo-3.1-fast-generate-001` | GA | 720p, 1080p | Up to 3 |
| VEO 3.1 LITE | `veo-3.1-lite-generate-001` | Preview | 720p, 1080p | Not supported |

The old `veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview` endpoints were discontinued on April 2, 2026. Google directs those workflows to the corresponding `-001` models.

Current request flow:

1. The browser posts the video request to `POST /api/video/generate`.
2. The Node.js route creates an Enterprise `GoogleGenAI` client using the server-only `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` environment variables.
3. The route starts generation through `ai.models.generateVideos(...)`, passing `prompt` and optional `image` at the top level.
4. Poll through `ai.operations.getVideosOperation({ operation })`.
5. Stream the MP4 response to the browser and add the clip to the Video `SEQUENCE` rail.

Video generation uses Vertex Enterprise mode and does not use the browser-held image API key. The Next.js server requires Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; project and location alone do not authenticate the request.

Local Vertex configuration belongs in `.env.local`, which is ignored by Git. `.env.example` contains only placeholder variable names for setup guidance. Deployed environments must configure the same variables through their hosting platform's secret/environment settings.

Supported UI modes:

- `FRAMES`: start frame plus optional end frame.
- `REFERENCES`: up to the selected model's reference-asset limit; currently 3 for VEO 3.1 and FAST.
- Reference-image generation requires 8 seconds.
- Supported durations are 4, 6, and 8 seconds.
- Supported aspect ratios are 16:9 and 9:16.
- Maximum output videos per prompt is 4.

Generated video persistence:

- The `videos` IndexedDB store contains project-scoped MP4 blobs and clip metadata.
- Each record stores its prompt, model, duration, creation time, and sequence order.
- The Video page restores the active project's clips after reload or project switching.
- The MEDIA panel exposes the same records through a `VIDEO` folder; the folder and sequence do not duplicate the video binary.
- Reordering and deleting sequence clips updates the persistent records.
- Project deletion cascades through the `videos` store.
- Runtime playback uses temporary blob URLs, which are revoked when clips are removed, projects change, or the page closes.

Official source: `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate`

---

## Provider

Google Vertex AI Express mode through the official `@google/genai` SDK. The current browser-held API key is passed to `GoogleGenAI({ vertexai: true, apiKey, apiVersion: "v1" })`. fal.ai has been removed entirely.

---

## Window Globals

```
window.CafeAPI          — generation pipeline (api.js)
window.PromptBuilder    — payload collector (prompt-builder.js)
window.PromptEnhancer   — brief writer / manifest builder (enhancer.js)
window.DescriptionRegistry — centralized description store (registry.js)
window.VisionScan       — image description agent (vision.js)
window.CafeSettings     — settings state + modal (settings.js)
window.Workspace        — project persistence (workspace.js)
window.DB               — IndexedDB abstraction (storage.js)
window.CafeDebug        — generation run logger (debug-logger.js)
window.Gallery          — gallery UI (gallery.js)
window.ModuleState      — live module state (module-panel.js)
window.ModulePanel      — module panel facade { getState, render, openUpload, setVisionDesc, clearVisionDescriptions } (module-panel.js)
window.Studio           — studio overlay (studio.js)
window.StudioModule     — studio reference panel (studio-module.js)
window.StudioModuleState — live studio module state (studio-module.js)
window.refState         — empty compatibility shim { FRAME: [], SCENE: [] }
```

No `CafeEntities` registry — direct window globals only.

---

## Future Components (not built)

- **Audio Tab** — scoring, voiceover, sound design
- **Timeline Tab** — full editing, trimming, transitions, and final assembly
- **SCENE mode** — shot-by-shot video pipeline

---

## Figma-to-Code Workflow

1. Fetch design using Figma MCP tool
2. Describe the visual in plain terms before writing any code
3. Wait for user confirmation before proceeding
4. Screenshot is source of truth — not Figma's generated code
5. NEVER use Figma asset URLs — they expire. Recreate with CSS or inline SVG.

---

## Component Build Process

1. Build every component as a standalone HTML file in the local workspace first
2. User reviews and approves the standalone version
3. Only then integrate into `CafeHTML-v2.html`
4. When syncing — do NOT launch explore agents. Grep/Read the target file at insertion points and edit directly.

---

## Code Style

- Color tokens: orange `#ea5823`, blue `#5271ff`, gray `#999997`, light gray `#c7c7c7`, off-white `#e8e6e6`
- Font: Times New Roman, all-caps labels
- No extra comments, no docstrings, no unnecessary abstractions
- Don't add features beyond what was asked
- Match existing patterns in `CafeHTML-v2.html`

---

## Communication

- User is a designer — explain technical decisions in plain language
- Keep responses short and direct
- Never go ahead and build without visual confirmation first

---

## Design System

### Color Tokens

| Token | Hex | Role |
|---|---|---|
| Orange | `#ea5823` | Primary CTA, active states, selected tabs |
| Blue | `#5271ff` | Secondary actions, inactive UI, borders |
| Gray mid | `#999997` | Neutral/inactive backgrounds |
| Gray light | `#c7c7c7` | Text on dark, borders, inactive labels |
| Off-white | `#e8e6e6` | Backgrounds, surface |

### Typography

Font: `Times New Roman`, serif — ALL labels, everywhere. No exceptions.

### Icon Rules

- All icons are `.svg` files in `CafeHTML/assets/`
- Never use Figma asset URLs — they expire in 7 days. Recreate in CSS/SVG or save locally.
- Active/inactive pairs: `icon-eye-on.svg` / `icon-eye-off.svg`, `icon-x-active.svg` / `icon-x-inactive.svg`, `icon-edit-active.svg` / `icon-edit-inactive.svg`, `icon-link.svg` / `icon-unlink-small.svg`, `icon-close.svg` (child row X)

---

## Module Panel Dimensions

| Property | Value |
|---|---|
| Width | `264px` |
| Background | `#999997` |
| Border | `1.89px solid #5271ff` |

---

## Parent Layer Row (`.plr`)

**Dimensions:** `263px × 25px`

| Element | Class | Width | Description |
|---|---|---|---|
| X button | `.plr-x` | 24px | Remove / Reset layer |
| Expand toggle | `.plr-exp` | 24px | Expand/collapse children |
| Layer name | `.plr-name` | 153px | Editable label |
| Link button | `.plr-link` | 24px | Link/unlink layer |
| Eye button | `.plr-eye` | 25px | Show/hide layer |

| State | X | Expand | Name | Link | Eye |
|---|---|---|---|---|---|
| **Active · Linked** | `.blue` | `.orange` | `.blue` | `.linked` | `.on` |
| **Active · Unlinked** | `.blue` | `.orange` | `.blue` | `.unlinked` | `.on` |
| **OFF (hidden)** | `.off` | `.off` | `.gray` | `.off` | `.off` |

When hidden, `.layer-off` on `.plr` grays out X, expand, name, and link via CSS cascade.

---

## Child Layer Row (`.clr`)

**Dimensions:** `263px × 25px` | **Padding:** `0 32px`

### Mode A — Load (default, empty)

| Element | Class | Notes |
|---|---|---|
| X button | `.clr-x` | Blue |
| Main area | `.clr-main.load` | Shows LOAD button icon |
| T button | `.clr-t.blue` | Opens COMPOSE row on click |

### Mode B — Image Loaded

| Element | Class | Notes |
|---|---|---|
| X button | `.clr-x` / `.clr-x.off` | Blue when visible, gray when hidden |
| Main area | `.clr-main.img-a` / `.img-i` | Active/inactive image thumbnail |
| Edit button | `.clr-edit.a` / `.clr-edit.i` | Pencil icon — opens Studio overlay |
| Eye button | `.plr-eye.on` / `.plr-eye.off` | Toggle visibility |

### Mode C — Prompt Active

| Element | Class | Notes |
|---|---|---|
| X button | `.clr-x` / `.clr-x.off` | Blue when visible, gray when hidden |
| T button | `.clr-t.orange` / `.clr-t.gray` | Orange = visible, gray = hidden |
| Main area | `.clr-main.prompt-a` / `.prompt-i` | Shows "PROMPT" label |
| Eye button | `.plr-eye.on` / `.plr-eye.off` | Toggle visibility |

---

## Style Module

STYLE uses the same layer structure as SUBJECT and STAGE — `.layer-group` → `.clr` children. No slots, no separate Style Row component. `VisionScan.describeStyle()` is called for its image children instead of `describe()`.

---

## Slot Switch Row (`.subject-row`)

Controls which subject slot (A, B, C…) is active and ON/OFF.

| Element | Class | Notes |
|---|---|---|
| Tab buttons | `.btn-subject-a` | One per subject; `.on` = selected |
| Add subject | `.btn-add-subject` | Orange `+` button |
| ON button | `.btn-on` | Orange when slot is ON |
| OFF button | `.btn-off` | Orange when slot is OFF |

`.slot-is-off` on `.subject-row` swaps ON/OFF visual states via CSS.

---

## Button Interaction Rules

### Eye Button — Show / Hide Layer
- Toggles layer visibility. Does NOT remove content.
- When OFF: row grays out (X, expand, link all go inactive)

### X Button — Remove or Reset

> **The module always maintains a minimum of 1 active parent layer with 1 active child layer.**

| Scenario | X on Parent | X on Child |
|---|---|---|
| Multiple parent layers exist | Removes entire parent + all children | — |
| 1 parent · multiple children | Cannot remove parent → Reset parent | Removes that child |
| 1 parent · 1 child (floor) | Resets parent to default | Resets child to Load |

**Reset:** Parent → eye ON, link linked, expand open. Child → Load mode, eye ON.

### T Button — Text / Prompt Toggle

| Location | Default state | Click action |
|---|---|---|
| Child row · Load mode | `.clr-t.blue` | → Activates Prompt mode |
| Child row · Prompt mode | `.clr-t.orange` (visible) / `.gray` (hidden) | → Back to Load mode |

### Edit (Pencil) Button

`.clr-edit` — opens the Studio overlay for image editing (`window.Studio.open`).

### Link / Unlink Button

`.plr-link` — linked = layers synced across subjects. Unlinked = independent per subject. Toggle swaps `linked` ↔ `unlinked` classes.

### Expand / Collapse (`.plr-exp`)

Orange = active, expanded. `.collapsed` rotates arrow −90°. Collapsing hides child rows visually.

---

## Child Layer State Machine

```
[Load mode]  ←──────────────────────────────────────────────┐
    │ click LOAD                   │ click T (deactivate)    │
    ↓                              │                         │
[Image mode]                  [Prompt mode]                  │
    │ click Eye                    │ click Eye               │
    ↓                              ↓                         │
[Image Hidden]              [Prompt Hidden]                  │
    │ click X (reset)              │ click X (reset)         │
    └──────────────────────────────┴─────────────────────────┘
```

---

## Component Registry

| Component | File | Status |
|---|---|---|
| Prompt Bar + Ref Chips + Projects | `logic/prompt-bar.js` | Done |
| Module Panel (SUBJECT/STAGE/STYLE) | `logic/module-panel.js` | Done |
| Gallery + Image HUD | `logic/gallery.js` | Done |
| Sequence Bar | `logic/sequence-bar.js` | Done |
| Studio Overlay | `logic/studio.js` | Done |
| Studio Reference Panel | `logic/studio-module.js` | Done |

---

## Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-07 | X button resets instead of removes at minimum floor (1 parent + 1 child) | Keeps module always populated; prevents empty/broken state |
| 2026-04-07 | T button opens COMPOSE row; GENERATE sends text to `generateLayerImage()`; SAVE stores as text-prompt child | T = layer text/generate entry point |
| 2026-04-07 | Edit pencil opens Refine, not a mode toggle | It's an image editing action, not a state switch |
| 2026-04-07 | STYLE uses same layer structure as SUBJECT/STAGE | Removed separate Style Row — consistency across all three sections |
| 2026-04-07 | Only SUBJECT has slots (A–G). STAGE and STYLE are layer-only | STAGE and STYLE don't need independent scene/style sets |
| 2026-04-29 | fal.ai removed — Google AI Platform only | Single provider path, no branching |
| 2026-05-06 | PRECISE/CREATIVE mode removed | Not deep enough to be useful; removed rather than half-implemented |
| 2026-05-06 | Generation rate limit removed | `_activeRequests` kept for button state only; no REQUEST_LIMIT |
| 2026-05-08 | VisionScan pipeline wired into enhancer | Described images go as text, not inline — faster enhancer calls, less quota |
| 2026-05-08 | Enhancer brief cache added | Keyed on userMessage + image URLs; gated on Keep Descriptions setting |
| 2026-05-08 | Retry added to VisionScan and enhancer | 5s/10s on 429; generation model retry shortened from 20s/40s to 5s/10s |
| 2026-05-11 | Inline JS extracted to 5 logic/ modules | ~2400 lines split into prompt-bar.js, module-panel.js, gallery.js, sequence-bar.js, refine.js. Reduces context cost when editing. Load order is safe — all communication via window.* globals at click time. |
| 2026-05-12 | DescriptionRegistry centralized all image description storage | Replaced scattered storage (DOM dataset, VisionScan._cache, refState) with single URL→description map. refState shape changed from `string[]` to `{url, desc}[]`. Catch-up scan added to api.js. Image dispatch fixed — all images now sent to Nano Banana. VisionScan caching layer removed — Registry owns all caching. |
| 2026-05-18 | On Generate enhancer cache disabled for inline images | `PromptEnhancer` no longer reuses final brief cache when inline module/ref images are present. `Keep Descriptions` remains a description cache, not a stale generated-brief cache. Added UUID assignment for module uploads/generated module images and fingerprint logs in `api.js` / `enhancer.js`. |
| 2026-05-19 | Modular logic is canonical | The legacy inline behavior block in `CafeHTML-v2.html` is disabled as inert text. Runtime behavior now loads from `logic/prompt-bar.js`, `logic/module-panel.js`, `logic/gallery.js`, `logic/sequence-bar.js`, `logic/refine.js`, and the generation modules. `logic/registry.js` is loaded after `vision.js`. |
| 2026-05-21 | Inline CSS extracted from HTML | Extracted ~4000 lines of inline styles from `CafeHTML-v2.html` and prepended them to `style.css` to completely remove the single-file inline constraint. |
| 2026-05-21 | Parallel Generation Restored | Replaced `runSequential` with `Promise.all` in `api.js` to ensure that multiple requested variations are generated concurrently, drastically speeding up generation times. |
| 2026-05-25 | UUID image storage — all stores use UUID pointers | `DB.images` is the single source of truth for all image data. moduleState HTML, references, and gallery cells hold UUID keys. Base64 lives in DB.images only. Project delete and per-image-delete cascade properly. Export resolves UUIDs back to base64 for self-contained `.cafe` files. |
| 2026-05-25 | DB version detection is dynamic | Instead of hardcoded `DB_VERSION`, storage.js opens the DB, checks which stores are missing, and bumps version only when needed. Safe across future store additions. |
| 2026-05-25 | Studio module LOAD slot auto-prompts rename | After loading an image via the LOAD slot, `.plr-name` is immediately focused with text selected. Blur commits and saves to DB. Consistent with the `+` header ref-card naming flow. |
| 2026-05-26 | Studio sessions are keyed by source image UUID | History, active selected image, and Studio reference layers restore per image. Gallery and Module Studio no longer share references or history. |
| 2026-05-26 | Studio Back returns the selected active history image | Clicking a history thumbnail sets `activeUrl`; closing Studio returns that image to Gallery or Module instead of always returning the newest generated result. |
| 2026-05-26 | Studio does not auto-publish to Gallery | Gallery and Module callers both replace their original image in place. Future Gallery publishing should be an explicit "Save to Gallery" action. |
| 2026-05-26 | Projects modal can have zero projects | Deleting the final project clears the workspace and leaves the list empty; the app no longer auto-creates a replacement row that makes deletion look broken. |
| 2026-05-26 | Studio reference panel no longer uses ModulePanel.makeSection | Custom render/serialize cycle eliminates hidden slots, text rows, eye, and link behavior that ModulePanel always brought along. Panel state is `{ groups: [{ action, name, images: [{ uuid }] }] }`. |
| 2026-05-26 | Studio references carry ACTION intent | Each reference group has an action tag (INSERT / SWAP / TRANSFER / REMOVE / PRESERVE). The API prompt includes `action` + `intent` per reference so the model knows how to apply each image. Default action is TRANSFER. |
| 2026-05-26 | action-drawer-open separate from drawer-open | Action button active state only triggers on `.action-drawer-open`, not `.drawer-open`, so opening the name editor no longer falsely activates the action button. |
| 2026-05-27 | Seed control removed | Gemini image models (`gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`) do not support a `seed` parameter — documented only for Imagen, silently ignored here. Removed `generationConfig.seed`, the seed-lock UI, `data-seed` state, and dead CSS. Old projects ignore stored `seed`/`seedLocked` fields on load. |
| 2026-05-27 | Refine overlay removed | `logic/refine.js` (`RefineArea`) and `#refine-overlay` were dead — superseded by Studio, never invoked. Deleted the module, script tag, and markup. Shared `.refine-*` CSS classes kept (Studio reuses them). |
| 2026-05-27 | Shared `CafeNet.fetchJSON` helper | Extracted the duplicated fetch + 429 retry/backoff from `api.js`, `enhancer.js`, `vision.js` into `logic/net.js`. Supports a per-attempt timeout (VisionScan) and a log label. |
| 2026-05-27 | Gallery uses incremental DOM updates | Generation, duplicate, delete (single + multi), and project-load insert/remove a single cell instead of rebuilding the whole grid. Filter/sort changes and `clearGenerated` still full-rebuild. `cellIndexMap`/`rebuildIndexMap` dropped; a `visibleCells` array tracks the displayed list for HUD navigation. |
| 2026-05-27 | A project always exists at startup | Init creates a project when none exist, so `activeProjectId` is set before any upload. Prevents first-action uploads from being stored with `project_id: null` and then wiped by `runOrphanCleanup` on reload. |
| 2026-05-27 | Multi-variation calls run in parallel (again) | `googleGenerate` fires N variation calls concurrently via `Promise.allSettled` instead of a sequential chain. Restores the 2026-05-21 intent after the code had drifted back to sequential. No single-request multi-image param exists, so N images require N calls. |
| 2026-05-27 | A failed variation no longer discards the batch | `allSettled` keeps the images that succeeded; a rejected call is dropped. The batch only throws when zero images come back, surfacing the underlying error if every call failed. |
| 2026-05-27 | NB2 thinking level is user-selectable | NANO BANANA 2 exposes `minimal`/`high` via a Thinking control on the settings API page; `api.js` reads `CafeSettings.getActiveThinkingLevel()`. NB and Pro return null (thinkingConfig omitted). Values lowercased to match the docs. |
| 2026-05-27 | Gallery resolves variations one by one as each finishes | `googleGenerate` fires N calls in parallel; each resolves its own loading cell via `onVariationReady(dataUrl, idx)` callback as it completes. Results appear incrementally instead of all at once after `allSettled`. |
| 2026-05-27 | Failed variations show a RETRY cell | Rejected calls (network/429) fire `onVariationFailed(idx)` → `Gallery.failLoading()`. Cell stays in place, orange RETRY label. Click converts back to loading and retries one generation call using the same captured `finalPrompt`/`imageRefs` — no enhancer re-run. Retry failure loops back to RETRY cell. |
| 2026-05-27 | `DIMS`, `dimsFromRatio`, and `var dims` removed from `api.js` | Dead code — pixel dimensions were never used in the API call. Generation uses `aspectRatio` and `imageSize` strings, not explicit width/height values. |
| 2026-05-27 | Blocked variations show a BLOCKED cell | `promptFeedback.blockReason` (prompt-level) and `candidate.finishReason !== 'STOP'` (all non-success finish reasons) route to `onVariationBlocked(idx)` → `Gallery.blockLoading()`. Gray cell, gray BLOCKED label, click to dismiss. Not retryable — same prompt gets same result. |

| 2026-05-28 | Module Panel S-C redesign | Visible module UI is now the image-reference manager with loose images, preset folders, per-image mode/strength/state, Image Inspector, row/inspector `...` action menus, and `cafeModule` persistence. Legacy `subject/stage/style` snapshots are generated as a PromptBuilder compatibility bridge. |
| 2026-06-05 | Next.js migration baseline | Current implementation now lives in `src/` as a Next.js / React app. Legacy HTML docs remain useful for product architecture, but file paths and `window.*` implementation contracts are historical unless mirrored in `src/components`, `src/context`, or `src/lib/pipeline`. |
| 2026-06-19 | Current Veo 3.1 model IDs | Video generation uses `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, and `veo-3.1-lite-generate-001`. The Standard and Fast preview endpoints were discontinued on April 2, 2026. |

---

*Last updated: 2026-06-20*
## Video Workspace Update — 2026-06-20

- Responsive video workspace keeps the playback controls, sequence, and prompt controls visible while the preview contracts.
- Sequence thumbnails are square; remove controls appear on hover or keyboard focus.
- Removing a sequence clip detaches it without deleting the stored video.
- Videos can be dragged from the VIDEO folder into the sequence, appended on empty space, or inserted before an existing clip.
- Sequence membership and ordering persist per project.

*Last updated: 2026-06-20*

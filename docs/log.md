# CafeHTML Build Log

Track component work, decisions, and session continuations here.

---

## How to Use This Log

- Each session gets a dated entry
- Record what was built, what decisions were made, and what's left to do
- If a session ends abruptly, pick up from the last "IN PROGRESS" entry

---

## Sessions

### 2026-06-11 - Gallery/HUD/Studio Stabilization + Error-State Polish

**Status:** COMPLETED

**What Was Done:**
- Stabilized the Next.js gallery, HUD, and Studio flows after the earlier metadata/provenance pass.
- Removed the unreliable `OPEN SOURCE IMAGE` control from HUD and kept provenance as read-only text.
- Fixed the generation-debug regression by removing `sessionStorage` persistence from the debug path; debug now stays in `window.__cafeLastGenerationDebug` only.
- Added generation request timeouts (`90s`) so hung API calls stop cleanly instead of leaving endless loading tiles.
- Added top-level loading cleanup so failed generations do not leave orphaned gallery placeholders behind.
- Hardened HUD prompt copy behavior with a fallback copy path for embedded browsers where `navigator.clipboard.writeText()` is denied.
- Kept the Studio `REFINE` button active during in-flight Studio generations instead of visually disabling it.
- Added richer gallery cell metadata normalization: `kind`, `origin`, `createdAt`, `updatedAt`, `sourceUuid`, and structured `usedImages`.
- Added explicit gallery generation failure labels:
  - `BLOCKED`
  - `QUOTA`
  - `TIMEOUT`
  - `FAILED`
- Retry is now shown only when it is meaningful (`TIMEOUT` and generic `FAILED`).
- Blocked and failed tiles no longer keep the old loading glow.
- Main gallery loading tiles now use the same shimmer animation style as Studio loading thumbnails.

**Files Touched:**
- `src/app/globals.css`
- `src/components/Gallery.tsx`
- `src/components/HUD.tsx`
- `src/components/PromptBar.tsx`
- `src/components/Studio.tsx`
- `src/context/GalleryContext.tsx`
- `src/lib/pipeline/api.ts`
- `src/lib/pipeline/prompt-builder.ts`
- `docs/log.md`
- `docs/CafeHTML.md`

### 2026-06-11 - Studio Active Image Persistence

**Status:** COMPLETED

**What Was Done:**
- Fixed Studio so the selected active history image is persisted separately from the history stack.
- `StudioContext` now stores `activeUrl` alongside `history`, restores it on open, and saves it on close/autosave.
- `Studio` now reads the shared active URL from context instead of keeping a separate private copy.
- This prevents the UI from showing one selected thumbnail while returning or restoring a different image later.

**Files Touched:**
- `src/context/StudioContext.tsx`
- `src/components/Studio.tsx`
- `docs/log.md`

### 2026-06-11 - Generation Debug Capture + Dev Startup Notes

**Status:** COMPLETED

**What Was Done:**
- Added a local generation debug trail so the latest prompt payload can be inspected without copying it out manually.
- The latest run writes to `window.__cafeLastGenerationDebug`.
- Added capture points in `src/components/PromptBar.tsx` and `src/lib/pipeline/api.ts` so prompt payload, settings, module files, manifest, and run status can be checked after generation.
- Confirmed the gallery renders generated images through `GalleryContext.resolveLoading()` into `.cell-inner` background images.
- Documented the local dev startup issue: `Start-Process npm` is unreliable in this Windows environment because of duplicate `Path` / `PATH` entries, and Next may need an approval-backed launch because of sandbox child-process restrictions.

**Notes:**
- The debug payload is tab-scoped runtime state and clears on refresh/reload.
- The dev-server launch that works here is `cmd /c npm run dev` via a hidden non-interactive process start.

**Files Touched:**
- `src/components/PromptBar.tsx`
- `src/lib/pipeline/api.ts`
- `docs/CafeHTML.md`
- `docs/log.md`

### 2026-06-05 - Next.js Migration Baseline + Repo Hygiene

**Status:** COMPLETED

**What Was Done:**
- CafeHTML is now running as a Next.js / React app under `src/`.
- Legacy docs still describe the original HTML implementation, so `docs/CafeHTML.md` now includes a migration note that separates current Next.js files from legacy `CafeHTML-v2.html` / `logic/*.js` paths.
- Cleaned remaining real mojibake in `docs/CafeHTML.md` project-modal lines.
- Lint cleanup: stale hook dependencies and unused values were resolved.
- ESLint now intentionally disables `@next/next/no-img-element` because CafeHTML uses generated, uploaded, IndexedDB, and data URL images where native `<img>` is the pragmatic browser element.
- Missing API key behavior now opens Settings on the API tab instead of blocking prompt generation with an error path.
- UI-facing encoded symbols were normalized in the React component layer.
- `.gitignore` now ignores local dev logs, local docs, and bundled Git tooling (`mingit/`, `mingit.zip`).

**Current Next.js Map:**
- App shell: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- Components: `src/components/*`
- State: `src/context/*`
- Pipeline: `src/lib/pipeline/*`
- Storage: `src/lib/db.ts`

**Known Notes:**
- Legacy architecture docs are still valuable for product behavior and pipeline intent.
- Legacy file paths and `window.*` contracts are historical unless mirrored in the current `src/` implementation.

---

### 2026-05-27 — Per-Variation Gallery Resolution + Error Cells

**Status:** COMPLETED

**What Was Done:**

**`logic/api.js` — Per-variation gallery resolution:**
- `googleGenerate()` now accepts `onVariationReady(dataUrl, idx)`, `onVariationFailed(idx)`, and `onVariationBlocked(idx)` callbacks.
- `runParallel()` refactored — each call is wrapped independently. `onVariationFailed` fires via `baseCall.catch()` (independent, so allSettled still sees the rejection). `onVariationReady` and `onVariationBlocked` fire via `baseCall.then()`.
- `blocked` detection covers both `result.promptFeedback.blockReason` (prompt-level) and `candidate.finishReason !== 'STOP'` (all non-success finish reasons: `SAFETY`, `RECITATION`, `OTHER`, `IMAGE_PROHIBITED_CONTENT`).
- `buildCell(dataUrl)` extracted as shared helper — used by `onVariationReady` and retry closure.
- `onVariationFailed(idx)` — calls `Gallery.failLoading(loadingId, retryFn)`. Retry closure calls `googleGenerate` with `numImages=1` using the same `finalPrompt`/`imageRefs` already in the closure — no re-running the enhancer. Retry can fail again and show error cell again.
- `onVariationBlocked(idx)` — calls `Gallery.blockLoading(loadingId)`.
- Gallery cells now resolve one by one as each variation finishes, not all at once after `allSettled`.
- Cleanup `loadingIds.forEach(removeLoading)` at end of `.then()` — no-op on resolved/failed/blocked cells (all strip `data-loading-id`), removes any remaining spinners from unexpected empty responses.

**`logic/gallery.js` — Error cell methods:**
- `Gallery.failLoading(loadingId, retryFn)` — converts loading cell to gray `#999997` error cell with centered orange `RETRY` label. Strips `data-loading-id`. Click restores orange pulsing loading state, assigns new `loadingId`, calls `retryFn(newLid)`.
- `Gallery.blockLoading(loadingId)` — converts loading cell to gray `#999997` blocked cell with centered gray `BLOCKED` label. Strips `data-loading-id`. Click removes the cell.

**`style.css` — Error cell styles:**
- `.cell-inner.cell-error` + `.cell-error-label` — gray background, orange RETRY text, pointer cursor.
- `.cell-inner.cell-blocked` + `.cell-blocked-label` — gray background, light gray BLOCKED text, pointer cursor (click to dismiss).

**Decisions:**
- Results appear as each variation finishes, not batched — matches Whisk pattern, feels faster without changing actual generation time.
- RETRY only for rejected promises (network/429) — transient errors. Retry reuses captured `finalPrompt`/`imageRefs` from closure, no enhancer re-run.
- BLOCKED for all model-refused responses — not retryable. Click to dismiss.
- `promptFeedback.blockReason` (prompt-level) and `finishReason !== 'STOP'` (candidate-level) both route to BLOCKED — covers all refusal paths.

**Files Touched:**
- `logic/api.js`
- `logic/gallery.js`
- `style.css`

---

### 2026-05-08 — VisionScan Pipeline + Enhancer + Retry + Cache

**Status:** COMPLETED

**What Was Done:**

**`logic/enhancer.js` — VisionScan pipeline wired in:**
- Added `scanPayloadImages()` — runs VisionScan on module images at generate time when scan timing is `'generate'`. Mutates payload child objects with `visionDesc` before `collectImageContext()` reads them.
- `collectImageContext()` — positions now only assigned to non-described images (inline candidates). Described images get no Image N.
- `renderSlotGroup()` — renders description text when `desc` is present instead of `[Image N]` label.
- `enhance()` — only sends undescribed images inline to Gemini. Described module images go as text in the message. Refs always inline.
- `buildDirectorPlan()` — `/ Image N` references guarded for subject/stage/style items that may have descriptions.
- System instruction updated — removed "every image is attached inline", added description/inline split explanation.
- Added retry to `enhance()` — 429 retries at 5s then 10s (was: no retry, hard fail).
- Added session-level brief cache — keyed on `userMessage + image URL prefixes`. Read/write gated on `getKeepDescriptions()`.
- Log updated to report inline vs described image counts.

**`logic/vision.js` — Retry added:**
- `callGemini()` restructured into `runOne(attempt)` — 429 retries at 5s then 10s. Each retry gets a fresh `AbortController` and timeout timer.

**`logic/api.js` — Cleanup + retry tuning:**
- Fixed redundant `getGoogleApiKey()` call — was fetching twice, now uses already-fetched `apiKey`.
- Generation retry waits shortened from 20s/40s → 5s/10s.

**`docs/CafeHTML.md` — Architecture updated:**
- Generation Pipeline section rewritten to reflect new flow.
- New VisionScan Pipeline section added — covers On Load vs On Generate, description flow, Keep ON/OFF behavior, fallback, retry.
- Decisions log updated with today's changes.

**Decisions:**
- Retry: 2 attempts, 5s/10s waits — applies to VisionScan, enhancer, and generation model
- Cache: enhancer brief cached when Keep Descriptions ON; cleared when OFF (VisionScan cache cleared too)
- No DOM write-back needed — VisionScan `_cache` + enhancer cache together handle persistence for `'generate'` timing
- Refs (R1–R5) always go inline — no VisionScan descriptions stored for refs
- Scan failure is silent per image — failed image falls back to inline, pipeline continues

**Files Touched:**
- `logic/enhancer.js`
- `logic/vision.js`
- `logic/api.js`
- `docs/CafeHTML.md`

---

### 2026-04-05 — Reference Image Chips Component

**Status:** COMPLETED

**What Was Built:**
- `UploadedReferenceImages` — reference chip strip that appears above the prompt bar when images are uploaded via `PromptRefferenceButton`

**How It Works:**
- Clicking `#liveUpload` (the orange `+` button) triggers a hidden `<input type="file" accept="image/*">`
- Uploaded images are stored in `refState = { FRAME: [], SCENE: [] }` — separate arrays per mode
- Up to 5 images per mode; button gets `.disabled` class at the limit
- Each chip renders: a thumbnail (`<img>`), a colored overlay (`#ea5823` FRAME / `#5271ff` SCENE), a label (`R1`–`R5`), and an `×` remove button
- Remove button splices from `refState` and re-renders the row
- Chip strip (`#liveRefChips`) is hidden when empty, shown when refs exist

**Files Touched:**
- `Components/prompt-bar.html` — full component lives here (CSS + HTML + JS)

**Synced to main file:**
- [x] Confirmed synced — `liveRefChips`, `liveUpload`, `refState` all present in `CafeHTML-v2.html`

---

---

### 2026-05-02 — Simplification Pass: Strip Defensive Guards & refVisionCache

**Status:** COMPLETED

**What Was Done:**

Stripped all "public app" defensive code that was overcomplicating the system for personal single-user use.

**Removed — `window.refVisionCache` (entire layer):**
- `logic/enhancer.js` — removed refVisionCache read (`var desc = null` now) and write block after vision scan
- `logic/workspace.js` — removed `visionCache` from autosave, removed `window.refVisionCache = ...` on project load
- `CafeHTML-v2.html` — removed `window.refVisionCache = {}` init, removed two write calls in ref upload handler

**Removed — `if (window.X)` guards throughout:**
- `logic/workspace.js` — removed guards on Gallery, refState, renderChips, PromptBuilder, applyModuleState
- `logic/api.js` — removed entry guard for PromptBuilder/CafeSettings, removed CafeDebug ternary (debugEntry always created now), removed PromptEnhancer ternary, removed all 4× `if (debugEntry)` blocks, removed 2× Workspace autosave guards, removed 2× Gallery removeLoading guards, removed payload.settings double-guard
- `logic/prompt-builder.js` — removed settingsDropdown null guard, removed promptBar/promptText ternaries, removed refState double-guard
- `logic/settings.js` — removed `drop ?` ternary in getOutputType

**Also fixed:**
- `logic/vision.js` — cache key extended from 32 → 128 chars (all 3 cache functions)
- `CafeHTML-v2.html` — off-palette colors: `#c3c3c2` → `#c7c7c7` (4 places), `#666666` → `#999997`
- `CafeHTML-v2.html` — removed 12+ additional `if (window.X)` guards from chip remove, upload, projects panel, module actions, HUD, upscale handler

**Not changed:**
- SCENE mode structure (refState.SCENE, sequence store) — kept intact, SCENE not built yet
- Modal DOM null checks in settings.js init/renderModal/openModal/closeModal — kept, these are startup guards not window.X guards
- debug-logger.js — kept entirely

**Files Touched:**
- `logic/api.js`
- `logic/prompt-builder.js`
- `logic/settings.js`
- `logic/enhancer.js`
- `logic/workspace.js`
- `logic/vision.js`
- `CafeHTML-v2.html`

---

### 2026-05-06 — Docs Overhaul + Consolidation

**Status:** COMPLETED

**What Was Done:**

Full documentation audit and rewrite to match the current codebase. Docs were severely outdated (still referenced fal.ai, PRECISE/CREATIVE mode, old slot structure, CafeEntities registry).

**Logic changes:**
- `logic/api.js` — removed `REQUEST_LIMIT` and both generation limit guards. `_activeRequests` kept for button loading state only.

**Docs updated:**
- `ARCHITECTURE.md` — full rewrite: removed fal.ai, CafeEntities, PRECISE/CREATIVE; added T button, Refine overlay, debug-logger, correct noSlots structure for STAGE/STYLE, all 8 logic files, models table
- `CLAUDE.md` (now `CafeHTML.md`) — full rewrite matching current pipeline state
- `docs/Info/rulebook.md` — updated Style section, component registry, decisions log
- `docs/problem.md` — issues 1–11, 13, 15, 16, 19–23 marked FIXED or REMOVED. Open: 12, 17, 18

**Files converted from .md to .txt** (pure reference, not agent-facing):
- `GENERATE.md` → `GENERATE.txt`
- `IDEA.md` → `IDEA.txt`
- `v3-vision.md` → `v3-vision.txt`
- `Improvement.md` → `Improvement.txt`

**Folder removed:**
- `docs/superpowers/` — both files were implementation plans for work already done and evolved past

**Final consolidation:**
- `ARCHITECTURE.md` + `rulebook.md` merged into `CafeHTML.md` — single source of truth
- `ARCHITECTURE.md` and `rulebook.md` deleted

**Files Touched:**
- `logic/api.js`
- `docs/CafeHTML.md` (formerly CLAUDE.md)
- `docs/ARCHITECTURE.md` (deleted)
- `docs/rulebook.md` (deleted)
- `docs/problem.md`
- Multiple .md → .txt conversions

---

### 2026-04-13 — Wire Module Panel to Prompt Compiler

**Status:** COMPLETED

**What Was Built:**
- `window.ModuleState` global — live object tracking all SUBJECT, STAGE, STYLE slot states
- `syncModuleState()` inside `makeSection()` — fires after every state change (slot switch, on/off, layer edit, child save/delete)
- `syncStyle()` inside the STYLE IIFE — fires after every style state change
- `prompt-builder.js` rewritten — reads `window.ModuleState` instead of DOM scraping; parses each slot's HTML snapshot in a detached element to read all slots (not just active)
- `compilePrompt()` in `api.js` — assembles prompt text from active visible layers across SUBJECT + STAGE + STYLE, prepended with the user's freeform prompt

**Architecture:**
- `window.ModuleState = { subject: { selected, slots: [{on, html}] }, stage: {...}, style: { selected, slots: [{on, mode, linked, imgUrl, promptText}] } }`
- Subject/Stage: slot HTML snapshots parsed via `document.createElement('div')` — read `data-savedPrompt`, `.prompt-a/.img-a` classes, `.plr-eye.on` visibility
- Style: direct state object (no HTML snapshot needed)
- Compile order: SUBJECT layers → STAGE layers → STYLE (if linked and active)
- OFF slots excluded; invisible layers/children excluded

**Files Touched:**
- `CafeHTML/CafeHTML-v2.html` — makeSection signature, syncModuleState, syncStyle, ModuleState init
- `CafeHTML/logic/prompt-builder.js` — full rewrite of collectSection/collectStyle
- `CafeHTML/logic/api.js` — added compilePrompt(), wired into buildPayload and generate()

---

## Component Registry

| Component | File | Status |
|---|---|---|
| `PromptRefferenceButton` | `Components/prompt-bar.html` | Done |
| `UploadedReferenceImages` (ref chips) | `Components/prompt-bar.html` | Done |

---

### 2026-05-11 — Inline JS Extraction to logic/ Modules

**Status:** COMPLETED

**What Was Done:**

Extracted all ~2400 lines of inline JavaScript from `CafeHTML-v2.html` into 5 separate `logic/` modules. The primary motivation was reducing context window cost — reading the full HTML file for every edit was expensive and slow. Secondary benefit: each module is now independently editable.

**Files created:**

- **`logic/prompt-bar.js`** (~340 lines) — Prompt bar IIFE, reference chips, title bar tabs, cafe menu, projects panel IIFE, mod strip collapse. Exposes `window.refState`, `window.renderChips`, `window.ProjectsPanel`.
- **`logic/module-panel.js`** (~745 lines) — Full module panel IIFE: `makeComposeHTML`, `makeClrHTML`, `makeGroupHTML`, `makeSection`, `ModuleState`, `applyModuleState`, file upload handler. Exposes `window.ModuleState`, `window.applyModuleState`.
- **`logic/gallery.js`** (~670 lines) — Gallery + HUD IIFE: CELLS array, buildGrid, select mode, HUD viewer, info panel, threedot actions. Exposes `window.Gallery`, `window.getHudCell`, `window.closeHUD`.
- **`logic/sequence-bar.js`** (~60 lines) — Sequence bar IIFE: seqSlots, addSeqSlot, getSeqSlots, clearSeqSlots, HUD integration.
- **`logic/refine.js`** (~585 lines) — Full RefineArea IIFE with pencil, crop, history, ref chips, API call. Exposes `window.RefineArea`.

**Improvements applied during extraction:**

- `const`/`let` → `var` throughout all files (matching project convention)
- Arrow functions → regular functions (matching project convention)
- Template literals → string concatenation (matching project convention)
- Seed timer cleared on mode switch in prompt-bar.js (was: would keep running)
- RenderChips element reference reused in scan callback (was: queried twice)
- Gallery `cellIndexMap` (Map<id, index>) added for O(1) cell lookup (was: O(n) linear search)
- `buildGrid()` uses `DocumentFragment` for single reflow (was: append per cell)

**Load order:** All 5 new scripts load before the existing 8 logic/ scripts. All cross-module communication is through `window.*` globals resolved at click time, so no load-order dependencies exist between the 5 extracted files.

**`CafeHTML-v2.html` changes:**
- Lines 4238-6574 (inline `<script>` block) removed
- Replaced with 5 `<script src="logic/...">` tags at lines 4238-4242

**Files Touched:**
- `CafeHTML-v2.html`
- `logic/prompt-bar.js` (created)
- `logic/module-panel.js` (created)
- `logic/gallery.js` (created)
- `logic/sequence-bar.js` (created)
- `logic/refine.js` (created)
- `docs/CafeHTML.md`
- `docs/log.md`

---

### 2026-05-11 — CSS Extraction: Mode-Color Improvements

**Status:** COMPLETED

**What Was Done:**

CSS was previously extracted from `CafeHTML-v2.html` to `style.css` (3715 lines). This session applied consistency improvements for FRAME/SCENE mode-color switching.

**Fixes:**
- Removed orphaned CSS fragment (`color: #c7c7c7; }` without selector) — leftover from extraction
- Changed `.btn-frame` background from hardcoded `#ea5823` to `var(--accent)` — now switches correctly between FRAME (orange) and SCENE (blue) modes
- Changed `.btn-upload-ref` background from hardcoded `#ea5823` to `var(--accent)`
- Changed `.btn-settings` border from hardcoded `#ea5823` to `var(--accent)`
- Changed `.btn-upload-ref.disabled` border from hardcoded `#ea5823` to `var(--accent)`
- Removed 3 redundant `#promptBar[data-state="SCENE"]` override rules for `.btn-frame`, `.btn-upload-ref`, `.btn-settings` — now handled by `var(--accent)` propagation

**Pattern:** Prompt bar children use `var(--accent)` for mode-dependent colors. `--accent` is `#ea5823` in FRAME mode, `#5271ff` in SCENE mode. Explicit SCENE overrides only needed for elements that can't use the variable (e.g., the prompt switch which uses its own `data-state`).

**Files Touched:**
- `style.css`

---

### 2026-05-12 — On Load Pipeline Fix: DescriptionRegistry

**Status:** COMPLETED

**What Was Done:**

Built DescriptionRegistry to fix 6 bugs in the On Load generation pipeline. All image description storage centralized into a single URL→description map with in-flight dedup.

**Bugs fixed:**
1. Ref descriptions now reach enhancer (was: hardcoded `desc: null` in collectImageContext)
2. Module images now sent to Nano Banana (was: `position != null` filter excluded described images)
3. Upload save no longer races with async scan (_saveAndSync moved after scan resolves)
4. Scan failure now re-saves ModuleState (catch block calls _saveAndSync)
5. Ref descriptions now have a storage home (refState shape changed from `string[]` to `{url, desc}[]`)
6. Keep OFF now properly clears descriptions via Registry.clear()

**New module — `logic/registry.js`:**
- `DescriptionRegistry` — centralized URL→description map with in-flight dedup
- `get(url)`, `set(url, desc)`, `clear()`, `ensure(url, context)`, `ensureAll(items)`, `collectMissing()`
- `collectMissing()` scans live DOM (.clr elements) and refState for undescribed images
- `ensure()` routes to VisionScan.describe/describeStyle/describeRef based on context.type

**VisionScan stripped:**
- Removed `_cache`, `_inFlight`, `deduped()`, `clearCache()`, `window._visionCache`
- `describe()`, `describeStyle()`, `describeRef()` now call `callGemini()` directly

**refState shape change:**
- From `string[]` (URL strings) to `{url, desc}[]` objects
- Backward-compatible reads via `typeof ref === 'string'` fallback
- Updated in: prompt-bar.js, gallery.js, enhancer.js, prompt-builder.js, workspace.js

**Catch-up scan in api.js:**
- Before enhancer, `Registry.collectMissing()` finds undescribed images
- `Registry.ensureAll()` scans them
- Results written to DOM dataset + refState, then PromptBuilder re-collects

**Image dispatch fix in api.js:**
- Nano Banana now receives ALL images (not just positioned ones)
- Sort: positioned images first, described images appended at end

**Decisions:**
- Registry owns all caching — VisionScan is a pure API caller with no state
- ensureAll() catches individual failures (returns null) — pipeline continues
- Catch-up scan happens even in On Generate mode — catches images with no description regardless of scanTiming setting

**Files Touched:**
- `logic/registry.js` (created)
- `logic/vision.js`
- `logic/enhancer.js`
- `logic/prompt-builder.js`
- `logic/prompt-bar.js`
- `logic/module-panel.js`
- `logic/gallery.js`
- `logic/api.js`
- `logic/workspace.js`
- `CafeHTML-v2.html`
- `docs/CafeHTML.md`
- `docs/log.md`

---

### 2026-05-12 — On Generate Pipeline Fix

**Status:** COMPLETED

**What Was Done:**

Gated the catch-up scan in `api.js` on `scanTiming === 'load'`. On Generate now correctly skips individual VisionScan and sends all images inline to the enhancer for holistic analysis.

**Change:**
- `api.js` — catch-up scan condition changed from `if (window.DescriptionRegistry)` to `if (window.DescriptionRegistry && window.CafeSettings.getScanTiming() === 'load')`

**Behavior per mode:**
- **On Load** — catch-up scan runs, individual VisionScan per image, enhancer gets text descriptions
- **On Generate** — no scan, all images go inline to enhancer, enhancer's Gemini sees everything at once

**Files Touched:**
- `logic/api.js`
- `docs/log.md`

### 2026-05-13 — STAGE/STYLE Slot Arrays Removed

**Status:** COMPLETED

**What Was Done:**

STAGE and STYLE sections never had multi-slot UI (only SUBJECT has slot tabs). But ModuleState carried slot arrays (`{selected, slots: [{on, html}]}`) for all three sections. This dead weight propagated through 4 files.

**Changes:**

- **`logic/module-panel.js`** — `syncModuleState()` now writes flat `{ html }` for noSlots sections instead of `{selected, slots}`. `_loadFromState()` accepts both old `{selected, slots}` and new `{html}` shapes (backward compat). `_resetState()` resets html directly for noSlots.
- **`logic/prompt-builder.js`** — `collectSection()` detects flat `data.html` shape for STAGE/STYLE, parses layers directly. Extracted shared `parseLayersFromHTML()` helper from duplicate code.
- **`logic/api.js`** — `snapshotModuleState()` writes flat `{ html }` for STAGE/STYLE in gallery cell snapshots. `hasModuleImages()` unchanged (reads payload, not ModuleState).

**Backward compat:** `_loadFromState()` handles old saved projects and gallery cells — extracts html from `data.slots[0].html` when old shape detected. `PromptBuilder.collect()` output format unchanged — downstream (enhancer.js, workspace.js) unaffected.

**Files Touched:**
- `logic/module-panel.js`
- `logic/prompt-builder.js`
- `logic/api.js`
- `docs/log.md`

---

### 2026-05-18 — On Generate Cache Invalidation + Pipeline Diagnostics

**Status:** COMPLETED

**What Was Done:**

Fixed stale generation behavior where `PromptEnhancer` could reuse a cached final brief while module images were being sent inline. This caused the image-generation call to use an old creative prompt even after module images changed.

**Root Cause:**
- `Keep Descriptions` was also caching full enhancer outputs.
- In On Generate mode, module images without descriptions are sent inline and must be re-read by Gemini each run.
- The enhancer cache skipped that re-read (`PromptEnhancer cache hit`) and reused a stale brief.
- Module uploaded/generated images in the active inline HTML path did not always get UUIDs, weakening cache invalidation and debug visibility.

**Behavior Now:**
- `Keep Descriptions` remains a description cache.
- Enhancer output cache is allowed only when `inlineItems.length === 0`.
- If any module/ref image is sent inline, enhancer cache is disabled and Gemini re-reads image pixels.
- On Generate still skips individual VisionScan catch-up; missing descriptions go inline to the enhancer.

**Diagnostics Added:**
- `api.js` logs payload image fingerprints before enhancement.
- `api.js` logs payload image fingerprints after On Load catch-up.
- `api.js` logs generation manifest fingerprints before `googleGenerate()`.
- `enhancer.js` logs image fingerprints, cache policy, cache key when applicable, and explicit "cache disabled" messages for inline-image runs.
- Fingerprints include role/section/slot/position/uuid/description state/data URL length/head/tail snippets, not full base64.

**Files Touched:**
- `logic/api.js`
- `logic/enhancer.js`
- `CafeHTML-v2.html`
- `style.css`
- `docs/CafeHTML.md`
- `docs/log.md`

---

### 2026-05-19 — Architecture Foundations

**Status:** COMPLETED

**What Was Done:**

Laid all foundational architecture required by Studio. Eight independent tasks across 8 files.

**Task 1 — DB v2 migration (`storage.js`):**
- `DB_VERSION` bumped 1 → 2
- New stores: `images` (keyPath: `uuid`), `descriptions` (keyPath: `uuid`)
- `DB.images.get/put` and `DB.descriptions.get/put` added and exported

**Task 2 — UUID stamp on gallery cells (`api.js`, `gallery.js`):**
- `cell.uuid = crypto.randomUUID()` at cell creation in `generate()`
- `el.dataset.uuid = cell.uuid` stamped in `resolveLoading()` and `applyFilters()`
- `duplicateCell` gives copy a fresh UUID

**Task 3 — UUID stamp on module CLR (`module-panel.js`, `prompt-builder.js`):**
- UUID assigned and `DB.images.put()` called on file input and compose-generate image load
- `uuid` field threaded through `parseLayersFromHTML()` child items

**Task 4 — Shared `callGoogleAPI` (`api.js`, `refine.js`):**
- Extracted from `googleGenerate()` — handles fetch, 429 retry (5s/10s), safety settings, systemInstruction, thinkingLevel
- `googleGenerate()` is now a thin wrapper calling `callGoogleAPI`
- `callRefineAPI()` in `refine.js` updated to use `window.CafeAPI.callGoogleAPI`
- Exported: `window.CafeAPI.callGoogleAPI`

**Task 5 — Enhancer cache key fix (`enhancer.js`):**
- `cacheKey()` now uses `i.uuid` when available; falls back to `'data:' + length + ':' + head + tail` (no more identical 128-char prefix collisions)
- `collectImageContext()` reads `.dataset.uuid` from CLR node into image item

**Task 6 — Module snapshots preserve images (`api.js`, `workspace.js`):**
- `snapshotHTML()` replaces `src="data:..."` with `data-uuid="<uuid>"` (data URL already in `DB.images`)
- `snapshotModuleState()` uses `snapshotHTML()` for all sections
- `restoreHTML()` in workspace.js looks up `DB.images` by UUID and restores `img.src` async
- `restoreModuleState()` is now async — resolves all image lookups before calling `applyModuleState()`

**Task 7 — Description persistence (`registry.js`, `module-panel.js`):**
- `ensure()` checks `DB.descriptions` by UUID before calling VisionScan
- On new scan with `keepDescriptions` ON: writes to both `_store` and `DB.descriptions`
- `collectMissing()` passes `uuid` in context
- `module-panel.js` passes `uuid` when calling `ensure` on file load

**Task 8 — Module factory refactor (`module-panel.js`):**
- `makeSection(config)` accepts config object: `{ containerId, slotRowId, defaultLayerName, stateKey, stateTarget, noSlots, noEye, noLink }`
- `localGroupHTML()` inside `makeSection` respects `noEye`/`noLink` flags
- Eye and link event handlers guarded by `config.noEye` / `config.noLink`
- `window.ModuleState[sectionKey]` → `config.stateTarget[config.stateKey]` throughout
- `window.ModulePanel = { makeSection }` exported
- Three Canvas calls updated to config object form

**Files Touched:**
- `logic/storage.js`
- `logic/api.js`
- `logic/gallery.js`
- `logic/module-panel.js`
- `logic/prompt-builder.js`
- `logic/enhancer.js`
- `logic/workspace.js`
- `logic/registry.js`

---

### 2026-05-19 — Studio

**Status:** COMPLETED

**What Was Built:**

Full Studio workspace — fullscreen image refinement overlay with history, draw/crop tools, and a purpose-built reference module panel. Replaces the old Refine Area as the primary refinement workflow.

**`logic/studio.js` — main Studio logic:**
- `window.Studio.open(config)` — entry point. `config`: `{ imgUrl, uuid, ratio, caller, onDone }`
- History strip: session-level thumbnails (newest on top). Persists across open/close for same `uuid`
- Pencil tool: freehand stroke drawing on canvas draw layer, undo/redo stack, color (orange/gray/green) and size (3/8/16px) options
- Crop tool: aspect-ratio presets (16:9, 9:16, 1:1, free), draggable + resizable crop box, client-side crop via offscreen canvas
- `callStudioAPI()` — assembles parts (canvas image, annotation layer if strokes present, studio module images), calls `window.CafeAPI.callGoogleAPI`, appends "Focus on the annotated area." when strokes present
- `close()` — saves history to `_session`, calls `onDone(_latestUrl)`

**`logic/studio-module.js` — reference panel:**
- Flat module (no slots, no eye, no link) via `window.ModulePanel.makeSection` factory
- File input `#sm-file-input` for image uploads with UUID stamp + `DB.images.put`
- `collectImages()` — returns all visible CLR image URLs for API call
- `reset()` — clears state on new-image open

**`CafeHTML-v2.html` — HTML + CSS + entry points:**
- `#studio-overlay` HTML: history column (left), canvas + toolbar + prompt (center), module panel (right)
- Studio CSS: overlay, history thumbs, tool submenu, pencil/crop/size/color controls
- Gallery entry: `hud-edit` click → `Studio.open({ caller: 'gallery', onDone: addGenerated + autosave })`
- Module entry: `.clr-edit.a` click → `Studio.open({ caller: 'module', onDone: update img.src + new UUID + clear visionDesc })`
- `<script>` tags added: `studio-module.js` loads before `studio.js`

**Decisions:**
- History is session-only (no DB backing) per spec — rebuilt fresh per open
- Same-UUID re-open restores prior history silently
- Crop apply produces a `createObjectURL` blob — not a data URL (not stored in DB.images)
- Studio module state is not saved to IndexedDB — starts fresh every open

**Files Touched:**
- `logic/studio.js` (created)
- `logic/studio-module.js` (created)
- `CafeHTML-v2.html`
- `docs/log.md`

---

### 2026-05-20 — Studio Module: Ref Card + X Toggle + Scrollbar Fix

**Status:** COMPLETED

**What Was Done:**

Built out the Studio module panel's add-reference UX and fixed a persistent layout shift bug.

**Add-reference card redesign (`logic/studio-module.js`, `CafeHTML-v2.html`):**
- File picker opens immediately on `+` click — image loads first, then user names and confirms
- Layout: `[X][NAME...][ADD]` bar at top, image below (single `sm-ref-card-bar` row)
- X button uses `icon-x-active.svg` (matches `.plr-x` style)
- NAME field: `display: block; line-height: 25px` — prevents caret appearing outside field on first click
- `sm-ref-card` width changed from `250px` to `100%` — aligns ref card edges with existing layer group containers

**X-button visibility toggle (`syncAllGroupX`):**
- 1 image in group → show `.plr-x`, hide all `.clr-x`
- 2+ images → hide `.plr-x` (content shifts left, intentional), show `.clr-x` (position:absolute, no layout effect)
- Driven by `MutationObserver` on `#sm-layers` (childList + subtree)

**Focus border removed:**
- Removed `[contenteditable="true"]:focus-visible` from global rule in `style.css` — was drawing an orange outline outside the NAME field

**Layout shift fix (`CafeHTML-v2.html` inline style):**
- Root cause: vertical scrollbar on `.studio-module-scroll` was stealing ~17px of width when content expanded. This forced the 250px fixed-width panel elements to overflow horizontally, triggering a second (horizontal) scrollbar and shifting content left.
- Fix: `scrollbar-width: none; -ms-overflow-style: none;` + `::-webkit-scrollbar { display: none; }` on `.studio-module-scroll`. Also added `overflow-x: hidden`. Scroll still works, bars are invisible.

**Collapsed state design (`style.css`, `CafeHTML-v2.html`):**
- Expanded: `.clr` shows as 250×250px image square with absolute-positioned X overlay
- Collapsed: `.clr` collapses to 25px-tall full-width row showing thumbnail
- `.plr` and `.plr-name` set to `width: 100%` / `flex: 1` in studio context — fills full panel width (canvas module had link+eye buttons filling the gap; studio has neither)
- Collapsed rows: `.layer-children` switched to `display: block` when collapsed — block children naturally fill 100% width without flexbox alignment interference. Flex column + `align-items: center` was preventing `width: 100%` from resolving correctly on child rows.
- `.add-child-row` and `.clr-x` hidden when collapsed

**Files Touched:**
- `logic/studio-module.js`
- `CafeHTML-v2.html` (inline `<style>` + HTML structure)
- `style.css` (focus rule removed, collapsed state added)

---

### 2026-05-20 — Inline Block Migration + Git Housekeeping

**Status:** COMPLETED

**What Was Done:**

Completed the transition from inline `<script>` block to modular `logic/` files. The 2375-line inline block that ran all app logic had been disabled (set to `type="text/plain"`) by a prior session but not deleted or committed. Verified all globals were covered by modules, then cleaned up.

**Changes:**
- `CafeHTML-v2.html` — inline block removed entirely (was disabled, now deleted). `logic/registry.js`, `prompt-bar.js`, `module-panel.js`, `gallery.js`, `sequence-bar.js`, `refine.js` now in script tags. `style.css` linked in `<head>` (was never loaded despite being extracted).
- `logic/prompt-bar.js`, `logic/sequence-bar.js`, `style.css` — added to git (were untracked despite being loaded by the page)
- `logic/api.js` — `summarizePayloadImages()` diagnostic helper; fingerprint logs before enhancement, after catch-up scan, before generation
- `logic/enhancer.js` — improved cache key (samples head+tail, not just length); cache disabled when any inline images present; `imageFingerprint()` helper; diagnostic logs
- `logic/vision.js` — removed `_cache`/`_inFlight`/`deduped()` (caching now owned by `registry.js`); `callGemini()` restructured with retry in `runOne(attempt)`

**Bug fixed:**
- `DescriptionRegistry.clear()` was unguarded in `api.js:488` — threw TypeError after every generation when Keep Descriptions was OFF. Fixed by loading `registry.js`.

**Decisions:**
- Inline block preserved in git history (`git show HEAD~3:CafeHTML-v2.html`) — no need to keep it in the file
- `style.css` link added — CSS consistency improvements from 2026-05-11 (var(--accent) fixes) were never applied to the running app

**Files Touched:**
- `CafeHTML-v2.html`
- `logic/api.js`
- `logic/enhancer.js`
- `logic/vision.js`
- `logic/prompt-bar.js` (tracked)
- `logic/sequence-bar.js` (tracked)
- `style.css` (tracked)
- `docs/log.md`

---

### 2026-05-25 — UUID Image Storage Refactor

**Status:** COMPLETED

**What Was Done:**

Full refactor replacing inline base64 image storage with a UUID-keyed `DB.images` store. All other stores (moduleState, references, gallery) now hold UUID pointers instead of raw base64. Live in-memory state keeps resolved base64 for rendering; serialization to UUID happens at save-time only.

**`logic/storage.js`:**
- `DB.images.put()` now takes `projectId` as 3rd arg — records include `projectId` and `createdAt`
- `DB.images.delete(uuid)` and `DB.images.deleteByProject(projectId)` added
- `DB.descriptions.deleteByProject(projectId)` added
- New `studio-state` object store added (keyPath: `project_id`) for studio session persistence
- DB version now detected dynamically (open-then-check-then-upgrade) instead of hardcoded `DB_VERSION`
- Project delete cascade now includes `DB.images.deleteByProject` and `DB.descriptions.deleteByProject`
- `DB.images.runOrphanCleanup()` — deletes records with no `projectId` (pre-refactor orphans); called once on init

**`logic/workspace.js`:**
- `serializeHTML(html)` — strips base64 `src` from `.clr[data-uuid] img` elements, replacing with `data-uuid` attribute on the img. Works on a DOM copy; does not mutate live DOM
- `serializeModuleState(ms)` — runs `serializeHTML` over all HTML strings in ModuleState before DB write
- `autosave()` calls `serializeModuleState(window.ModuleState)` before saving to `DB.moduleState`
- References autosave: stores `{ uuid, src: null }` for UUID-backed refs; legacy `{ src }` for string refs
- References restore: resolves UUID refs from `DB.images` before populating `refState`; `renderChips()` moved inside the Promise chain
- Gallery restore: resolves UUID `imgUrl` from `DB.images` before calling `Gallery.addGenerated()`; stores `_imgUuid` on cell for later cleanup
- `saveGalleryCell()`: stores image in `DB.images` first, then saves UUID pointer as `imgUrl` in `DB.gallery`
- `resolveModuleStateForExport()`, `resolveRefsForExport()`, `resolveGalleryForExport()` — resolve UUIDs back to base64 for self-contained `.cafe` export
- `_doExport()` rewritten to await all three resolvers before building snapshot
- `runOrphanCleanup()` called once in `DOMContentLoaded` chain after DB ready

**`logic/module-panel.js`:**
- All `DB.images.put()` calls updated to pass `window.activeProjectId`
- Old UUID deleted from `DB.images` before overwriting on: file load, generate, refine result, clr-x remove

**`logic/studio-module.js`:**
- Full rework: `makeRefGroupHTML()`, `insertImageClr()`, `buildAndInsertRefCard()` helpers
- `+` header button → file picker → `buildAndInsertRefCard()` → user names → ADD → `makeRefGroupHTML()` committed as layer group
- Add-child rows on existing groups via capture-phase listener
- `syncAllGroupX()` — MutationObserver driven: 1 image → show `.plr-x`, hide `.clr-x`; 2+ → vice versa
- All `DB.images.put()` calls pass `window.activeProjectId`
- `reset()` collects all UUIDs from `#sm-layers` and deletes from `DB.images` before clearing

**`logic/gallery.js`:**
- `deleteCell()` and multi-delete now delete `_imgUuid` from `DB.images` and the `DB.gallery` record
- `duplicateCell()` resets `_imgUuid: null` and `_dbId: null` on copy
- "Drop Ref" (hud-drop-ref) stores gallery image in `DB.images` with a new UUID before pushing to `refState`

**`logic/prompt-bar.js`:**
- Ref upload stores image in `DB.images`, pushes `{ url, desc, uuid }` to `refState`
- Ref chip remove deletes UUID from `DB.images` before splicing from `refState`
- Projects panel: single-click to load (was double-click)
- Delete active project: auto-loads next most-recently-modified project (or creates new one if none)
- New project modal: closes on create

**`CafeHTML-v2.html`:**
- Remaining inline `<style>` block (~3950 lines) migrated to `style.css`
- `sm-header-add` button added to studio module header (`+` to add new reference group)

**`style.css`:**
- Studio overlay styles absorbed from CafeHTML-v2.html inline block
- New studio module panel styles: `sm-ref-card`, `sm-header-add`, `add-child-row`, collapsed state

**Files Touched:**
- `logic/storage.js`
- `logic/workspace.js`
- `logic/module-panel.js`
- `logic/studio-module.js`
- `logic/studio.js`
- `logic/gallery.js`
- `logic/prompt-bar.js`
- `CafeHTML-v2.html`
- `style.css`

---

### 2026-05-26 — Studio Module: Rename Prompt on LOAD + DB Fix

**Status:** COMPLETED

**What Was Done:**

After loading an image via the default LOAD slot in the studio module panel, the `.plr-name` label stayed "REFERENCE" with no visual cue that it was editable — unlike the `+` header flow which shows a named ref card before committing.

**Fix:**
- After `activeClrMain` fills, immediately set `.plr-name` to `contentEditable`, focus it, and select all text so "REFERENCE" is overwritten on first keystroke
- Enter key commits (calls `blur()`); blur handler trims, uppercases, and defaults to "REFERENCE" if empty
- `_saveAndSync` called inside the blur handler so the new name persists to DB
- Keydown listener is named (`onNameKey`) and removed on blur — no listener leak
- `style.css` — `.studio-module-panel .plr-name:focus` gets `border-bottom: 1px solid #c7c7c7` as a focus indicator (orange border suppressed in studio context by module-panel.js)

**Files Touched:**
- `logic/studio-module.js`
- `style.css`

---

### 2026-05-26 — Studio Persistence + Project Modal Fixes

**Status:** COMPLETED

**What Was Done:**

Studio state was made image-specific and the Projects modal was cleaned up so UI actions match IndexedDB behavior.

**Studio history + active image:**
- `logic/studio.js` now stores Studio sessions per source image UUID in `DB.studioState.histories[uuid]`
- Each saved Studio session contains `history`, `activeUrl`, and isolated Studio reference `layers`
- Clicking a history thumbnail updates `activeUrl`; closing Studio returns the selected active image, not always the newest/top thumbnail
- Opening Studio restores the selected active history image for that source UUID
- Opening Studio no longer immediately overwrites saved history with only the base image

**Gallery + Module Studio return behavior:**
- Gallery Studio now replaces the original Gallery image in place with the active Studio image
- Module Studio keeps the same module image UUID when refined so history remains attached to that module image
- Automatic "add Studio output to Gallery" was removed for consistency; future behavior should be an explicit "Save to Gallery" action

**Studio references isolated:**
- Studio reference panel state is now saved per source image UUID
- References loaded in one Studio image no longer appear when Studio is opened for another image
- Old global `studioLayers` workspace save/load path disabled to prevent cross-image reference leakage

**Projects modal fixes:**
- `New` creates `Project N` directly instead of using `window.prompt`
- Delete button is visible by default
- Deleting the final project clears the workspace and leaves the project list empty instead of recreating a replacement project
- Project delete cascade now deletes core project stores first, then image/description cleanup

**UI polish:**
- Studio Back button default color changed to the shared light gray token `#c7c7c7`

**Files Touched:**
- `logic/studio.js`
- `logic/studio-module.js`
- `logic/gallery.js`
- `logic/module-panel.js`
- `logic/prompt-bar.js`
- `logic/workspace.js`
- `logic/storage.js`
- `style.css`
- `docs/log.md`
- `docs/CafeHTML.md`

---

### 2026-05-26 — Studio Module: ACTION System + Visual Polish

**Status:** COMPLETED

**What Was Done:**

Rebuilt the Studio reference panel from scratch — dropped `ModulePanel.makeSection` entirely and replaced it with a purpose-built render/serialize cycle. Added an ACTION system so each reference group carries intent metadata sent to the API.

**`logic/studio-module.js` — full rework:**
- Dropped `ModulePanel.makeSection` dependency. Studio module now owns its own `render()`, `serialize()`, `resolveMissingImages()`, and `loadForSource()` — no hidden slots, text rows, eye, or link behavior
- ACTION system: each group has one of `INSERT | SWAP | TRANSFER | REMOVE | PRESERVE` (default: `TRANSFER`)
- Header `+` button opens an action-type menu — user picks action first, then file picker opens
- Per-group action drawer (click action button) — toggle open/close, updates `data-action` and button label
- Per-group name editor drawer (click name label) — inline `<input>`, Enter/Escape/blur to commit
- `MAX_IMAGES_PER_GROUP = 3` — add-child-row disables when limit reached
- `parseLegacyLayers()` — reads old HTML-snapshot format and converts to new `{ groups }` shape for backward compat
- `autosave()` — serializes to `StudioModuleState.layers` and debounces workspace autosave
- API prompt updated: each reference now sends `action` + `intent` fields instead of bare name

**Bug fixes:**
- Action button showed active state when name editor opened — fixed by using `action-drawer-open` class only for action drawer; name editor uses `drawer-open`
- Name editor didn't close action drawer on same group — added explicit close before opening name editor

**`logic/studio.js`:**
- Removed empty history placeholder divs — they appeared as broken entries when no history existed

**`style.css` — Studio module visual polish:**
- Group X button: `icon-x-inactive.svg` (grey), no background
- Action button: grey bg / orange text default; orange bg / grey text when `action-drawer-open`
- Action drawer options: grey bg / grey text; orange bg / grey text on hover; orange bg / grey text when active
- Name editor drawer: grey bg (`#999997`), light grey text (`#c7c7c7`)
- Name label active (drawer open): orange bg, light grey text
- Image border: `border-color: #c7c7c7` overrides global blue border in studio context
- Per-image delete button: replaced top-left X with bottom-right trash icon (`icon-trash.svg`, 22×22px)

**`assets/icon-trash.svg` — new asset:**
- Minimalist trash can with handle, lid, body, and 3 vertical line details
- Uses `#c7c7c7` fill for visibility on grey background

**`CafeHTML-v2.html`:**
- `#sm-layers` starts empty — JS renders groups from `StudioModuleState.layers` on `init()`
- Removed static default layer-group HTML

**Files Touched:**
- `logic/studio-module.js`
- `logic/studio.js`
- `style.css`
- `CafeHTML-v2.html`
- `assets/icon-trash.svg` (created)
- `docs/log.md`
- `docs/CafeHTML.md`

---

### 2026-05-27 — Code Review Pass: Bug Fixes, Dead-Code Removal, Seed Removal

**What Was Done:**

A read-through review of the whole `logic/` layer, then a series of fixes and cleanups. No new features — correctness, robustness, and weight reduction.

**Bug fixes:**
- `module-panel.js` — layer-name editing: the `keydown` listener removed itself on the *first* keystroke, so Enter/Escape only committed if pressed as the very first key. Moved cleanup into the blur `commit()` handler so both listeners are removed together.
- `gallery.js` — HUD navigation ignored active filters: it indexed the full `CELLS` array while the grid showed a filtered subset. Added a `visibleCells` array (the displayed/filtered/sorted list); HUD open/nav/counter/info now use it. Data ops (delete) still use `CELLS`.
- `api.js` — Generate button could stay stuck spinning: it gated on the shared `_activeRequests` counter, which `generateLayerImage` also mutates. Added a dedicated `_activeGenerations` counter for the button.
- `prompt-bar.js` — project names were injected into the projects modal via `innerHTML` unescaped. Added an `escapeHTML` helper.
- `gallery.js` — duplicated cells used `id: Date.now()` (collides within one ms on multi-select duplicate). Now `Date.now() + Math.random()` like generated cells.

**Data-loss fix:**
- `workspace.js` — images uploaded as the *first action* on a fresh DB were written with `project_id: null` (no project existed yet) and then deleted by `runOrphanCleanup` on reload. Init now creates a project up front when none exist, so `activeProjectId` is always set before any upload.

**Dead-code removal:**
- Deleted `logic/refine.js` (`RefineArea`, ~577 lines), its `<script>` tag, and the orphaned `#refine-overlay` markup. Superseded by Studio; nothing invoked it. Shared `.refine-*` CSS classes kept (Studio reuses them).

**Performance / dedup:**
- `gallery.js` — incremental DOM updates. Generation, duplicate, delete (single + multi), and project-load now insert/remove a single cell instead of rebuilding the whole grid each time. Filter/sort changes and `clearGenerated` still full-rebuild. Extracted `createCellElement` / `cellMatchesFilter` / `currentSort`; dropped `cellIndexMap`/`rebuildIndexMap`.
- `logic/net.js` (new) — `CafeNet.fetchJSON(url, options, { label, maxRetries, timeoutMs })`. The duplicated fetch + 429 retry/backoff in `api.js`, `enhancer.js`, `vision.js` now route through it (vision uses `timeoutMs` for its AbortController path).

**Tidy-ups:**
- Proper transitive descending sort comparators for the project list (`workspace.js`, `prompt-bar.js`).
- `settings.js` — `setActiveModel` no longer stores `null` resolution; falls back to first resolution or `'1K'`.
- `enhancer.js` — bounded the enhancer cache to 50 entries (FIFO).

**Seed removal:**
- Confirmed via docs that the Gemini image models (`gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview`) do **not** support a `seed` parameter — it's documented only for Imagen, and was silently ignored. Removed all seed plumbing: `generationConfig.seed`, the seed-lock UI (`seedLock`/`seedNum`/`seedNotice`), `data-seed` state, related JS in `api.js`/`prompt-builder.js`/`workspace.js`/`prompt-bar.js`, the HTML block, and the dead CSS. Old projects with stored `seed`/`seedLocked` fields just ignore them on load.

**Docs / housekeeping:**
- README: documented the Studio module split and fixed em-dash encoding corruption.
- Untracked `Components/` (HTML reference snapshots) via `.gitignore`.
- Updated `docs/CafeHTML.md` (removed Refine sections, added CafeNet/seed/gallery/init decisions).

**Files Touched:**
- `logic/api.js`, `logic/enhancer.js`, `logic/vision.js`, `logic/gallery.js`, `logic/module-panel.js`, `logic/prompt-bar.js`, `logic/prompt-builder.js`, `logic/workspace.js`, `logic/settings.js`
- `logic/net.js` (created), `logic/refine.js` (deleted)
- `CafeHTML-v2.html`, `style.css`, `README.md`, `.gitignore`
- `docs/log.md`, `docs/CafeHTML.md`

**Known follow-ups (not done):**
- Generation-failure UX (no user-facing error when a generation fails).
- `runSequential` discards the whole batch if one variation fails (no partial results).
- Variations run sequentially; the enhancer always runs even for plain prompts (latency).
- Part 1: lazy image loading / thumbnails to cut gallery memory (needs a spec).

---

### 2026-05-27 — Generation Pipeline: Parallel + Partial Success + NB2 Thinking

**What Was Done:**

Pipeline work following a docs check of the Gemini image models (`ai.google.dev/gemini-api/docs/image-generation`). Confirmed there's no single-request multi-image param and no `seed` support for these models.

**Parallel generation (`api.js`):**
- `googleGenerate` fires the N variation calls concurrently instead of sequentially. Each variation is still a separate `callGoogleAPI` (no batch param exists), but they no longer wait on each other — a 4-image batch finishes in roughly one call's time. Re-applies the 2026-05-21 intent after the code had drifted back to sequential.

**Partial-success (`api.js`):**
- Switched from `Promise.all` to `Promise.allSettled`. A failed variation (network / 429-after-retries / safety block) is dropped instead of discarding the whole batch. Only throws when zero images come back, surfacing the first real error if every call failed.

**NB2 thinking-level option (`settings.js`, `api.js`, `CafeHTML-v2.html`):**
- Added a "Thinking" control on the settings API page, shown only for models with selectable levels (NANO BANANA 2: `minimal` / `high`, default `minimal`). Renders like the Resolution list; reuses `.csm-resolution-row` styling, no new CSS.
- `api.js` reads `CafeSettings.getActiveThinkingLevel()` instead of the hardcoded model value. NB and Pro return null (thinkingConfig omitted). Value lowercased (`minimal`) to match the docs.
- Cost-vs-thinking display was considered and skipped — thinking tokens vary per prompt; no flat per-image figure to show.

**Files Touched:**
- `logic/api.js`, `logic/settings.js`, `CafeHTML-v2.html`
- `docs/log.md`, `docs/CafeHTML.md`

---

### 2026-05-28 — CafeHTML Module Panel S-C Redesign

**What Was Done:**

Implemented the new CafeHTML Module Panel design from the S-C handoff as a vanilla JS panel in `logic/module-panel.js` with matching CSS in `style.css`.

**Module model / UI:**
- Replaced the visible legacy SUBJECT/STAGE/STYLE layer editor with a flat image-reference manager: root-level loose images, locked system modules (`SUBJECT`, `STAGE`, `STYLE`), custom modules, folder accordions, image rows, image inspector, sort/select toolbar, upload form, and status bar.
- Added per-image fields: `label`, `folder`, `linked`, `eye`, `strength`, `mode`, `name`, `size`, `dims`, `modified`, `uuid`, `url`, and `visionDesc`.
- Added custom module creation/edit UI with shared create/settings layout, accent swatches, locked system folder handling, and delete for custom modules only.
- Added root-level loose image styling and `LOOSE` marker for unassigned uploads.
- Polished image-row `...` menus and move-to picker. Row menu now contains `STUDIO`, `RENAME`, `MOVE TO...`, `DUPLICATE`, and `REMOVE`.
- Added Image Inspector `...` menu in the navbar with `STUDIO`, `REPLACE`, `RENAME`, and `REMOVE`; removed the lower inspector ACTIONS block.
- Image Inspector remains focused on mode, strength, linked/visible state, label, info panel, and selected-image actions.

**Generation compatibility:**
- Preserved the existing generation bridge by syncing the new `cafeModule` state back into compatible legacy `window.ModuleState.subject/stage/style` HTML snapshots.
- Only linked + visible files are included in generated legacy snapshots.
- Custom-folder files route into generation by reference mode:
  - `SUBJECT` → subject
  - `COMP` / `ALL` → stage
  - `STYLE` / `ALL` → style
- Hidden or unlinked files remain visible/manageable in the panel but do not enter the generation payload.

**Persistence:**
- `workspace.js` now serializes/restores `ModuleState.cafeModule` alongside legacy `subject/stage/style`.
- Module image data uses UUID-backed `DB.images`; saved `cafeModule.files` store UUID pointers and restore data URLs on load/export.
- Legacy saved module HTML can be imported into the new flat file list as a fallback when `cafeModule` is absent.

**Studio integration:**
- Studio entry moved into image action menus instead of separate row buttons to avoid clutter.
- `STUDIO` opens `window.Studio.open(...)` for the selected module image and writes the returned image back into the same module record.

**Files Touched:**
- `logic/module-panel.js`
- `logic/workspace.js`
- `style.css`
- `docs/log.md`
- `docs/CafeHTML.md`

**Known follow-ups:**
- Browser/manual QA pass for upload, replace, Studio return, project reload, export/import, drag-to-module, and select-mode bulk actions.
- Consider moving common dropdown styling into a documented mini component pattern if more panel menus are added.

---

## Design Tokens (Quick Reference)

| Token | Hex | Role |
|---|---|---|
| Orange | `#ea5823` | Primary CTA, active states |
| Blue | `#5271ff` | Secondary, inactive |
| Gray mid | `#999997` | Neutral/inactive bg |
| Gray light | `#c7c7c7` | Text, borders |
| Font | Times New Roman | All labels |

---

### 2026-05-30 - Remove Global References + Module Quick Upload Shortcut

**Status:** COMPLETED

**What Was Done:**

**Global reference flow removed from active pipeline:**
- Removed prompt-bar global reference chip UI and hidden ref file input from `CafeHTML-v2.html`.
- Removed global "Set as Reference" actions from gallery/HUD menus.
- `PromptBuilder.collect()` no longer reads prompt-bar global references.
- `Composition.build()` no longer creates `R1-R5` global-ref entries.
- `PromptEnhancer` `R1-R5` handling removed from brief construction/director plan.
- `Workspace` no longer saves/loads/exports/imports global refs via `DB.references`.
- `DescriptionRegistry.collectMissing()` now scans module images only.

**Module quick upload UX added back:**
- Re-added prompt-bar plus button as a module shortcut (`#moduleQuickUpload`).
- Added `ModulePanel.openUpload()` API to open existing module upload form from anywhere.
- `prompt-bar.js` now routes the plus button to `window.ModulePanel.openUpload()`.
- Upload ownership remains in `module-panel.js`; no separate global ref lane reintroduced.

**Safety + compatibility notes:**
- Kept empty shim: `window.refState = { FRAME: [], SCENE: [] }` and no-op `window.renderChips()` to avoid crashing old callers during transition.
- Added `logic/composition.js` script include in `CafeHTML-v2.html` so enhancer normalization resolves correctly.

**Files Touched:**
- `CafeHTML-v2.html`
- `logic/api.js`
- `logic/composition.js`
- `logic/enhancer.js`
- `logic/gallery.js`
- `logic/module-panel.js`
- `logic/prompt-bar.js`
- `logic/prompt-builder.js`
- `logic/registry.js`
- `logic/workspace.js`

---

### 2026-05-30 - Base Module State Reference Layer

**Status:** COMPLETED

**What Was Done:**

**Module/reference semantics tightened:**
- Kept the base modules as `SUBJECT`, `STAGE`, and `STYLE`.
- Defined loose module-panel uploads (`folder: null`) as the new neutral Reference layer instead of leaving them outside generation.
- `PromptBuilder.collect()` now returns loose visible images in `refs` with `{ role, imgUrl, uuid, visionDesc, strength }`.
- `Composition.build()` converts those refs into manifest entries with `source: "reference"` and `section: "reference"`.
- `PromptEnhancer` now knows Reference-layer images are supporting context only and should not override Subject, Stage, or Style.

**Image names now matter in generation:**
- Assigned image labels become module layer roles.
- Loose image labels become Reference-layer roles.
- This gives the user's image name a prompt meaning without adding new UI.

**Description flow fixed for loose references:**
- `DescriptionRegistry.collectMissing()` now scans loose Reference-layer files in `ModulePanel` state.
- Catch-up scan writes loose-reference descriptions back through `ModulePanel.setVisionDesc()`.
- `ModulePanel.clearVisionDescriptions()` clears cached descriptions for both module and loose files when Keep Descriptions is off.

**Files Touched:**
- `logic/api.js`
- `logic/composition.js`
- `logic/enhancer.js`
- `logic/module-panel.js`
- `logic/prompt-builder.js`
- `logic/registry.js`
- `docs/CafeHTML.md`
- `docs/log.md`

---

### 2026-05-30 - Optional Preset Modules

**Status:** COMPLETED

**What Was Done:**

**Permanent modules removed:**
- Fresh module state now starts with no active folders.
- `SUBJECT`, `STAGE`, and `STYLE` are preset module choices, not permanent defaults.
- `+ NEW MODULE` uses the existing module form to choose from inactive presets only.
- The `+ NEW MODULE` button hides once all three presets are active.

**Module action dropdown added:**
- Module header `...` now opens a small dropdown with `EDIT` and `DELETE`.
- `EDIT` opens the existing module settings form.
- `DELETE` removes the module and returns its images to loose Reference layer instead of deleting them.

**Preset-backed add/edit form:**
- The old add/rename form now acts as a preset selector plus accent/color editor.
- No custom module names are accepted in this iteration.
- Editing an active module can swap it to another inactive preset while keeping its images.
- If all presets are active, the module name field is locked to the current module but accent swatches still work.
- Swapping modules updates the contained images' module mode (`SUBJECT`, `COMP`, or `STYLE`) so generation routing stays aligned.

**Compatibility:**
- Existing saved folders are normalized to valid presets on load.
- Unknown/custom saved folder IDs are converted back to loose references.
- Legacy module-state imports recreate only the preset modules that actually contain images.

**Files Touched:**
- `logic/module-panel.js`
- `style.css`
- `docs/CafeHTML.md`
- `docs/log.md`

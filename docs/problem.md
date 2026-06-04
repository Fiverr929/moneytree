# Problem Log

---

## 2026-04-18 — Vision and Prompt (Compiler)

1. ~~**Vision output truncated**~~ — **FIXED.** `maxOutputTokens` raised to 1024. `PROSE` suffix added to all prompts. Thinking budget disabled.

2. ~~**STYLE module not scanned**~~ — **FIXED.** `VisionScan.describeStyle()` called on STYLE image upload. Same layer structure as SUBJECT/STAGE.

3. ~~**Slots not separated in enhancer**~~ — **FIXED.** Manifest entries carry slot labels. Enhancer knows slots are independent sets.

4. ~~**Vision scan has no goal context**~~ — **FIXED.** All prompts are extraction-focused and role-specific.

5. ~~**Custom layer names get no context**~~ — **FIXED.** Generic fallback in `vision.js` uses layer name as context.

6. ~~**Enhancer has no system knowledge**~~ — **FIXED.** `SYSTEM_INSTRUCTION` in `enhancer.js` fully describes CafeHTML's structure to the model.

7. ~~**Enhancer doesn't know the generation model**~~ — **FIXED.** System instruction references nano-banana and positional image references.

8. ~~**Vision data sent twice to enhancer**~~ — **FIXED.** Manifest is the single source. Compiled string removed.

9. ~~**fal.ai path ignores enhanced prompt**~~ — **REMOVED.** fal.ai removed from codebase entirely.

10. ~~**compilePrompt() and enhancer competing**~~ — **FIXED.** `compilePrompt()` removed. Enhancer is the only prompt system.

11. ~~**Enhancer never sees actual images**~~ — **FIXED.** Enhancer sends all images inline to Gemini 2.5 Flash, which analyzes them directly.

12. **No feedback loop** — OPEN. No rating, no iteration, no memory of which prompts produced good results. See `IDEA.md` #2.

13. ~~**Structured module hierarchy destroyed before AI**~~ — **FIXED.** Manifest carries slot/layer/section hierarchy. AI sees the full structure.

15. ~~**No way to reload a frame's module state**~~ — **FIXED.** `info-popup-yes` loads `cell.moduleSnapshot` via `Workspace.applyModuleState()`.

16. ~~**Favourites not persisted**~~ — **REMOVED.** Favourites feature removed.

17. **Vision scan has no UI feedback** — PARTIAL. `scanning` class added to `.clr-main` during scan. No failure indicator yet.

18. **Prompt bar and module state can silently contradict** — OPEN. Conflict detection not built. See `IDEA.md` #4 (Witty Director).

19. ~~**Gallery cell doesn't record which images were used**~~ — **FIXED.** `usedImages` stored per cell, rendered in info panel.

20. ~~**PRECISE and CREATIVE are too shallow**~~ — **REMOVED.** PRECISE/CREATIVE mode removed entirely from the app.

21. ~~**No vision scan cache**~~ — **FIXED.** `_cache` and `_inFlight` dedup in `vision.js`. Session-persistent, keyed by image content + layer context.

22. ~~**Global Reference images have no vision scan**~~ — **FIXED.** `VisionScan.describeRef()` called on ref chip upload.

23. ~~**Enhancer's user intent input is the wrong data**~~ — **FIXED.** `payload.prompt` (raw user text) passed directly to enhancer.

---

## 2026-04-20 — Image Manifest Architecture

Resolved issues 3, 8, 11, 13 by building the manifest-first pipeline. Full details in git history.

---

## Open Issues

| # | Issue | Notes |
|---|---|---|
| 12 | No feedback loop | Needs rating UI on gallery cells + generation history log |
| 17 | No vision scan failure indicator | `scanning` class exists, failure state not shown |
| 18 | Prompt/module conflict detection | Witty Director agent — future feature |
| V1 | Sequence bar loses all context for video | Deferred to Video tab build |

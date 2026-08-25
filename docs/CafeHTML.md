# CafeHTML Current Product and Architecture

> Current implementation reference for the Next.js application. Planned work is
> tracked in `docs/ROADMAP.md`, reproducible defects in `docs/problem.md`, and
> chronological history in `docs/log.md`. The former mixed HTML/Next.js reference
> is archived at `docs/legacy/CafeHTML-legacy.md`.

## Product scope

CafeHTML is a structured AI media workspace. Users organize real image
references by role, compose an instruction with the Brief Agent, generate and
evaluate images in FRAME, edit images in Studio, and generate project-scoped
video clips in SCENE.

Supported product surfaces:

- **IMAGE / FRAME** at `/`
- **VIDEO / SCENE** at `/video`
- **Studio** as an image-editing overlay opened from Gallery or Module references
- **Projects** with local persistence and cloud synchronization
- **Brief Agent** with reference reading, persistent runs, a `/memory` interface
  for saved memory, engineering insights, and activity, plus safe app actions,
  approval/rejection cards, and undo

Prototype routes are not finished product surfaces:

- `/music-test` contains a substantial music workstation awaiting AUDIO product
  integration.
- `/mask-test` and `/vector-test` are isolated editing experiments awaiting an
  integrate-or-remove decision.
- The full Timeline is not built.

## Current application structure

- App routes and server handlers: `src/app/`
- Shared application shell: `src/components/AppShell.tsx`
- UI components: `src/components/`
- React state providers: `src/context/`
- Browser persistence: `src/lib/db.ts`
- Image pipeline: `src/lib/pipeline/`
- Brief Agent runtime: `src/lib/brief-agent/`
- Video client and contracts: `src/lib/video/`
- Cloud synchronization: `src/lib/cloudWorkspace.ts`
- Sites bindings and migrations: `.openai/hosting.json`, `drizzle/`, and `worker/`

`AppShell` provides settings, gallery, module, and Studio state to every route
except `/login`. FRAME and SCENE share project identity and storage while
keeping their prompt/settings drafts separate.

## Persistence and recovery

IndexedDB is the local system of record. Important stores include:

- `projects`
- `settings`
- `moduleState`
- `studioState`
- `references`
- `gallery`
- `images`
- `videos`
- `generation-jobs`
- `agent-runs`
- `agent-events`
- `agent-memories`
- `agent-insights`
- `sync-tombstones`

`DB.images` owns image data URLs. Gallery, references, modules, and prompt
manifests should store UUIDs and lightweight metadata instead of copying image
payloads. Gallery hydration is progressive and image tiles mount lazily.

Image and video generation writes a `generation-jobs` record before the model
request begins. After a refresh or crash, unfinished image jobs restore as
explicit error placeholders and unfinished video jobs restore as failed clips
with a retry path. The exact remote video operation is not yet resumed; that
work is defined in the roadmap.

Project deletion cascades through project-owned records and then removes
unreferenced media. Cloud sync mirrors supported project, reference, generation,
and agent-memory state while local IndexedDB remains available for recovery.

## FRAME image workflow

1. Capture the user instruction, image settings, ordered active references, and
   project provenance.
2. Read active references into role-aware observations when the Brief Agent
   needs visual context.
3. Compile Subject, Scene, and Style controls into a generation-ready prompt.
4. Send the prompt and ordered inline images through the server image route.
5. Run one request per variation and preserve successful siblings with partial-
   success handling.
6. Resolve the matching Gallery tiles and persist their metadata, references,
   effective prompt, model, settings, and optional evaluation.

Active root references are ordered and limited to six. Folder images remain
inactive until moved to root and assigned a supported generation role.

Gallery outcomes are explicit: completed images, `BLOCKED`, `QUOTA`, `TIMEOUT`,
and `FAILED`. Retry is offered only for retryable outcomes. Multiple generation
batches can run concurrently.

## Reference roles and strength

The active prompt compiler treats strength as role-axis control:

- **SUBJECT** controls pose, expression, action, orientation, and placement
  freedom while protecting identity, type, shape, wardrobe/materials, and
  distinctive details.
- **SCENE** controls locked view through reframing/new-shot freedom while
  protecting the event, environment, visible anchors, scale, and lighting
  direction.
- **STYLE** controls rendering medium, palette, texture, lighting mood, and
  finish; it must not introduce people, objects, layout, or scene content.

The current Subject compiler is `subject-v4-scene-reframe`. Strength affects
both the global role contract and the per-image instruction. Google image models
do not receive a separate numeric image-weight parameter.

Cross-role safeguards instruct the planner and compiler to preserve Subject
identity when Scene references contain other people or objects. General conflict
explanation and resolution remains partial roadmap work.

## Brief Agent

The Brief Agent is server-backed; the deterministic mock planner is a fallback
and test fixture, not the primary planner.

The browser sends a compact project/reference snapshot to
`POST /api/brief-agent`. The planner may return conversation, a prompt artifact,
and a bounded list of typed `appActions`. The server validates actions against
the snapshot. The browser presents mutations for approval and revalidates the
active project and targets before applying them.

Current safe actions:

- project rename
- reference rename, role, strength, visibility, move, and duplicate
- folder creation

Generation, upload, replacement, editing, deletion, and publishing are not part
of the safe app-action set. See `docs/agent-app-runtime.md` for invariants and
commands and `docs/brief-agent-evaluation.md` for the deterministic baseline.

## Generation feedback and evaluation

Completed Gallery images support user ratings and comments. Evaluation fields
cover task, Subject, label, and strength match. AI visual review can provide
diagnostic evidence and a revision suggestion, but explicit user feedback is
authoritative.

Evaluations persist with Gallery records. The Projects panel can export rated
evaluation records through `POST /api/evaluations/export`; API keys and image
payloads are excluded. Full `.cafe` project export/import is not implemented and
is tracked separately in the roadmap.

## Studio

Studio edits a Gallery image or Module reference while preserving image-specific
history and reference groups. The active history selection is returned to the
caller:

- Gallery callers replace the original Gallery image in place.
- Module callers replace the reference in place and retain its UUID so history
  stays attached.

Studio supports prompt-based refinement, `/upscale 2k`, `/upscale 4k`, crop,
annotation, and action-oriented reference groups. Studio references have their
own visibility, replace, remove, and persistence behavior. Studio does not
automatically publish an additional Gallery record; an explicit Save to Gallery
control is an unscheduled design option.

## VIDEO / SCENE

The Video workspace supports frame interpolation, reference-driven generation,
model-aware settings, media assignment, playback, sequence ordering, persistent
drafts, and project-scoped MP4 storage.

The browser posts to `POST /api/video/generate`. Veo requests use the video
generation API and poll the returned operation; Gemini Omni requests use the
Interactions API and may return inline video. URI-backed Veo results are
downloaded server-side and empty video responses are rejected.

Current constraints are validated before model invocation:

- aspect ratios: 16:9 and 9:16
- durations: 4, 6, and 8 seconds
- up to four outputs per prompt
- model-specific reference limits
- model-specific end-frame support
- 1080p/4K duration requirements

Generated MP4 blobs live in the `videos` store. Sequence and MEDIA views share
those records without duplicating the binary. Ordering, removal, project
switching, reload, and project deletion update persistent state. Temporary
playback object URLs are revoked when no longer needed.

## Models and configuration

Image models are defined in `src/context/SettingsContext.tsx`; video capabilities
are defined with the Video page and API contract. UI controls must be derived
from those capability definitions rather than hard-coded assumptions.

Server configuration keys are documented in `.env.example`. Production model
calls use server-side credentials. A locally saved Google AI Studio key may be
forwarded only from localhost through the restricted development path; browser-
supplied keys are not accepted by production generation routes.

## Authentication, cloud, and hosting

The application has a dedicated `/login` route and a single-user Sites-backed
authentication flow. Cloud workspace synchronization uses the configured D1 and
R2 bindings while IndexedDB supplies local-first behavior and recovery.

The Sites project is declared in `.openai/hosting.json` with logical `DB` and
`MEDIA` bindings. Production builds use Vinext and emit the Cloudflare Worker-
compatible entrypoint under `dist/server/index.js`.

## Design invariants

- FRAME is orange (`#ea5823`); SCENE is blue (`#5271ff`).
- Subject, Scene, and Style roles must remain semantically separate.
- Media payloads have one owner; UI records store identifiers and metadata.
- User-owned mutations must be persisted before the UI reports success.
- Model text is not proof that an app action executed.
- Paid or destructive behavior requires an explicit, reviewable boundary.
- Responsive controls must remain keyboard-, pointer-, and touch-accessible.
- Current product documentation must not describe prototypes or legacy code as
  supported product behavior.

## Documentation map

- `docs/CafeHTML.md` — current product and architecture
- `docs/ROADMAP.md` — prioritized planned work and completion criteria
- `docs/problem.md` — reproducible current defects
- `docs/agent-app-runtime.md` — agent actions, safety, and commands
- `docs/brief-agent-evaluation.md` — deterministic evaluation baseline
- `docs/log.md` — append-only session history
- `docs/legacy/CafeHTML-legacy.md` — archived mixed legacy reference and decisions

Last reconciled: 2026-08-23.

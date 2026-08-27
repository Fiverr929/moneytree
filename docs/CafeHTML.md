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

The visible conversation surface is branded **CAFEHTML**. “Agent,” “Director,”
and specialist names describe internal responsibilities rather than competing
user-facing personalities.

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

### Composer, chat, and media handoff

The prompt bar and CAFEHTML conversation form one reusable AI operation unit.
The prompt row retains its image-add, settings, input, clear, and submit
controls while the transcript can collapse to zero height or open to a
user-resizable height. The chosen height persists as a device-local preference;
double-clicking the resize grip restores the default. Long messages fold inside
the transcript, older messages load in bounded pages, and active work remains
visible through compact status rows.

Composer completion is keyboard-oriented and shared across the site:

- `/` opens the command palette and inserts supported commands without changing
  the surrounding prompt-bar layout.
- `@` opens the project reference palette with small image previews. Submitted
  mentions resolve to UUID-backed Module references rather than copied image
  payloads.
- Image generation completion records a causal trace containing the effective
  prompt, model, aspect ratio, duration, result count, and reference identifiers.

Reference uploads and generated outputs appear in the conversation as compact
media events. A generated-image chip opens the Gallery result and exposes a
chip-aligned action menu for `USE AS SUBJECT`, `USE AS SCENE`, `USE AS STYLE`,
`ADD TO MOOD BOARD`, and download. Reusing a result creates an ordinary Module
reference and does not invoke another paid generation request.

Both visible `+` controls provide role-aware image entry. The prompt-bar menu
and the Module-panel menu let the user choose Subject, Scene, Style, or Mood
Board before upload or screenshot paste. Selecting paste arms the destination
and displays an explicit `CTRL+V` status in Module; pasted clipboard images then
continue through the normal naming, persistence, and timeline flow. Folder and
media action menus choose an upward or downward placement from available space
so they remain inside their scroll container at desktop, tablet, and phone
breakpoints.

## Planned creative-intelligence architecture

This product layer turns CafeHTML from a single-prompt composer into a
project-aware creative system. It combines the implemented foundation with the
remaining target specification; unfinished capabilities are identified rather
than implied to ship.

Implemented foundation as of 2026-08-27:

- Brief Slots retain the existing visual design while supporting MOOD,
  LOOKBOOK, WORLD, and CUSTOM type metadata, separate names and purposes,
  active/inactive state, direct multi-image upload, paste, and a compact drop
  target.
- Active Brief Board images are vision-read in bounded background batches.
  Their fresh observations, board type, purpose, and source fingerprint are
  supplied to the Director as structured context. Board media is not silently
  treated as direct generation input.
- `/generate-scene` invokes the versioned Scene Builder contract, creates an
  exact-count structured Scene Plan, and executes one independent image request
  per ordered shot. The existing quantity control displays SHOTS for this
  command and remains VARIATIONS for `/generate`.
- Every generated shot stores its scene ID, position, purpose, action, camera,
  continuity contract, source instruction, and planner model with the Gallery
  result.

Still planned: non-destructive many-to-many board membership, editable and
approved Visual Bible versions, explicit board-image pinning, scene strip UI and
shot-only retry, portable profiles/checkpoints, external inspiration providers,
and the reviewed skill registry/promotion workflow.

The design has four durable layers:

1. **Brief Boards** let a user communicate taste, canon, and intent through
   images and ordinary notes.
2. **Project Bible** stores the agent's reviewed, structured interpretation of
   those boards and the project's approved decisions.
3. **Skills** supply reusable professional procedures, routing rules, output
   contracts, checks, and repair strategies.
4. **Director Agent** chooses and coordinates the relevant skills, project
   knowledge, references, and generation pipeline for the current request.

The model supplies general intelligence; the harness supplies direction,
boundaries, repeatability, provenance, and recovery. A long prompt alone is not
a harness.

### Target terminology

Several current terms are overloaded. Migration must remain backward-compatible
in storage while making the user-facing concepts unambiguous:

- **FRAME** is an independent still-image creation. `/generate` repeats one
  image brief for the selected number of variations.
- **SCENE** is a planned collection of connected still images.
  `/generate-scene` turns one instruction into an ordered set of shot briefs and
  runs a separate image request for each shot.
- **SHOT** is one image inside a SCENE.
- **TAKE** is an alternative attempt at the same SHOT.
- **VIDEO** is the motion-generation workspace currently documented as
  VIDEO / SCENE. The target terminology should call it VIDEO to avoid confusing
  it with still-image SCENE creation.
- The current reference role **SCENE** should migrate conceptually to
  **SETTING**. Stored legacy values may continue to read `SCENE` until a safe
  data migration exists.

Broad SUBJECT / SCENE / STYLE roles remain current compatibility categories,
not the final creative ontology. The target system can express Character,
Creature, Species or Breed, Setting, Architecture, Wardrobe, Pose, Expression,
Movement, Object, Prop, Material, Palette, Lighting, Camera, Composition, Time,
Weather, Tone, Emotion, Medium, and Finish. None is mandatory; the harness uses
only categories supported by evidence and relevant to the request.

### FRAME and still-image SCENE contracts

FRAME preserves the current contract:

```text
user instruction + active direct references
  -> one generation-ready image brief
  -> N separate requests using that same brief
  -> N independent variations
```

SCENE introduces a separate planning contract:

```text
story instruction + shot count + Project Bible + active references
  -> structured Scene Plan
  -> shared continuity contract
  -> one distinct prompt per shot
  -> one separate image request per shot
  -> ordered, recoverable Scene result
```

The existing Variations control remains the quantity control. Its visible label
changes by mode:

- FRAME: `3 VARIATIONS` means three independent interpretations of one brief.
- SCENE: `3 SHOTS` means three connected images with distinct shot briefs.
- SCENE with a value of `1` is valid and produces a narrative keyframe rather
  than visible progression.

Explicit user quantity has priority. Explicitly enumerated sections such as
`Shot 1` through `Shot 6` are next. Otherwise the current setting is
authoritative. The agent may recommend another count, but it must not silently
increase paid generation volume. When an explicit instruction requires a count
change, the agent may propose or apply the typed setting change through the
normal approval boundary and report the old and new values.

The Scene Plan is a stored artifact rather than prose hidden in conversation:

```ts
type ScenePlan = {
  id: string;
  projectId: number;
  title: string;
  intent: string;
  shotCount: number;
  briefVersionIds: string[];
  continuity: {
    characters: string[];
    wardrobe: string[];
    setting: string[];
    objects: string[];
    treatment: string[];
  };
  shots: Array<{
    id: string;
    index: number;
    purpose: string;
    action: string;
    composition: string;
    camera: string;
    continuityFrom: number[];
    prompt: string;
    status: "planned" | "running" | "complete" | "blocked" | "failed";
  }>;
};
```

Every request receives the original approved anchors and shared continuity
rules. A preceding generated shot is attached only when its visual evidence is
needed; blindly chaining every result compounds drift. Scene jobs own child shot
jobs so individual failures can be retried without regenerating successful
siblings.

### Brief Boards

The existing New Brief Slot and its MOOD, LOOKBOOK, and WORLD presets are the
right visual foundation. Their current card, color, image-row, naming, and
drag-and-drop design should be retained. The target behavior adds intelligence
and faster entry points rather than replacing the interface.

A Brief Board is a project-scoped collection, not a physical media folder and
not automatically a direct generation reference. Recommended board types:

- **MOOD**: atmosphere, palette, lighting, texture, tone, and emotion.
- **LOOKBOOK**: wardrobe, silhouette, materials, styling, pose, casting, and
  physical presentation.
- **WORLD**: setting, geography, architecture, objects, props, weather, time,
  and recurring spatial anchors.
- **CUSTOM**: a user-named concern such as Camera Language, Creature Movement,
  Product Materials, Expression Library, or Brand Design System.

Type and name are separate. Examples include `MOOD / WINTER MELANCHOLY`,
`LOOKBOOK / HERO WARDROBE`, and `WORLD / CATHEDRAL DISTRICT`. Multiple boards of
the same type may coexist.

The creation form should keep its present visual language while adding:

- a type selector including CUSTOM;
- a custom name;
- an optional plain-language purpose;
- multi-image upload, paste, and operating-system drop;
- selection from existing Library or Gallery media; and
- creation with or without initial images.

An open board should expose a compact `+ ADD / DROP IMAGES` target. When empty,
the target can occupy the body; once populated, it collapses to a thin action
row while current named image rows remain unchanged. The board menu's existing
targeted upload remains available. Image menus and bulk selection should add an
`ADD TO BRIEF` action so long sessions never depend on dragging across the
panel.

Brief membership must be non-destructive and many-to-many. Moving an image into
a board must not remove it from Library, stop a direct reference from
participating in generation, or prevent membership in another board. Prefer a
join record over the current single `folder` owner:

```ts
type BriefMembership = {
  briefId: string;
  imageId: string;
  note?: string;
  intent?: "character" | "setting" | "wardrobe" | "pose" | "expression"
    | "movement" | "object" | "prop" | "material" | "palette"
    | "lighting" | "camera" | "composition" | "tone" | "custom";
  addedAt: string;
};
```

Drag-to-board remains a shortcut. `ADD TO BRIEF`, direct upload, paste, and
Library/Gallery selection are the primary scalable interactions.

Each board has an explicit active state. An active board contributes its
approved compiled meaning to relevant planning; it does not automatically attach
every contained image. An inactive board and its media remain available for
inspection and later reactivation but do not influence new plans. The composer
should support plain-language references and exact `@` mentions of a board or
image when the user wants to narrow the source explicitly.

External inspiration services such as Pinterest or another reference-image
provider should integrate through a provider boundary rather than special-case
prompt logic. A provider may offer authenticated search, board selection, or
user-directed import subject to its API, permissions, attribution, and content
terms. Imported media records should retain source URL, provider, creator or
attribution when available, import time, and a content fingerprint for
deduplication. CafeHTML must not depend on fragile scraping or remote hotlinks;
the user selects what becomes project media, and the normal Brief observation,
approval, and provenance pipeline begins after import.

### From images to a Visual Bible

Board images are evidence, not executable instructions. CafeHTML uses a staged
compiler:

1. **Observe each image.** A vision model records visible entities, attributes,
   relationships, palette, lighting, composition, pose, movement cues,
   materials, setting, and uncertainty. It distinguishes observation from
   assumption.
2. **Interpret in board context.** MOOD, LOOKBOOK, WORLD, CUSTOM purpose, and
   optional per-image notes decide which observations matter. A person shown in
   a WORLD image is not automatically a requested character; a room shown in a
   LOOKBOOK is not automatically the project setting.
3. **Synthesize rules.** The agent proposes editable `Preserve`, `Flexible`,
   `Avoid`, and `Unknown` sections with source citations and confidence.
4. **Approve and version.** User corrections become the authoritative board
   brief. Approval produces an immutable version used by generation records.
5. **Compile for a task.** The Director selects only relevant Bible rules and
   direct visual anchors for the current FRAME, SCENE, Studio, or VIDEO task.

The durable board output is structured data plus a readable summary, not an
unbounded hidden prompt. A representative shape is:

```ts
type VisualBibleEntry = {
  id: string;
  briefId: string;
  version: number;
  sourceFingerprint: string;
  category: string;
  preserve: string[];
  flexible: string[];
  avoid: string[];
  unknown: string[];
  evidence: Array<{ imageId: string; observation: string; confidence: number }>;
  status: "draft" | "approved" | "stale";
};
```

Generation always receives a compiled text brief. It sometimes receives images
as well:

- General taste and repeated aesthetic tendencies are normally expressed as
  concise text derived from the approved Bible.
- Exact identity, geometry, wardrobe construction, object design, pose, or
  material evidence may justify attaching one or more selected images.
- The Director selects the smallest useful image set within model limits and
  scopes every attachment: for example, `architecture only`, `pose only`, or
  `identity anchor`.
- All board images are never attached indiscriminately.
- A user can explicitly pin a board image as a direct generation reference.

The UI should disclose provenance in plain language: which boards contributed,
which rules were applied, which images were attached directly, and what each
attached image was meant to control.

Replacing, removing, hiding, relabeling, or changing the note on a source image
invalidates the source fingerprint and marks derived Bible entries stale. They
must be recompiled before they can silently influence a new generation. The
Project Bible must not depend on conversational memory; this prevents an old
style constraint from surviving after its evidence changes.

### Project Bible, Taste Profile, and portable agent state

The system keeps different kinds of learned information separate:

- **Project Bible**: characters, creatures, worlds, objects, wardrobe, canon,
  constraints, and approved visual direction belonging to one project.
- **Taste Profile**: reusable aesthetic preferences such as restraint, palette,
  composition, realism, or camera tendencies.
- **Agent Profile**: reusable collaboration behavior such as initiative,
  option-making, approval style, prompt economy, continuity discipline, and
  review habits.
- **Conversation Checkpoint**: current goal, approved decisions, unresolved
  questions, pending work, recent evidence, and a compact recent transcript.
- **Skill**: an executable professional method with routing, workflow, output,
  validation, and repair rules.

A user may carry an Agent Profile, Taste Profile, or approved skill to another
project. Project-specific Bible material and media stay behind unless selected
explicitly. CafeHTML cannot transfer private chain-of-thought, hidden model
activations, or guarantee the same physical running model instance. Instead it
rehydrates a new session from explicit, inspectable state:

```text
base CafeHTML harness
  + selected Agent Profile
  + selected Taste Profile
  + optional installed skills
  + current Project Bible
  + Conversation Checkpoint
  + recent workspace state
```

This is more stable and portable than relying on opaque conversation context.
The same model family and version may improve behavioral continuity, but model
identity is configuration rather than the storage mechanism.

### Skill library and generated skills

An Agent Profile or Taste Profile is not automatically a skill. A full skill is
a versioned instruction contract containing:

- name, description, scope, and activation triggers;
- required and optional inputs;
- prerequisites and blocking conditions;
- domain ontology and terminology;
- ordered workflow and decision branches;
- reference interpretation and selection rules;
- invariant, flexible, and prohibited behavior;
- tool and model routing;
- structured output schemas;
- pre-execution and post-execution validation;
- known failure modes and repair strategies;
- examples, counterexamples, and evaluation fixtures; and
- provenance, authorship, version, and compatibility metadata.

Professional instruction libraries such as character builders, still-image
directors, and cinema directors are design references. CafeHTML learns their
skill anatomy and rigor; it does not concatenate their text or obey uploaded
documents blindly. Imported documents are untrusted source material until a
reviewed compiler extracts a candidate skill.

Skills may enter the system four ways:

1. **Discover**: the agent identifies a repeated successful method in approved
   work and proposes saving it.
2. **Conjure temporarily**: the Director assembles a task-scoped procedure that
   expires with the run.
3. **Create intentionally**: the user asks the agent to build a skill from
   boards, instructions, examples, and feedback.
4. **Install**: the user selects a compatible external or library skill.

No discovered or imported skill becomes durable or portable without review and
explicit approval. `PROMOTE TO PROFILE` saves behavior or taste;
`PROMOTE TO SKILL` opens the complete skill contract, tests, and version for
review. Project facts must be stripped or separately selected during export.

### Director and specialist execution

The Director Agent is the single user-facing coordinator. It may route work
through specialist capabilities such as:

- Character and Creature Builder
- Species or Breed Interpreter
- World and Setting Builder
- Wardrobe and Look Director
- Object, Prop, and Material Director
- Pose, Expression, and Movement Director
- Style and Tone Director
- Cinematography Director
- Scene and Shot Planner
- Continuity Supervisor
- Prompt Compiler
- Generation Critic and Repair

These are initially explicit skill passes with structured handoffs, not a
mandatory swarm of independent model agents. A single model can execute several
specialist passes more cheaply and consistently. Independent agents are reserved
for tasks that benefit from separate evidence reading, criticism, or parallel
planning. The Director owns conflict resolution and the final execution plan.

Recommended handoff artifacts include `ReferenceObservation`, `VisualBible`,
`ScenePlan`, `ShotBrief`, `GenerationManifest`, and `Evaluation`. Specialists
must exchange these structures rather than unbounded conversational prose.

### Instruction precedence and safety

For a generation task, use this precedence:

1. latest explicit user instruction;
2. approved current FRAME or SHOT brief;
3. direct active visual references within their scoped ownership;
4. approved Project Bible entries;
5. selected Agent and Taste Profiles;
6. activated professional skills;
7. CafeHTML defaults.

Higher layers may narrow or override lower creative defaults, but they cannot
bypass safety, payment, mutation, or data-ownership boundaries. When two sources
at the same level conflict, the Director exposes the conflict or applies an
approved ownership rule rather than silently averaging them.

Every model-derived rule retains its evidence and confidence. Every generation
stores the exact Bible versions, profiles, skills, direct images, scoped image
purposes, Scene Plan or FRAME brief, model settings, and effective prompts used.
This provenance is required for debugging, iteration, export, and reproducible
evaluation.

### Recommended delivery sequence

Status legend: **FOUNDATION** means the usable vertical slice exists but the
full target contract described above is not yet complete.

1. **FOUNDATION** — Preserve the current Brief Slot design and add direct multi-upload, paste,
   compact drop target, CUSTOM type/name, Library/Gallery selection, and bulk
   `ADD TO BRIEF`.
2. Replace exclusive folder ownership with non-destructive Brief membership and
   migrate existing MOOD, LOOKBOOK, and WORLD folders.
3. **FOUNDATION** — Add per-image visual observations, optional notes, source fingerprints, and
   stale-state handling.
4. Add editable, versioned Brief synthesis and Project Bible provenance.
5. **FOUNDATION** — Compile active Bible entries into the existing FRAME prompt while preserving
   direct-reference limits and current role safeguards.
6. **FOUNDATION** — Add `/generate-scene`, structured Scene Plans, SHOTS quantity semantics,
   child generation jobs, ordered Gallery presentation, and shot-level retry.
7. Add Agent Profiles, Taste Profiles, Conversation Checkpoints, and explicit
   cross-project import/export boundaries.
8. Add the skill registry, candidate-skill compiler, review flow, validators,
   fixtures, and `PROMOTE TO SKILL`.
9. Introduce specialist model agents only where evaluation shows a measurable
   advantage over one Director executing structured skill passes.

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

`VIDEO / SCENE` is the current implementation name. Under the planned target
terminology above, this surface becomes VIDEO, while SCENE names the connected
still-image creation contract. This rename requires a deliberate UI, storage,
documentation, and compatibility migration and is not implied to be complete.

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
R2 bindings while IndexedDB supplies local-first behavior and recovery. Project
iteration briefs and engineering insights participate in that sync. Their
structured evidence and histories merge deterministically across devices;
reference fingerprints remain freshness guards and are never silently refreshed
by synchronization. The exact supported boundary is documented in
`docs/agent-app-runtime.md`.

The Sites project is declared in `.openai/hosting.json` with logical `DB` and
`MEDIA` bindings. Production builds use Vinext and emit the Cloudflare Worker-
compatible entrypoint under `dist/server/index.js`.

## Design invariants

- FRAME is orange (`#ea5823`); SCENE is blue (`#5271ff`).
- Current Subject, Scene, and Style roles must remain semantically separate
  until the planned ontology and Setting migration replace them safely.
- Media payloads have one owner; UI records store identifiers and metadata.
- Brief membership is a metadata relationship and must not duplicate or take
  ownership of the underlying media payload.
- Model observations are evidence, not automatically approved project facts.
- Portable profiles and skills must exclude project-specific canon and media by
  default.
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

Last reconciled: 2026-08-27.

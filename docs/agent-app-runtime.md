# CafeHTML Agent App Runtime

CafeHTML's agent is a creative workspace operator, not only a prompt writer. The app runtime is the boundary between model suggestions and durable project changes.

## Structured decisions and iteration continuity

- Agent plans render their directions once as structured choices; reply prose is stripped of repeated direction lines and option labels are normalized without embedded numbering.
- Interactive questions are explicit `decisionFlow` data. Inline questions remain prose. Up to three questions can be navigated locally, custom answers retain their question identity, and changing an earlier answer clears only dependent answers.
- Choices are submitted once with an explicit next-step intent. Completing a decision never authorizes generation unless the original request required a draft after clarification.
- Each project has a versioned iteration brief with an explicit generation anchor, parent lineage, Keep/Change/Avoid constraints, rejected attempts, decision answers, reference fingerprint, and version.
- An anchor is semantic continuity evidence supplied to the brief agent; it is not represented as pixel-level image input to the generator. New attempts do not replace it automatically.
- Preflight blocks unavailable or rejected anchors and exact Keep-versus-Change/Avoid conflicts. Reference changes mark structured decisions stale.
- The existing Generation feedback panel is the single user surface. User feedback is authoritative; automated analysis stays separately labelled and collapsed. A feedback note enters project memory only when the user explicitly selects the remember option.
- Iteration briefs save locally first and synchronize through the cloud project-state record. Version comparison prevents an older remote brief from replacing a newer local brief.

The model registry uses Gemini 3.7 Flash for planning and Gemini 3.5 Flash-Lite for reference reading, generation inspection, and routine generation review.

## Conversation continuity

- Raw agent messages are stored separately from the active model context.
- After 18 messages, the model receives a structured checkpoint plus the eight most recent messages; the visible transcript remains intact.
- Checkpoints retain source message identifiers and synchronize through the authenticated single-user context endpoint.
- Generation prompts are normalized without discarding unique instructions. A brief above 4,000 characters is blocked for revision rather than silently truncated.

## Project deletion

- Delete moves a project to Projects → Trash for 30 days and excludes it from generation, memory recall, and ordinary project lists.
- Restore clears the deletion marker and synchronizes the recovered project.
- Permanent deletion cascades through local project data and removes cloud metadata, project memory, transcripts, checkpoints, references, generations, and media while retaining a purge tombstone for other devices.

## Execution model

1. The browser sends a compact workspace snapshot with exact project, folder, and reference identifiers.
2. The model may return conversational output plus a bounded list of safe `appActions`.
3. The server validates action types, values, folders, and targets against that snapshot.
4. The browser renders a typed proposal with `APPROVE` and `REJECT`; no mutation occurs while it is pending.
5. Approval revalidates the project and every target against current state, then applies and persists each mutation and event atomically.
6. The console prints `ACTION OK` or `ACTION FAILED` from actual execution. Model text is never treated as proof that an action succeeded.

## Safe action set

- `project.rename`
- `reference.rename`
- `reference.set_role`
- `reference.set_strength`
- `reference.set_visibility`
- `reference.move`
- `reference.duplicate`
- `folder.create`

Generation, editing, deletion of user-owned content, replacement, upload, and publishing are intentionally excluded. Paid generation continues through the existing prompt approval flow.

The reference library accepts multi-image uploads directly into MOOD, LOOKBOOK, and WORLD. Folder images remain inactive until moved to root and assigned SUBJECT, SCENE, or STYLE. Generation and agent vision share the same ordered maximum of six active root references.

## Safety invariants

- At most eight app actions are accepted from one model response.
- Unknown action types, targets, roles, folders, and malformed values are discarded server-side.
- Names are normalized and length-limited; strength is clamped to `0..100`.
- App actions execute only when the active project still matches the project that launched the request.
- Pending and resolved proposals persist with the agent run; interrupted execution becomes stale instead of running twice.
- Every proposal is single-use. Repeated approval and rejection attempts are ignored.
- Each durable mutation and its event record share one IndexedDB transaction.
- Multi-action responses report partial success explicitly instead of pretending the batch was atomic.
- `/undo` applies the stored inverse of the latest eligible completed agent action.
- Destructive and paid operations require separate approval-aware tools in a later milestone.
- Planner, reference-reader, and generation-inspection calls emit structured token telemetry with separate operation names.

## CLI commands

- `/generate <prompt>` — generate an image immediately. Natural-language image briefs in chat also auto-generate after the agent composes the final prompt.
- `/undo` — undo the latest eligible completed agent action.
- `/memory` — open saved Memory, engineering Insights, and app-action Activity.
- `/memory add [user|project|session] <fact>` — save an explicit memory; the default scope is project.
- `/memory clear <user|project|session|all>` — clear a selected memory scope.
- `/clear` — end the current agent run and clear the console.
- `/help` — list commands.
- `/status` — show live model, run, generation, reference, queue, and approval state.
- `/retry` — retry the latest failed agent turn.
- `/stop` — cancel agent thinking and clear queued turns without interrupting active image generation.

`Ctrl/Cmd+K` focuses the agent input. `Escape` stops an active agent request before reverting to its normal input-clear behavior. Image generation runs independently, so the user can continue talking to the agent while frames render.

App-changing proposals render their own `APPROVE` and `REJECT` controls. The
former `/pending`, `/approve`, `/reject`, and `/actions` commands are
consolidated into proposal cards, `/status`, and `/memory activity`. Image
generation does not wait for approval.

## Next runtime milestones

These are roadmap items, not current capabilities. Priority and completion
criteria are maintained in `docs/ROADMAP.md`.

1. Route manual UI mutations through the same typed command layer.
2. Extend approval objects to image editing, replacement, and destructive actions.
3. Add action/observation iterations so the model can inspect results and choose a bounded next step.
4. Add content-addressed vision memory and structured project preferences.
5. Add replayable end-to-end evaluations for target resolution, permissions, undo, interruption, and result verification.

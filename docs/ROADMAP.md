# CafeHTML Product Roadmap

This document is the source of truth for planned product work. `docs/CafeHTML.md`
describes the product that exists today, `docs/problem.md` contains reproducible
current defects, and `docs/log.md` remains the append-only implementation history.

## Status rules

- **Now**: the next product-completeness work.
- **Next**: planned after the Now group is complete.
- **Later**: valuable work without a near-term commitment.
- **Blocked**: cannot proceed until a named dependency or decision is resolved.
- **Done**: implemented and supported by code or a repeatable verification.

An idea is not scheduled work until it has a completion test. Moving an item to
Done requires both the implementation and the verification listed below.

## Now

### Complete project portability

Build a real `.cafe` project export/import flow. The archive must preserve the
project record, images, references, folders, gallery generations, evaluations,
Studio state, agent state, and image/video drafts without duplicating or losing
image data.

**Done when:** a project exported from one fresh browser profile imports into a
second profile, restores the same user-visible state, and survives a reload.

### Add in-app Help

Replace the inert Help control with a concise guide to projects, references,
FRAME, VIDEO, Studio, agent commands, recovery behavior, and API settings.

**Done when:** Help is keyboard- and pointer-accessible from the main menu on
desktop and mobile, and every documented control matches the current UI.

### Establish the quality baseline

Add browser-level coverage for project persistence, reference handling, agent
approvals, responsive overlays, and the project export/import round trip. Keep
paid image, video, and music calls mocked in automated checks.

**Done when:** production build, source lint, the existing deterministic checks,
and a small critical browser suite run automatically for repository changes.

## Next

### Promote Music into the Audio product

Turn the existing `/music-test` workstation into an official AUDIO tab. Connect
it to normal navigation, authentication, project persistence, recovery, and
responsive layouts; remove prototype naming and temporary example state.

**Done when:** a user can create, record, save, reload, and download a
project-scoped music take through the normal product navigation.

### Resume durable video operations

Persist the provider operation identifier and resume polling after refresh or
reconnect. Keep the existing explicit retry state for operations that cannot be
resumed.

**Done when:** an in-progress video operation survives a reload and completes
without starting a second paid generation request.

### Extend the typed agent-action runtime

Route ordinary manual workspace mutations through the typed command layer. Add
approval-aware image editing, replacement, and deletion, followed by bounded
result inspection before the agent reports success.

**Done when:** manual and agent-triggered versions of the same supported action
share validation, persistence, undo, interruption handling, and result tests.

## Later

### Build the Timeline

Assemble image, video, and audio assets with ordering, trimming, transitions,
preview, and final export.

**Done when:** a saved project can restore and export a multi-asset sequence
whose preview matches the final ordering, trims, and transitions.

### Decide the Studio tool boundary

Either integrate the Mask and Vector prototypes into Studio as supported tools
or remove their public test routes. Evaluate an explicit Save to Gallery action
as part of the same workflow decision.

**Done when:** `/mask-test` and `/vector-test` are no longer orphaned product
surfaces, and Studio output ownership is explicit and tested.

### Advance agent memory and evaluation

Add content-addressed vision memory, structured project preferences, bounded
multi-step action/observation loops, replayable end-to-end evaluations, and
paired generation trials centered on human preference and unwanted-change rate.

**Done when:** stored evidence can be traced, invalidated, replayed, and evaluated
without silently overriding current references or explicit user feedback.

## Done foundations

- FRAME image generation with partial-success handling and explicit error cells.
- SCENE video generation with persisted drafts and interrupted-job recovery.
- Generation ratings, AI review, revision feedback, persistence, and evaluation
  export.
- Server-backed Brief Agent with reference reading, persistent runs and memory,
  typed safe actions, approval/rejection, undo, and deterministic checks.
- Cross-role Subject/Scene/Style safeguards in the current prompt contracts.
- Cloud synchronization for projects, references, generations, and agent memory.

## Explicitly not scheduled

The dedicated module `order` field, shared dropdown abstraction, and automatic
Studio-to-Gallery publishing remain design ideas. They should not be treated as
commitments until a user-facing problem and completion test justify them.

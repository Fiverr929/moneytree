# Current Problem Log

This file contains reproducible defects in the current Next.js product. Planned
features belong in `docs/ROADMAP.md`; completed work belongs in `docs/log.md`.
The former April 2026 compiler issue list described the legacy HTML/JavaScript
implementation and is preserved by Git history.

## Open defects

| ID | Surface | Reproduction | Expected result |
|---|---|---|---|
| UI-1 | Help | Open the main CafeHTML menu and select **HELP**. | A current in-app guide opens. The control presently has no action. |
| PROJECT-1 | Project import | Open Projects and select **Import**. | A `.cafe` project can be selected and restored. The control presently logs a development message only. |
| PROJECT-2 | Project export | Select **EXPORT** from the main menu. | The active `.cafe` project is downloaded. The command presently opens Projects, where only evaluation export is implemented. |

## Partial safeguards, not open legacy defects

- The former “no feedback loop” issue is complete in the current product:
  ratings, user feedback, AI review, prompt revision, persistence, and evaluation
  export are implemented.
- Prompt/reference contradictions are partially addressed by the current
  Subject/Scene/Style contracts, reference observations, and explicit cross-role
  identity safeguards. General conflict explanation and resolution remains
  roadmap work, not an absent pipeline.
- The legacy VisionScan status issue does not describe the current reference
  reader. Current failures surface in the agent activity state and fall back
  without silently blocking generation.
- The former sequence-bar context issue was superseded by the active VIDEO
  workspace and its persisted project drafts.

## Reporting rule

Add an issue here only when it includes a repeatable action, an observed result,
and an expected result. Ideas, milestones, and architectural preferences should
be added to the roadmap only after they have a user-facing completion test.

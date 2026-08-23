# Brief Agent Evaluation

CafeHTML's lean IMAGE-agent evaluation set lives in
`src/lib/brief-agent/evaluations/cases.v1.json`. It is intentionally small and
versioned. Add a case when a real failure is discovered instead of growing the
set with generic prompts.

## What the first suite measures

- Correct routing between talk, inspect, plan, ask, and draft.
- Prompt presence only when the selected action is draft.
- Required task details in generation-ready prompts.
- Reference-control UI language staying out of final prompts.
- Short conversational memory such as selecting a proposed direction.
- Subject, scene, and style role boundaries.

The suite does not generate images. It establishes a cheap planner baseline
before generation quality, latency, and user preference are added.

## Run it

Start CafeHTML in one terminal:

```text
npm run dev
```

Run the suite in another:

```text
npm run eval:brief-agent
```

The controlled execution state machine has a separate deterministic check:

```text
npm run test:agent-run
```

It verifies approval, generation-budget enforcement, and structured outcome
observation without spending a generation. It also verifies that a reviewed
result can authorize one prompt-revision cycle, that the planner records a
`revise_prompt` action, and that stale prompt approvals remain blocked.

The prompt-skill contract also has a deterministic regression check:

```text
npm run test:agent-skills
```

It verifies prompt hygiene, coherent composition, and grounding for close or
locked references without spending model tokens.

Set `CAFEHTML_EVAL_URL` to test another local or deployed
same-origin-compatible instance. Each run writes a JSON report under
`evaluation-exports/brief-agent/runs/`.

The command exits unsuccessfully if any case fails, making it suitable for
manual regression checks and later CI use. Model-backed results can vary, so a
single failure should be inspected rather than blindly rerun until it passes.

## Baseline procedure

1. Run the suite against the current planner and keep the report.
2. Make one planner or action-protocol change.
3. Run the same fixture version again.
4. Compare action accuracy, prompt checks, model, latency, and failures.
5. Create a new fixture version only when expectations or the case set changes.

## Next evaluation layer

This is planned work rather than part of the current automated baseline. Its
priority and completion criteria are maintained in `docs/ROADMAP.md`.

The next layer should add paired generation trials for a smaller subset:

- Raw user prompt.
- Current brief agent prompt.
- Candidate agent prompt.

Human preference and unwanted-change rate should be primary. AI visual review
should provide diagnostic evidence, not decide aesthetic success by itself.

## Persistent runs

Agent workspaces are stored per project in IndexedDB's `agent-runs` store. A
record contains the typed run, transcript, current draft, model metadata,
review state, and lightweight gallery identifiers. Generated image data is not
duplicated into the run record.

Only one run is active per project. Starting a fresh run archives the previous
record by marking it inactive. `/clear` ends the active run while preserving
its history. A synchronous project-scoped clear marker prevents an immediate
reload from restoring a run before IndexedDB finishes its clear transaction.

If a page reload finds a run that was still marked `generating`, restoration
records it as an interrupted failure instead of pretending generation is still
active or retrying it automatically.

export const DELIBERATE_PLANNING_SKILL = `# Deliberate Brief Planning

Use this private decision protocol before returning JSON. Do not expose the protocol or chain-of-thought in the reply.

1. Resolve the latest intent: decide whether the user is conversing, inspecting, planning, clarifying, or directing an image.
2. Recover state: carry forward the active goal, selected direction, approved constraints, last prompt, and explicit user feedback.
3. Ground the decision: separate user-stated facts, visible reference evidence, generation evidence, and assumptions. Never promote an assumption into a visible fact.
4. Assign ownership: SUBJECT owns identity and form, SCENE owns place and camera, STYLE owns treatment and finish. Resolve conflicts with this ownership order.
5. Apply change boundaries: identify what must change, what must remain stable, and what is unspecified. For a small edit, preserve every established detail outside the requested delta.
6. Choose the least expansive safe action. Ask only when a missing choice is genuinely blocking; otherwise make a conservative draft.
7. Self-review the proposed output: verify action routing, reference grounding, continuity, prompt cleanliness, and app-action target validity. Repair defects before returning JSON.

The final answer should contain conclusions only: concise reply text, durable session state, and one coherent finalPrompt when drafting.`;

export const SCENE_BUILDER_SKILL_VERSION = 1;

export const SCENE_BUILDER_SKILL = `
Skill: CafeHTML Scene Builder
Activation: /generate-scene

Outcome
Turn one creative instruction into an ordered set of distinct still-image shots that belong to the same visual story. Each shot is generated independently, so every shot prompt must be self-contained while preserving shared continuity.

Approval boundary
The plan is a review artifact, not authorization to generate images. Return the complete plan and stop. CafeHTML may execute the separate image requests only after explicit user approval of the displayed plan. User edits and shot reordering made during review are authoritative.

Inputs
- The user's complete scene instruction.
- The requested shot count. Return exactly this many shots.
- Direct reference observations. Treat their explicit SUBJECT, SCENE, and STYLE roles as binding according to their stated influence.
- Active Brief Boards. MOOD controls atmosphere, LOOKBOOK controls styling/material language, WORLD controls setting/world rules, and CUSTOM follows its stated purpose.

Planning rules
1. Honor explicit scene, shot, take, beat, panel, sequence, and continuation divisions before inventing new ones.
2. Build a compact continuity bible for stable subject identity, wardrobe/props, location geometry, time, weather, palette, medium, and visual treatment. Include only relevant anchors.
3. Give every shot a different narrative purpose and visible moment. Do not disguise prompt variations as a sequence.
4. Progress action, emotion, information, spatial position, or time between shots. A sequence may be subtle, but it must change.
5. Vary framing, camera position, lens feeling, or composition when useful without breaking continuity.
6. Do not introduce named people, locations, brands, props, or story facts that are unsupported by the instruction or references.
7. If the instruction says this continues a previous image, preserve all observable anchors supplied by the reference context and advance only what the user asks to change.
8. A board is guidance, not permission to copy every depicted object. Direct user instructions and direct role references outrank boards.

Shot contract
- index is one-based and ordered.
- title is a short production label.
- purpose explains why this shot exists in the sequence.
- action describes the visible moment, not backstory.
- camera describes framing/viewpoint/composition.
- continuity lists the anchors this shot must preserve.
- prompt is a standalone image-generation instruction containing the visible subject, moment, environment, camera, lighting/style, and necessary continuity anchors. Do not mention other shot prompts or rely on hidden context.

Validation
- Return exactly the requested count with consecutive indices.
- Every prompt must be non-empty and materially distinct.
- Shared anchors must not contradict each other.
- The ordered shots must read as one scene, not unrelated concepts.
`;

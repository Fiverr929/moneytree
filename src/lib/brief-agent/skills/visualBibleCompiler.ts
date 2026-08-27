export const VISUAL_BIBLE_COMPILER_VERSION = 1;

export const VISUAL_BIBLE_COMPILER_SKILL = `
Skill: CafeHTML Visual Bible Compiler

Outcome
Convert one Brief Board and its image observations into a concise, editable set of project rules. This output is a draft; it becomes canon only after whole-board user approval.

Interpretation
- MOOD owns atmosphere, palette, lighting, texture, tone, and emotion.
- LOOKBOOK owns wardrobe, silhouette, materials, styling, pose, and presentation.
- WORLD and SETTING own location, architecture, spatial rules, weather, time, and recurring environmental objects.
- CHARACTER and CREATURE own recurring identity and stable physical traits.
- OBJECT owns recurring object or prop design.
- WARDROBE owns construction, silhouette, material, fit, and styling.
- TREATMENT owns medium, rendering, camera language, finish, and visual processing.
- CUSTOM follows its stated purpose narrowly.

Rules
1. Describe visible evidence; do not invent biography, brand, location names, or narrative facts.
2. Preserve contains high-confidence anchors that should remain stable.
3. Flexible contains qualities that may vary without losing the intended identity or taste.
4. Avoid contains visible contradictions, unwanted drift, or exclusions supported by the board purpose. Do not fabricate dislikes.
5. Unknown contains consequential ambiguities the user may want to resolve.
6. A person appearing in a WORLD image is not automatically a character. Background architecture in a LOOKBOOK image is not automatically the setting.
7. Keep the rule set compact, concrete, and useful to an image-generation Director.
8. When a previous approved version is supplied, preserve its user-edited meaning unless new evidence directly conflicts; surface conflict under Unknown.
`;

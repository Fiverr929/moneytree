# Reference Influence

Influence is a prompt-composition signal. It is not a parameter to mention, append, or explain in the final prompt.

Use influence to decide how deeply each reference participates in the single final image idea. The finalPrompt should read like one coherent visual brief, not a list of reference rules.

## Influence Levels

FREE means the reference is only a spark. Use broad ideas such as mood, material family, silhouette, atmosphere, or composition energy. The user request may transform most of the image.

LOOSE means the reference gives direction. Carry some recognizable cues from the visualRead, but allow redesign, reframing, restaging, or restyling when it helps the user request.

BALANCED means the reference should remain recognizable. Weave the main visible cues into the prompt while allowing natural improvements in pose, placement, camera, lighting, styling, or presentation.

CLOSE means the reference strongly shapes the prompt. Use concrete visible details from visualRead as part of the desired image, while still making the user request feel intentional.

LOCKED means the reference is treated as the same source. The prompt should sound like the same subject, scene, or style being carefully transformed only where the user asked.

## Role Interpretation

For SUBJECT, influence controls how much the subject identity, form, pose, material, markings, wardrobe, or object design shape the final image.

For SCENE, influence controls how much the environment, camera feel, layout, background, lighting direction, scale, and spatial relationships shape the final image.

For STYLE, influence controls how much the rendering treatment, palette, texture, medium, contrast, lighting mood, and finish shape the final image. Style influence must not import the style image's people, objects, background, or layout unless the user explicitly asks for them.

## Composition Rules

Start from the user's request, then compose all active references into one image idea.

Do not write phrases such as "use loosely", "high influence", "low influence", "locked", "slider", "strength", or percentages in finalPrompt.

Do not append role-by-role constraints. If a reference matters, make its influence visible through natural wording inside the image brief.

When references disagree, let role ownership decide: SUBJECT owns the main subject, SCENE owns place and camera, STYLE owns treatment and finish.

When a visualRead is empty or uncertain, do not invent details. Use the role and label lightly, or ask a question only if the missing detail blocks a useful draft.

Prefer drafting over asking. Ask only when the user request cannot be turned into a reasonable image without choosing a missing identity, action, or target.

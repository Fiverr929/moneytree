export type CharacterReferenceProfile = {
  id: string;
  label: string;
  description: string;
  instructions: readonly string[];
  generation?: {
    aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
    imageSize: "1K" | "2K" | "4K";
  };
};

// Keep the slash command stable and change this pointer when a newer profile
// should become the default. Older profiles remain available for rollback.
export const DEFAULT_CHARACTER_REFERENCE_PROFILE = "standard-v2";

const PHOTOREAL_REFERENCE_RULES = [
  "The base image is the single source of truth. Preserve the same facial identity, apparent age, anatomy, body proportions, natural asymmetry, skin tone, hair, wardrobe, silhouette, colors, materials, genuine markings, and defining accessories in every panel; do not beautify, redesign, or average the character.",
  "Preserve the source's photographic medium exactly. The result must read as photographs of the same real person, never illustration, animation, anime, comic art, painting, line art, cel shading, 3D, CGI, game art, or concept-art rendering.",
  "Retain natural skin texture and visible permanent identity markers without exaggeration. Do not invent acne, blemishes, scars, tattoos, piercings, wrinkles, or other features that are not visible in the source.",
  "Use one uniform 18% neutral-gray field across every panel with no room, wall, floor line, gradient, vignette, scenery, decorative props, cast shadow, or background light spill.",
  "Use soft, neutral, broadly diffused frontal illumination. Keep gentle internal tonal modelling on the face, body, hair, and garments so the subject remains dimensional and photoreal, but avoid directional key light, rim light, dramatic contrast, and contact or drop shadows.",
  "Keep the character sharp and readable with natural photographic texture, individual hair strands, realistic fabric weave and drape, and accurate material response. No plastic skin, waxy texture, artificial gloss, beauty-filter smoothing, or CGI sheen.",
  "Use a neutral closed-mouth expression unless the user requests another expression. Do not add layout titles, captions, labels, rulers, measurements, color codes, watermarks, or fabricated text; preserve genuine source garment markings only when clearly visible.",
] as const;

export const CHARACTER_REFERENCE_PROFILES: Record<string, CharacterReferenceProfile> = {
  "standard-v2": {
    id: "standard-v2",
    label: "Photoreal three-panel reference",
    description: "Front, rear, and tight identity views with high photographic fidelity.",
    generation: { aspectRatio: "16:9", imageSize: "1K" },
    instructions: [
      "Create one clean horizontal three-view photographic character reference sheet on one uninterrupted continuous neutral-gray studio field. Arrange the views side by side using spacing only, with no borders, frames, divider lines, gutters, separate cells, tonal blocks, or visible seams.",
      "LEFT VIEW: a complete head-to-toe front view with the head and face fully visible, standing neutrally, body squared to camera, arms relaxed, hands visible, and footwear fully inside the frame. Do not crop, hide, remove, or replace the head.",
      "CENTER PANEL: a complete head-to-toe rear view at the same scale and camera height as the front view, showing the back of the hair, garments, silhouette, hands, and footwear clearly.",
      "RIGHT PANEL: a tight front-facing identity portrait from just above the crown to the upper chest, with the face filling the panel, head level, eyes toward camera, and maximum readable facial and hair detail.",
      ...PHOTOREAL_REFERENCE_RULES,
    ],
  },
  "identity-board-v1": {
    id: "identity-board-v1",
    label: "Photoreal identity board",
    description: "Multi-angle body, portrait, and identity-detail views.",
    generation: { aspectRatio: "16:9", imageSize: "1K" },
    instructions: [
      "Create one comprehensive horizontal photographic character identity board on one uninterrupted continuous neutral-gray studio field. Organize the views with clean spacing only and no borders, frames, divider lines, gutters, separate cells, tonal blocks, or visible seams.",
      "Include complete head-to-toe front, side-profile, and rear views; one large tight front-facing identity portrait; and a useful elevated or top-down body view when it can be rendered without distortion.",
      "Include a restrained row of close detail crops selected only from visible identity information in the source, such as hair, eyes, skin texture, facial hair, tattoos, piercings, scars, jewelry, hands, footwear, or distinctive garment construction. Never invent a detail to fill a slot.",
      "Give the full-body views consistent scale and camera height. Allocate more pixels to the identity portrait than to any single detail crop, and keep every crop cleanly separated without decorative framing.",
      ...PHOTOREAL_REFERENCE_RULES,
    ],
  },
  "standard-v1": {
    id: "standard-v1",
    label: "Legacy turnaround reference",
    description: "Original multi-view profile retained for rollback.",
    instructions: [
      "Create a clean production character reference sheet from the character in the base image.",
      "Treat the base image as the source of truth for identity. Preserve the same face, age, body proportions, skin or fur, hair, wardrobe, silhouette, colors, materials, and defining accessories; do not redesign the character.",
      "Arrange consistent, well-spaced panels showing a neutral full-body front view, three-quarter view, side view, and back view, plus useful head and defining-detail closeups when space permits.",
      "Keep the character at a consistent scale with an orthographic or low-distortion presentation, complete uncropped anatomy, a plain neutral background, and even neutral lighting.",
      "Remove scene storytelling and decorative props that are not part of the character. Do not add captions, logos, measurements, or other text unless requested.",
    ],
  },
  "expressions-v1": {
    id: "expressions-v1",
    label: "Expression reference sheet",
    description: "Consistent head views and a range of readable expressions.",
    generation: { aspectRatio: "4:3", imageSize: "1K" },
    instructions: [
      "Create a clean production expression reference sheet from the character in the base image.",
      "Treat the base image as the source of truth for identity. Preserve facial structure, age, skin or fur, hair, eye design, markings, colors, and defining accessories in every panel; do not redesign the character.",
      "Arrange evenly sized head-and-shoulder panels with a neutral expression plus a useful range of clearly differentiated emotions and three-quarter or profile views.",
      "Keep camera distance, head scale, rendering, wardrobe visibility, background, and neutral lighting consistent across all panels.",
      ...PHOTOREAL_REFERENCE_RULES,
    ],
  },
};

export function listCharacterReferenceProfiles() {
  return Object.keys(CHARACTER_REFERENCE_PROFILES);
}

export function getCharacterReferenceProfile(profileId?: string) {
  return CHARACTER_REFERENCE_PROFILES[profileId || DEFAULT_CHARACTER_REFERENCE_PROFILE];
}

export function buildCharacterReferencePrompt(userDirection: string, profileId?: string) {
  const profile = getCharacterReferenceProfile(profileId);
  if (!profile) {
    throw new Error(`Unknown character reference profile: ${profileId}`);
  }

  const lines = [
    `Studio skill: Character Reference (${profile.id})`,
    "",
    ...profile.instructions.map((instruction) => `- ${instruction}`),
  ];
  const direction = userDirection.trim();
  if (direction) {
    lines.push("", "Additional direction:", direction);
  }
  return lines.join("\n");
}

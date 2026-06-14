export type ReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type StrengthBand = "trace" | "subtle" | "standard" | "strong" | "locked";

export type ReferenceStrength = {
  value: number;
  band: StrengthBand;
  strengthLabel: string;
  intent: string;
};

export function normalizeStrength(value: unknown, fallback = 50): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function getStrengthBand(value: unknown): StrengthBand {
  const strength = normalizeStrength(value);
  if (strength <= 15) return "trace";
  if (strength <= 35) return "subtle";
  if (strength <= 65) return "standard";
  if (strength <= 85) return "strong";
  return "locked";
}

export function describeReferenceStrength(value: unknown, role: ReferenceRole): ReferenceStrength {
  const strength = normalizeStrength(value);
  const band = getStrengthBand(strength);

  const roleIntent: Record<ReferenceRole, Record<StrengthBand, string>> = {
    SUBJECT: {
      trace: "Treat as a faint subject cue only. Borrow broad category or mood; do not copy exact identity, pose, wardrobe, or silhouette unless the user prompt asks for it.",
      subtle: "Use as light subject inspiration. Keep the generated subject flexible while borrowing a few recognizable traits, materials, colors, or proportions.",
      standard: "Use as the main subject reference. Preserve the important identity, object shape, wardrobe, proportions, and distinguishing details while adapting naturally to the final scene.",
      strong: "Closely follow the subject reference. Keep identity, silhouette, pose language, wardrobe, materials, colors, and key details stable unless they conflict with the user prompt.",
      locked: "Prioritize the subject reference as near-locked. Preserve identity and core visible details as faithfully as possible while still integrating it into one coherent generated image."
    },
    SCENE: {
      trace: "Treat as faint environment context only. Borrow atmosphere or broad setting type; do not reproduce the exact layout.",
      subtle: "Use as light scene inspiration. Borrow some setting, prop, lighting, or composition cues without forcing the exact space.",
      standard: "Use as the main scene reference. Preserve the important environment, layout, props, lighting direction, scale, and spatial relationships.",
      strong: "Closely follow the scene reference. Keep composition, set geometry, prop placement, lighting, and camera feel stable unless the user prompt overrides them.",
      locked: "Prioritize the scene reference as near-locked. Preserve layout, perspective, lighting, and major set details as faithfully as possible while integrating all subjects naturally."
    },
    STYLE: {
      trace: "Treat as a faint style cue only. Borrow a slight color, texture, or mood influence; do not copy content.",
      subtle: "Use as light visual styling. Add modest color, texture, lens, rendering, or mood influence while keeping the image mostly governed by the subject and scene.",
      standard: "Use as the main style reference. Apply its color palette, lighting quality, lens/rendering character, texture, and mood without copying its depicted content.",
      strong: "Strongly apply the visual style. Make color, lighting, lens/rendering, texture, and mood visibly dominant while keeping subject and scene content intact.",
      locked: "Prioritize the style reference as near-locked for visual treatment. Match its palette, contrast, lighting, lens/rendering, texture, and mood as closely as possible without copying content."
    },
    UNASSIGNED: {
      trace: "Treat as a faint reference cue only.",
      subtle: "Use as light reference inspiration only.",
      standard: "Use as a general reference with balanced influence.",
      strong: "Use as a strong general reference.",
      locked: "Use as a near-locked general reference where it does not conflict with assigned roles."
    }
  };

  const strengthLabel: Record<StrengthBand, string> = {
    trace: "trace",
    subtle: "subtle",
    standard: "standard",
    strong: "strong",
    locked: "locked"
  };

  return {
    value: strength,
    band,
    strengthLabel: strengthLabel[band],
    intent: roleIntent[role]?.[band] || roleIntent.UNASSIGNED[band]
  };
}

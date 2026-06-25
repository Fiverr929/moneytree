export type ReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type StrengthBand = "maxImprovise" | "improvise" | "faithful" | "expressive" | "maxExpressive";

export type SemanticType = "character" | "object" | "environment" | "aesthetic";

export type ReferenceStrength = {
  value: number;
  uiValue: number;
  band: StrengthBand;
  strengthLabel: string;
  controlAxis: string;
  priority: string;
  intent: string;
  contract: string;
};

function labelForBand(role: ReferenceRole, band: StrengthBand): string {
  const generic: Record<StrengthBand, string> = {
    maxImprovise: "locked",
    improvise: "slight",
    faithful: "balanced",
    expressive: "expressive",
    maxExpressive: "max express"
  };

  if (role === "STYLE") {
    return {
      maxImprovise: "subtle",
      improvise: "light",
      faithful: "balanced",
      expressive: "strong",
      maxExpressive: "max strong"
    }[band];
  }

  return generic[band];
}

const SEMANTIC_DICTIONARY: Record<string, SemanticType> = {
  // Living Subjects / Characters
  model: "character", character: "character", person: "character", actor: "character",
  man: "character", woman: "character", boy: "character", girl: "character",
  warrior: "character", hero: "character", ninja: "character", wizard: "character",
  dog: "character", cat: "character", animal: "character", creature: "character",
  face: "character", portrait: "character", subject: "character", detective: "character",

  // Environments / Scene Sets
  bg: "environment", background: "environment", room: "environment", street: "environment",
  city: "environment", house: "environment", forest: "environment", landscape: "environment",
  set: "environment", layout: "environment", composition: "environment", scene: "environment",
  view: "environment", place: "environment", location: "environment", environment: "environment",

  // Styles / Aesthetics
  style: "aesthetic", mood: "aesthetic", color: "aesthetic", palette: "aesthetic",
  lighting: "aesthetic", sketch: "aesthetic", paint: "aesthetic", watercolor: "aesthetic",
  texture: "aesthetic", render: "aesthetic", vibe: "aesthetic", aesthetic: "aesthetic",
  photo: "aesthetic", medium: "aesthetic", tone: "aesthetic"
};

export function classifyLabel(label: string): SemanticType {
  const tokens = label.toLowerCase().split(/[\s_-]+/);
  for (const token of tokens) {
    if (SEMANTIC_DICTIONARY[token]) {
      return SEMANTIC_DICTIONARY[token];
    }
  }
  return "object";
}

export function normalizeStrength(value: unknown, fallback = 50): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function getStrengthBand(value: unknown): StrengthBand {
  const strength = normalizeStrength(value);
  if (strength <= 15) return "maxImprovise";
  if (strength <= 35) return "improvise";
  if (strength <= 65) return "faithful";
  if (strength <= 85) return "expressive";
  return "maxExpressive";
}

export function describeReferenceStrength(value: unknown, role: ReferenceRole, label = "UNASSIGNED"): ReferenceStrength {
  const strength = normalizeStrength(value);
  const uiValue = strength - 50;
  const band = getStrengthBand(strength);
  const semantic = classifyLabel(label);

  const roleIntent: Record<ReferenceRole, Record<StrengthBand, string>> = {
    SUBJECT: {
      maxImprovise: "Pose locked. Preserve the subject almost exactly as shown.",
      improvise: "Small pose freedom. Keep the subject mostly as shown with only minor natural pose/expression changes.",
      faithful: "Moderate pose freedom. Keep the same subject while allowing a natural pose/expression/action shift.",
      expressive: "Strong pose freedom. Keep the same subject while allowing a clear pose/action change.",
      maxExpressive: "Maximum pose freedom. Keep the same subject while allowing a dramatic pose/action change."
    },
    SCENE: {
      maxImprovise: "Locked view. Preserve the same camera view, framing, and visible scene anchors.",
      improvise: "Small reframe. Keep the same scene anchors with only a slight crop, lens, height, or framing change.",
      faithful: "Balanced reframe. Keep the same scene anchors while changing the camera position modestly.",
      expressive: "New shot. Recompose the view while keeping the same event, location, and visible anchors recognizable.",
      maxExpressive: "Strong new shot. Use a clearly different shot angle, but only within what can be inferred from the reference."
    },
    STYLE: {
      maxImprovise: "Subtle style transfer. Borrow only a light touch of palette or finish.",
      improvise: "Light style transfer. Apply some palette, lighting mood, or surface texture.",
      faithful: "Balanced style transfer. Apply the visual treatment without copying content.",
      expressive: "Strong style transfer. Make the rendering medium, palette, texture, and finish clearly visible.",
      maxExpressive: "Maximum style transfer. Let the rendering treatment dominate while still ignoring content and background."
    },
    UNASSIGNED: {
      maxImprovise: "Minimal reference control.",
      improvise: "Light reference control.",
      faithful: "Balanced reference control.",
      expressive: "Strong reference control.",
      maxExpressive: "Maximum reference control."
    }
  };

  if (role === "SUBJECT" && semantic === "object") {
    roleIntent.SUBJECT.maxImprovise = "Object locked. Preserve the object almost exactly as shown.";
    roleIntent.SUBJECT.improvise = "Small arrangement freedom. Keep the object mostly as shown with only minor orientation/placement changes.";
    roleIntent.SUBJECT.faithful = "Moderate arrangement freedom. Keep the same object while allowing a natural orientation/placement shift.";
    roleIntent.SUBJECT.expressive = "Strong arrangement freedom. Keep the same object while allowing a clear orientation/placement change.";
    roleIntent.SUBJECT.maxExpressive = "Maximum arrangement freedom. Keep the same object while allowing a dramatic orientation/placement change.";
  }

  const priority: Record<StrengthBand, string> = {
    maxImprovise: "locked",
    improvise: "slight",
    faithful: "medium",
    expressive: "high",
    maxExpressive: "maximum"
  };

  const controlAxis: Record<ReferenceRole, string> = {
    SUBJECT: semantic === "character" ? "pose/expression/action freedom" : "orientation/placement freedom",
    SCENE: "scene reframe/new-shot freedom",
    STYLE: "style intensity",
    UNASSIGNED: "general reference intensity"
  };

  const subjectLockedTarget = semantic === "character"
    ? "identity, anatomy, face, body type, wardrobe, materials, and distinctive details"
    : "object type, shape, structure, proportions, materials, textures, and distinctive details";

  const subjectVariation: Record<StrengthBand, string> = {
    maxImprovise: "Do not meaningfully change pose/action; preserve the source posture and silhouette.",
    improvise: "Allow only small pose/expression/orientation adjustments.",
    faithful: "Allow a natural pose/expression/orientation change, but keep the same subject.",
    expressive: "Allow a clear pose/action/orientation change, but keep the same subject.",
    maxExpressive: "Allow a dramatic pose/action/orientation change, but keep the same subject."
  };

  const sceneVariation: Record<StrengthBand, string> = {
    maxImprovise: "Keep the same camera view and composition.",
    improvise: "Allow a slight reframe, crop, lens, or camera-height change.",
    faithful: "Allow a modest new camera position while keeping the same visible anchors.",
    expressive: "Allow a new shot angle while keeping the same event, location, and key anchors recognizable.",
    maxExpressive: "Allow a strong new shot angle, but do not invent unseen geometry beyond what the reference supports."
  };

  const styleVariation: Record<StrengthBand, string> = {
    maxImprovise: "Apply only a subtle touch of palette or finish.",
    improvise: "Apply light palette, lighting mood, texture, or medium cues.",
    faithful: "Apply a balanced amount of rendering medium, palette, texture, and finish.",
    expressive: "Apply a strong rendering treatment, palette, texture, and finish.",
    maxExpressive: "Apply the strongest rendering treatment, palette, texture, and finish."
  };

  const contract: Record<ReferenceRole, string> = {
    SUBJECT: `Lock ${subjectLockedTarget}. Strength controls only ${controlAxis.SUBJECT}. ${subjectVariation[band]} Do not redesign what the subject is, and do not use the subject image background as a scene unless no Scene image exists and the task asks to keep it.`,
    SCENE: `Use this only as the stage/environment source. ${sceneVariation[band]} Preserve the same environment, background, event, scale, lighting direction, and key visible anchors. Do not redesign the location or invent a different event.`,
    STYLE: `Use this only for visual treatment. Strength controls only ${controlAxis.STYLE}. ${styleVariation[band]} Ignore depicted objects, people, background, layout, and scene content; those belong to Subject and Scene modules.`,
    UNASSIGNED: `Use this only as supporting reference context. Strength controls ${controlAxis.UNASSIGNED}. Do not let it override active Subject, Scene, or Style modules.`
  };

  return {
    value: strength,
    uiValue,
    band,
    strengthLabel: labelForBand(role, band),
    controlAxis: controlAxis[role],
    priority: priority[band],
    intent: roleIntent[role]?.[band] || roleIntent.UNASSIGNED[band],
    contract: contract[role]
  };
}

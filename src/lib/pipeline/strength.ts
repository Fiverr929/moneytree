export type ReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type StrengthBand = "maxImprovise" | "improvise" | "faithful" | "expressive" | "maxExpressive";
export type ReferenceInfluence = "FREE" | "LOOSE" | "BALANCED" | "CLOSE" | "LOCKED";

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
    improvise: "close",
    faithful: "balanced",
    expressive: "loose",
    maxExpressive: "express"
  };

  if (role === "STYLE") {
    return {
      maxImprovise: "locked",
      improvise: "close",
      faithful: "balanced",
      expressive: "loose",
      maxExpressive: "express"
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

export function getReferenceInfluence(value: unknown): ReferenceInfluence {
  const band = getStrengthBand(value);
  const influenceByBand: Record<StrengthBand, ReferenceInfluence> = {
    maxImprovise: "LOCKED",
    improvise: "CLOSE",
    faithful: "BALANCED",
    expressive: "LOOSE",
    maxExpressive: "FREE",
  };
  return influenceByBand[band];
}

export function describeReferenceStrength(value: unknown, role: ReferenceRole, label = "UNASSIGNED"): ReferenceStrength {
  const strength = normalizeStrength(value);
  const uiValue = strength - 50;
  const band = getStrengthBand(strength);
  const semantic = classifyLabel(label);

  const roleIntent: Record<ReferenceRole, Record<StrengthBand, string>> = {
    SUBJECT: {
      maxImprovise: "Locked subject reference. Match the subject, pose, expression, wardrobe, and visible details as closely as possible.",
      improvise: "Close subject reference. Preserve the subject very closely, including posture and silhouette unless the user asks for a change.",
      faithful: "Balanced subject reference. Preserve the subject closely while allowing a modest pose or expression adjustment.",
      expressive: "Light subject reference. Preserve identity/type and distinctive details with natural pose or expression freedom.",
      maxExpressive: "Loose subject reference. Preserve identity/type and distinctive details while allowing a new pose or action."
    },
    SCENE: {
      maxImprovise: "Locked scene reference. Match the same camera view, composition, lighting, background, and visible anchors as closely as possible.",
      improvise: "Close scene reference. Preserve the camera view, framing, lighting direction, and key anchors closely.",
      faithful: "Balanced scene reference. Preserve the same event and anchors with only a natural camera adjustment.",
      expressive: "Light scene reference. Preserve the location and key anchors while allowing a modest reframe.",
      maxExpressive: "Loose scene reference. Preserve the environment idea while allowing a new camera view."
    },
    STYLE: {
      maxImprovise: "Locked style treatment. Apply the strongest rendering treatment, palette, texture, and finish.",
      improvise: "Close style treatment. Make the rendering medium, palette, texture, and finish clearly visible.",
      faithful: "Balanced style transfer. Apply the visual treatment without copying content.",
      expressive: "Light style transfer. Apply some palette, lighting mood, or surface texture.",
      maxExpressive: "Free style transfer. Borrow only a light touch of palette or finish."
    },
    UNASSIGNED: {
      maxImprovise: "Locked reference control.",
      improvise: "Close reference control.",
      faithful: "Balanced reference control.",
      expressive: "Loose reference control.",
      maxExpressive: "Free reference control."
    }
  };

  if (role === "SUBJECT" && semantic === "object") {
    roleIntent.SUBJECT.maxImprovise = "Locked object reference. Match the object shape, orientation, placement, materials, and visible details as closely as possible.";
    roleIntent.SUBJECT.improvise = "Close object reference. Preserve the object very closely unless the user asks for a change.";
    roleIntent.SUBJECT.faithful = "Balanced object reference. Preserve the object closely while allowing a modest orientation or placement adjustment.";
    roleIntent.SUBJECT.expressive = "Light object reference. Preserve object type and distinctive details with minor placement freedom.";
    roleIntent.SUBJECT.maxExpressive = "Loose object reference. Preserve object type and distinctive details while allowing new placement.";
  }

  const priority: Record<StrengthBand, string> = {
    maxImprovise: "maximum",
    improvise: "high",
    faithful: "medium",
    expressive: "slight",
    maxExpressive: "free"
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
    maxImprovise: "Match posture, expression, silhouette, orientation, placement, wardrobe, materials, and visible details as closely as possible.",
    improvise: "Preserve posture, expression, silhouette, orientation, and placement closely unless the user asks to change one of them.",
    faithful: "Allow only a modest pose, expression, orientation, or placement adjustment.",
    expressive: "Allow natural pose, expression, action, orientation, or placement changes while keeping the subject recognizable.",
    maxExpressive: "Pose, expression, action, orientation, and placement may change to fit the requested task."
  };

  const sceneVariation: Record<StrengthBand, string> = {
    maxImprovise: "Match the camera view, composition, background, lighting direction, scale, and visible anchors as closely as possible.",
    improvise: "Preserve the camera view, framing, composition, and key anchors closely unless the user asks to change them.",
    faithful: "Allow only a natural camera adjustment while keeping the same visible anchors.",
    expressive: "Allow a modest reframe, crop, lens, or camera-height change while keeping the location recognizable.",
    maxExpressive: "Camera view, crop, framing, and layout may change to fit the requested task."
  };

  const styleVariation: Record<StrengthBand, string> = {
    maxImprovise: "Apply the strongest rendering treatment, palette, texture, and finish.",
    improvise: "Apply a strong rendering treatment, palette, texture, and finish.",
    faithful: "Apply a balanced amount of rendering medium, palette, texture, and finish.",
    expressive: "Apply light palette, lighting mood, texture, or medium cues.",
    maxExpressive: "Apply only a subtle touch of palette or finish."
  };

  const contract: Record<ReferenceRole, string> = {
    SUBJECT: `Preserve ${subjectLockedTarget}. ${subjectVariation[band]} Do not redesign what the subject is, and do not use the subject image background as a scene unless no Scene image exists and the task asks to keep it.`,
    SCENE: `Use this only as the stage/environment source. ${sceneVariation[band]} Preserve the same environment, background, event, scale, lighting direction, and key visible anchors. Do not redesign the location or invent a different event.`,
    STYLE: `Use this only for visual treatment. ${styleVariation[band]} Ignore depicted objects, people, background, layout, and scene content; those belong to Subject and Scene modules.`,
    UNASSIGNED: `Use this only as supporting reference context. Do not let it override active Subject, Scene, or Style modules.`
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

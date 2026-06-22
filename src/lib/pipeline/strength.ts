export type ReferenceRole = "SUBJECT" | "SCENE" | "STYLE" | "UNASSIGNED";

export type StrengthBand = "maxImprovise" | "improvise" | "faithful" | "expressive" | "maxExpressive";

export type SemanticType = "character" | "object" | "environment" | "aesthetic";

export type ReferenceStrength = {
  value: number;
  uiValue: number;
  band: StrengthBand;
  strengthLabel: string;
  intent: string;
};

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
      maxImprovise: "Loose character inspiration. Improvise freely on wardrobe, details, and features.",
      improvise: "Flexible character reference. Keep identity, wardrobe, and details loose.",
      faithful: "Faithful character reference. Replicate identity and wardrobe details.",
      expressive: "High character fidelity. Match identity/wardrobe exactly; vary pose/expression/action per Task.",
      maxExpressive: "Strict character lock. Replicate identity and wardrobe perfectly; vary pose/expression/action per Task."
    },
    SCENE: {
      maxImprovise: "Loose layout cue. Change composition, layout, and perspective freely.",
      improvise: "Flexible layout. Borrow environment/lighting, but do not force layout details.",
      faithful: "Faithful scene. Replicate layout, perspective, and composition.",
      expressive: "High fidelity. Match composition, set geometry, and perspective closely.",
      maxExpressive: "Strict lock. Replicate exact composition, camera perspective, and layout."
    },
    STYLE: {
      maxImprovise: "Loose style cue. Borrow minor color/lighting; style is mostly open.",
      improvise: "Flexible style. Apply general color palette and medium style.",
      faithful: "Faithful style. Replicate medium, rendering, and palette.",
      expressive: "High fidelity. Match style, texture, and color palette dominantly.",
      maxExpressive: "Strict lock. Replicate exact aesthetic, rendering medium, and color palette."
    },
    UNASSIGNED: {
      maxImprovise: "Loose reference cue.",
      improvise: "Flexible reference inspiration.",
      faithful: "Balanced general reference.",
      expressive: "High fidelity general reference.",
      maxExpressive: "Near-locked general reference."
    }
  };

  if (role === "SUBJECT" && semantic === "object") {
    roleIntent.SUBJECT.maxImprovise = "Loose object inspiration. Improvise freely on shape, texture, and details.";
    roleIntent.SUBJECT.improvise = "Flexible object reference. Keep shape and details loose.";
    roleIntent.SUBJECT.faithful = "Faithful object reference. Replicate shape and details.";
    roleIntent.SUBJECT.expressive = "High object fidelity. Match shape, texture, and details very closely.";
    roleIntent.SUBJECT.maxExpressive = "Strict object lock. Replicate shape, structure, and textures perfectly.";
  }

  const strengthLabel: Record<StrengthBand, string> = {
    maxImprovise: "max improvise",
    improvise: "improvise",
    faithful: "faithful",
    expressive: "expressive",
    maxExpressive: "max precise"
  };

  return {
    value: strength,
    uiValue,
    band,
    strengthLabel: strengthLabel[band],
    intent: roleIntent[role]?.[band] || roleIntent.UNASSIGNED[band]
  };
}

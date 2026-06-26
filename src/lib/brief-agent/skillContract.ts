import type { BriefDraft, BriefSkillCheck, BriefReferenceRole, ReferenceObservation } from "./types";

export const BRIEF_AGENT_SKILL_CONTRACT = {
  roles: {
    SUBJECT: {
      owns: ["main subject identity/type", "shape", "wardrobe/materials", "distinctive details"],
      mayChange: ["pose", "expression", "action", "orientation"],
      mustNotProvide: ["environment", "background", "rendering style"],
    },
    SCENE: {
      owns: ["environment", "background", "camera", "layout", "perspective", "framing", "lighting direction"],
      mayChange: ["crop", "framing", "lens feel", "layout emphasis"],
      mustNotProvide: ["main subject identity", "wardrobe", "rendering style"],
    },
    STYLE: {
      owns: ["medium", "palette", "texture", "lighting mood", "finish"],
      mayChange: ["rendering intensity"],
      mustNotProvide: ["objects", "people", "background", "composition", "camera layout"],
    },
  },
  strength: {
    meaning: "Strength controls only the active module role axis.",
    SUBJECT: "pose/action/orientation flexibility",
    SCENE: "framing/crop/lens/layout flexibility",
    STYLE: "rendering intensity",
    never: "Strength is never permission to remix the whole image or overwrite unrelated roles.",
  },
  failureModes: [
    "Style reference becomes background, objects, people, or composition.",
    "Subject identity/type changes when only pose/action should change.",
    "Subject background becomes the scene.",
    "Scene reference imports or invents a main subject.",
    "Strength changes unrelated roles.",
  ],
} as const;

function roleSet(observations: ReferenceObservation[]) {
  return new Set(observations.map((observation) => observation.role));
}

function labelsFor(observations: ReferenceObservation[], role: BriefReferenceRole) {
  return observations
    .filter((observation) => observation.role === role)
    .map((observation) => observation.label)
    .join(", ");
}

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function constraintsFor(observations: ReferenceObservation[]) {
  const roles = roleSet(observations);
  const constraints: string[] = [];

  if (roles.has("SUBJECT")) {
    constraints.push(
      `Subject constraint: preserve identity/type, shape, wardrobe/materials, and distinctive details from ${labelsFor(observations, "SUBJECT")}; only change pose/action/orientation when requested.`,
    );
  }

  if (roles.has("SCENE")) {
    constraints.push(
      `Scene constraint: use ${labelsFor(observations, "SCENE")} only for environment/background/camera/layout/framing; do not use it to define the main subject.`,
    );
  }

  if (roles.has("STYLE")) {
    constraints.push(
      `Style constraint: use ${labelsFor(observations, "STYLE")} only for medium, palette, texture, lighting mood, and finish; do not copy its objects, people, background, composition, or camera layout.`,
    );
  }

  return constraints;
}

export function compileFinalPrompt(finalPrompt: string, observations: ReferenceObservation[]) {
  const prompt = finalPrompt.trim();
  const constraints = constraintsFor(observations);
  if (!prompt || !constraints.length) return prompt;

  const missing = constraints.filter((constraint) => !prompt.includes(constraint));
  return missing.length ? [prompt, "", ...missing].join("\n") : prompt;
}

export function runSkillChecks(draft: BriefDraft): BriefSkillCheck[] {
  if (!draft.finalPrompt.trim()) return [];

  const checks: BriefSkillCheck[] = [];
  const prompt = draft.finalPrompt;
  const roles = roleSet(draft.observations);

  if (roles.has("SUBJECT")) {
    checks.push({
      id: "subject-preserve",
      status: includesAny(prompt, ["identity", "identity/type", "distinctive", "wardrobe", "shape"]) ? "pass" : "repaired",
      message: "Subject identity/type preservation is stated.",
    });
  }

  if (roles.has("SCENE")) {
    checks.push({
      id: "scene-boundary",
      status: includesAny(prompt, ["environment", "background", "camera", "layout", "framing", "scene"]) ? "pass" : "repaired",
      message: "Scene is constrained to environment/camera/layout responsibilities.",
    });
  }

  if (roles.has("STYLE")) {
    const hasStyleBoundary = includesAny(prompt, ["do not copy", "do not import", "objects", "people", "background", "composition"]);
    checks.push({
      id: "style-boundary",
      status: hasStyleBoundary ? "pass" : "repaired",
      message: "Style is constrained to rendering treatment, not content/background/composition.",
    });
  }

  if (roles.has("STYLE") && /\b(style|palette|texture|finish)\b[\s\S]{0,80}\b(background|object|person|composition)\b/i.test(prompt)) {
    checks.push({
      id: "style-bleed-risk",
      status: "warning",
      message: "Review style wording for content bleed risk.",
    });
  }

  return checks;
}

export function applySkillContract(draft: BriefDraft): BriefDraft {
  if (!draft.finalPrompt.trim()) {
    return {
      ...draft,
      skillChecks: runSkillChecks(draft),
    };
  }

  const compiledPrompt = compileFinalPrompt(draft.finalPrompt, draft.observations);
  const repairedDraft = {
    ...draft,
    finalPrompt: compiledPrompt,
  };
  const skillChecks = runSkillChecks(repairedDraft);
  const repairWarnings = skillChecks
    .filter((check) => check.status === "repaired" || check.status === "warning")
    .map((check) => `Skill check ${check.status}: ${check.message}`);

  return {
    ...repairedDraft,
    warnings: Array.from(new Set([...draft.warnings, ...repairWarnings])),
    skillChecks,
  };
}

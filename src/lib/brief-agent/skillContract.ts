import type { BriefDraft, BriefSkillCheck, ReferenceObservation } from "./types";

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
  influence: {
    meaning: "Influence controls how strongly each reference participates in the composed final prompt.",
    SUBJECT: "subject identity, form, pose, material, markings, wardrobe, or object design participation",
    SCENE: "environment, camera feel, layout, background, lighting direction, scale, and spatial relationship participation",
    STYLE: "rendering treatment, palette, texture, medium, contrast, lighting mood, and finish participation",
    never: "Influence is never a word to mention in the final prompt and never permission to let one role overwrite another role.",
  },
  failureModes: [
    "Style reference becomes background, objects, people, or composition.",
    "Subject identity/type changes when only pose/action should change.",
    "Subject background becomes the scene.",
    "Scene reference imports or invents a main subject.",
    "Influence changes unrelated roles.",
  ],
} as const;

function roleSet(observations: ReferenceObservation[]) {
  return new Set(observations.map((observation) => observation.role));
}

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export function runSkillChecks(draft: BriefDraft): BriefSkillCheck[] {
  if (!draft.finalPrompt.trim()) return [];

  const checks: BriefSkillCheck[] = [];
  const prompt = draft.finalPrompt;
  const roles = roleSet(draft.observations);

  if (roles.has("SUBJECT")) {
    checks.push({
      id: "subject-preserve",
      status: includesAny(prompt, ["identity", "identity/type", "distinctive", "wardrobe", "shape"]) ? "pass" : "warning",
      message: "Subject identity/type preservation is stated.",
    });
  }

  if (draft.observations.length) {
    checks.push({
      id: "reference-directives",
      status: includesAny(prompt, ["Preserve", "Match", "Use this only", "Reference Image", "For "]) ? "pass" : "warning",
      message: "Reference handling is expressed as concrete visual instructions.",
    });
  }

  if (roles.has("SCENE")) {
    checks.push({
      id: "scene-boundary",
      status: includesAny(prompt, ["environment", "background", "camera", "layout", "framing", "scene"]) ? "pass" : "warning",
      message: "Scene is constrained to environment/camera/layout responsibilities.",
    });
  }

  if (roles.has("STYLE")) {
    const hasStyleBoundary = includesAny(prompt, ["do not copy", "do not import", "objects", "people", "background", "composition"]);
    checks.push({
      id: "style-boundary",
      status: hasStyleBoundary ? "pass" : "warning",
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
  const skillChecks = runSkillChecks(draft);
  const repairWarnings = skillChecks
    .filter((check) => check.status === "warning")
    .map((check) => `Skill check warning: ${check.message}`);

  return {
    ...draft,
    warnings: Array.from(new Set([...draft.warnings, ...repairWarnings])),
    skillChecks,
  };
}

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

const UI_MECHANICS_PATTERN = /\b(influence|slider|strength|control axis|percentage|\d{1,3}\s*%)\b/i;
const PROMPT_METADATA_PATTERN = /(?:^|\n)\s*(?:SUBJECT|SCENE|STYLE|UNASSIGNED|Reference Image\s*\d*)\s*:/i;
const EVIDENCE_STOP_WORDS = new Set([
  "about", "after", "against", "along", "black", "close", "from", "into", "narrow",
  "photo", "photograph", "reference", "showing", "single", "soft", "their", "there", "these",
  "this", "through", "using", "visible", "where", "which", "white", "with",
]);

function evidenceTerms(observation: ReferenceObservation) {
  return `${observation.label} ${observation.visualRead}`
    .toLowerCase()
    .match(/[a-z][a-z-]{3,}/g)
    ?.filter((term) => !EVIDENCE_STOP_WORDS.has(term))
    .slice(0, 24) || [];
}

function carriesEvidence(prompt: string, observation: ReferenceObservation) {
  const lower = prompt.toLowerCase();
  return evidenceTerms(observation).some((term) => lower.includes(term));
}

export function runSkillChecks(draft: BriefDraft): BriefSkillCheck[] {
  if (!draft.finalPrompt.trim()) return [];

  const checks: BriefSkillCheck[] = [];
  const prompt = draft.finalPrompt;
  const roles = roleSet(draft.observations);

  checks.push({
    id: "prompt-hygiene",
    status: UI_MECHANICS_PATTERN.test(prompt) ? "warning" : "pass",
    message: "Final prompt excludes reference-control UI mechanics.",
  });

  checks.push({
    id: "prompt-coherence",
    status: PROMPT_METADATA_PATTERN.test(prompt) ? "warning" : "pass",
    message: "Final prompt reads as one visual brief rather than module metadata.",
  });

  const highCommitmentReferences = draft.observations.filter((observation) => {
    // strength.ts maps 0..35 to LOCKED/CLOSE. Keep this check dependency-free
    // so the deterministic skill test can run directly in Node.
    return observation.strength <= 35;
  });
  if (highCommitmentReferences.length) {
    checks.push({
      id: "reference-grounding",
      status: highCommitmentReferences.every((observation) => carriesEvidence(prompt, observation)) ? "pass" : "warning",
      message: "Close and locked references contribute visible evidence to the prompt.",
    });
  }

  if (roles.has("SUBJECT") && roles.has("SCENE")) {
    const ownedReferences = draft.observations.filter(
      (observation) => observation.role === "SUBJECT" || observation.role === "SCENE",
    );
    checks.push({
      id: "subject-scene-coverage",
      status: ownedReferences.every((observation) => carriesEvidence(prompt, observation)) ? "pass" : "warning",
      message: "The prompt grounds both subject and scene without swapping their roles.",
    });
  }

  if (prompt.length > 2_800) {
    checks.push({
      id: "prompt-focus",
      status: "warning",
      message: "The generation brief may be too long to keep a clear visual hierarchy.",
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

import type {
  BriefReferenceRole,
  BriefReferenceSnapshot,
  ReferenceObservation,
  VisualRoleUnderstanding,
  VisualUnderstanding,
} from "./types";

function unique(items: string[], limit = 10) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function observationsForRole(observations: ReferenceObservation[], role: BriefReferenceRole) {
  return observations.filter((observation) => observation.role === role);
}

function buildRoleUnderstanding(
  observations: ReferenceObservation[],
  role: BriefReferenceRole,
): VisualRoleUnderstanding {
  const roleObservations = observationsForRole(observations, role);
  return {
    present: roleObservations.length > 0,
    labels: unique(roleObservations.map((observation) => observation.label), 8),
    facts: unique(roleObservations.map((observation) => observation.visualRead), 12),
    anchors: [],
    allowedChanges: [],
    avoid: [],
  };
}

function buildContinuity(understanding: Omit<VisualUnderstanding, "id" | "createdAt" | "sourceFingerprint" | "continuity" | "uncertainties">) {
  const anchors = unique([
    ...understanding.subject.anchors.map((anchor) => `Subject: ${anchor}`),
    ...understanding.scene.anchors.map((anchor) => `Scene: ${anchor}`),
    ...understanding.style.anchors.map((anchor) => `Style: ${anchor}`),
  ], 18);

  const changeBoundaries = unique([
    ...understanding.subject.avoid.map((item) => `Subject uncertainty: ${item}`),
    ...understanding.scene.avoid.map((item) => `Scene uncertainty: ${item}`),
    ...understanding.style.avoid.map((item) => `Style uncertainty: ${item}`),
  ], 18);

  const storySignals = unique([
    ...understanding.subject.facts.map((item) => `Subject visible cue: ${item}`),
    ...understanding.scene.facts.map((item) => `Scene visible cue: ${item}`),
    ...understanding.style.facts.map((item) => `Style visible cue: ${item}`),
  ], 12);

  return { anchors, changeBoundaries, storySignals };
}

function buildUncertainties(understanding: Omit<VisualUnderstanding, "id" | "createdAt" | "sourceFingerprint" | "continuity" | "uncertainties">) {
  const uncertainties: string[] = [];
  if (!understanding.subject.present) {
    uncertainties.push("No SUBJECT reference is active, so subject identity must come from the user instruction or remain generic.");
  }
  if (!understanding.scene.present) {
    uncertainties.push("No SCENE reference is active, so environment, camera, and layout should not be invented unless the user asks for them.");
  }
  if (!understanding.style.present) {
    uncertainties.push("No STYLE reference is active, so rendering treatment should stay neutral unless the user describes a style.");
  }
  if (understanding.unassigned.present) {
    uncertainties.push("Some references are UNASSIGNED and should support the plan without overriding SUBJECT, SCENE, or STYLE.");
  }
  return uncertainties;
}

export function createVisualUnderstanding(snapshot: BriefReferenceSnapshot): VisualUnderstanding {
  const roles = {
    subject: buildRoleUnderstanding(snapshot.observations, "SUBJECT"),
    scene: buildRoleUnderstanding(snapshot.observations, "SCENE"),
    style: buildRoleUnderstanding(snapshot.observations, "STYLE"),
    unassigned: buildRoleUnderstanding(snapshot.observations, "UNASSIGNED"),
  };
  return {
    id: `visual-understanding-${snapshot.createdAt}`,
    createdAt: new Date().toISOString(),
    sourceFingerprint: snapshot.sourceFingerprint,
    ...roles,
    continuity: buildContinuity(roles),
    uncertainties: buildUncertainties(roles),
  };
}

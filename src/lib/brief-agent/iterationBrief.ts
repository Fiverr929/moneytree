import type {
  GenerationUserFeedback,
} from "@/context/GalleryContext";
import type { IterationBrief, IterationConstraint, IterationConstraintKind } from "./types";

export function emptyIterationBrief(projectId: number): IterationBrief {
  return {
    projectId,
    anchorGenerationId: null,
    parentGenerationId: null,
    keep: [],
    change: [],
    avoid: [],
    rejectedGenerationIds: [],
    selectedDirection: null,
    decisionAnswers: [],
    referenceFingerprint: null,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

function constraint(kind: IterationConstraintKind, text: string, generationId: string): IterationConstraint {
  return {
    id: crypto.randomUUID(),
    kind,
    text,
    source: "feedback",
    sourceGenerationIds: [generationId],
    confidence: "explicit",
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export function applyGenerationFeedback(
  current: IterationBrief,
  generationId: string,
  feedback: GenerationUserFeedback,
) {
  const withoutPriorFeedback = (items: IterationConstraint[]) => items.filter((item) => !(
    item.source === "feedback" && item.sourceGenerationIds.includes(generationId)
  ));
  const next: IterationBrief = {
    ...current,
    keep: [...withoutPriorFeedback(current.keep), ...feedback.keep.map((text) => constraint("keep", text, generationId))],
    change: [...withoutPriorFeedback(current.change), ...feedback.change.map((text) => constraint("change", text, generationId))],
    avoid: withoutPriorFeedback(current.avoid),
    rejectedGenerationIds: feedback.reaction === "dislike"
      ? Array.from(new Set([...current.rejectedGenerationIds, generationId]))
      : current.rejectedGenerationIds.filter((id) => id !== generationId),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  if (feedback.note.trim()) {
    const kind: IterationConstraintKind = feedback.reaction === "dislike" ? "avoid" : feedback.reaction === "mixed" ? "change" : "keep";
    next[kind] = [...next[kind], constraint(kind, feedback.note.trim(), generationId)];
  }
  return next;
}

export function setIterationAnchor(current: IterationBrief, generationId: string | null) {
  return {
    ...current,
    anchorGenerationId: generationId,
    parentGenerationId: generationId,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function iterationPreflight(input: {
  brief: IterationBrief | null;
  availableGenerationIds: string[];
  referenceFingerprint: string;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const anchor = input.brief?.anchorGenerationId;
  if (anchor && !input.availableGenerationIds.includes(anchor)) errors.push("The active anchor is unavailable in this project.");
  if (input.brief?.referenceFingerprint && input.brief.referenceFingerprint !== input.referenceFingerprint) {
    warnings.push("References changed after the iteration brief was last confirmed.");
  }
  if (anchor && input.brief?.rejectedGenerationIds.includes(anchor)) errors.push("The active anchor is also marked as rejected.");
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const keep = new Set((input.brief?.keep || []).filter((item) => item.status !== "superseded").map((item) => normalize(item.text)));
  const conflicts = [...(input.brief?.change || []), ...(input.brief?.avoid || [])]
    .filter((item) => item.status !== "superseded" && keep.has(normalize(item.text)));
  if (conflicts.length) errors.push(`Resolve conflicting iteration guidance before generating: ${conflicts.map((item) => item.text).join(", ")}.`);
  return { ok: errors.length === 0, errors, warnings };
}

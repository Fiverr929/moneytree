"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useGallery,
  type FeedbackAspect,
  type GenerationReaction,
  type GenerationUserFeedback,
} from "@/context/GalleryContext";

type AspectState = "keep" | "change" | null;

const REACTIONS: Array<{ value: GenerationReaction; label: string }> = [
  { value: "like", label: "Like" },
  { value: "mixed", label: "Mixed" },
  { value: "dislike", label: "Dislike" },
];

const ASPECTS: Array<{ value: FeedbackAspect; label: string }> = [
  { value: "subject", label: "Subject" },
  { value: "composition", label: "Composition" },
  { value: "lighting", label: "Lighting" },
  { value: "color", label: "Color" },
  { value: "style", label: "Style" },
  { value: "details", label: "Details" },
  { value: "text", label: "Text" },
  { value: "quality", label: "Quality" },
];

const REACTION_SCORE = { like: 5, mixed: 3, dislike: 1 } as const;

export default function EvaluationDialog() {
  const {
    cells,
    evaluationTargetId,
    evaluationQueueLength,
    closeEvaluationQueue,
    skipEvaluation,
    saveEvaluation,
  } = useGallery();
  
  const target = useMemo(
    () => cells.find((cell) => cell.id === evaluationTargetId),
    [cells, evaluationTargetId],
  );

  const [reaction, setReaction] = useState<GenerationReaction | null>(null);
  const [aspects, setAspects] = useState<Partial<Record<FeedbackAspect, AspectState>>>({});
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const feedback = target?.evaluation?.userFeedback;
    setReaction(feedback?.reaction || null);
    setAspects(Object.fromEntries([
      ...(feedback?.keep || []).map((aspect) => [aspect, "keep"] as const),
      ...(feedback?.change || []).map((aspect) => [aspect, "change"] as const),
    ]));
    setComment(feedback?.note || target?.evaluation?.comment || "");
  }, [target?.id, target?.evaluation]);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEvaluationQueue();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeEvaluationQueue, target]);

  if (!target || evaluationTargetId === null) return null;

  const canSave = Boolean(reaction);

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const score = REACTION_SCORE[reaction!];
      const userFeedback: GenerationUserFeedback = {
        reaction: reaction!,
        keep: ASPECTS.filter(({ value }) => aspects[value] === "keep").map(({ value }) => value),
        change: ASPECTS.filter(({ value }) => aspects[value] === "change").map(({ value }) => value),
        note: comment.trim(),
      };
      await saveEvaluation(target.id, {
        promptMatch: target.evaluation?.promptMatch || score,
        subjectMatch: target.evaluation?.subjectMatch || score,
        sceneMatch: target.evaluation?.sceneMatch || score,
        styleMatch: target.evaluation?.styleMatch || score,
        qualityMatch: target.evaluation?.qualityMatch || score,
        comment: userFeedback.note,
        summary: target.evaluation?.summary,
        issues: target.evaluation?.issues,
        suggestions: target.evaluation?.suggestions,
        evaluatedAt: new Date().toISOString(),
        reviewSource: target.evaluation?.reviewSource || "manual",
        reviewModel: target.evaluation?.reviewModel,
        userFeedback,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="evaluation-modal" className="open" onClick={(event) => {
      if (event.target === event.currentTarget) closeEvaluationQueue();
    }}>
      <div className="evaluation-panel" role="dialog" aria-modal="true" aria-labelledby="evaluation-title">
        <div className="evaluation-header">
          <span id="evaluation-title">Generation feedback</span>
          <button type="button" title="Rate later" aria-label="Rate later" onClick={closeEvaluationQueue}>&times;</button>
        </div>
        <div className="evaluation-body">
          <img className="evaluation-image" src={target.imgUrl} alt="Generation to evaluate" />
          <div className="evaluation-content">
            <div className="evaluation-meta">
              <span>{target.pipelineVersion || "legacy-unversioned"}</span>
              {target.evaluation?.reviewSource === "ai" && <span>AI review available</span>}
              <span>{evaluationQueueLength} pending</span>
            </div>
            <div className="evaluation-question">What is your overall reaction?</div>
            <div className="evaluation-reactions">
              {REACTIONS.map((option) => (
                <button
                  type="button"
                  className={reaction === option.value ? `active ${option.value}` : ""}
                  key={option.value}
                  onClick={() => setReaction(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="evaluation-question">
              What stood out?
              <small>Click once to keep, twice to change.</small>
            </div>
            <div className="evaluation-aspects">
              {ASPECTS.map((aspect) => {
                const state = aspects[aspect.value] || null;
                return (
                  <button
                    type="button"
                    className={state || ""}
                    key={aspect.value}
                    onClick={() => setAspects((current) => ({
                      ...current,
                      [aspect.value]: state === null ? "keep" : state === "keep" ? "change" : null,
                    }))}
                  >
                    <span>{state === "keep" ? "+" : state === "change" ? "−" : ""}</span>
                    {aspect.label}
                  </button>
                );
              })}
            </div>
            <label className="evaluation-comment">
              <span>Optional note</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="What should the agent preserve or change?"
              />
            </label>
          </div>
        </div>
        <div className="evaluation-actions">
          <button type="button" onClick={() => skipEvaluation(target.id)}>Skip</button>
          <button type="button" className="primary" disabled={!canSave || saving} onClick={handleSave}>
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

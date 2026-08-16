"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useGallery,
  type GenerationReaction,
  type GenerationUserFeedback,
} from "@/context/GalleryContext";

const REACTIONS: Array<{ value: GenerationReaction; label: string }> = [
  { value: "like", label: "Good" },
  { value: "mixed", label: "Okay" },
  { value: "dislike", label: "Needs work" },
];

const REACTION_SCORE = { like: 5, mixed: 3, dislike: 1 } as const;

export default function EvaluationDialog() {
  const {
    cells,
    evaluationTargetId,
    evaluationQueueLength,
    closeEvaluationQueue,
    saveEvaluation,
  } = useGallery();
  
  const target = useMemo(
    () => cells.find((cell) => cell.id === evaluationTargetId),
    [cells, evaluationTargetId],
  );

  const [reaction, setReaction] = useState<GenerationReaction | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const feedback = target?.evaluation?.userFeedback;
    setReaction(feedback?.reaction || null);
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

  const handleRating = async (nextReaction: GenerationReaction) => {
    if (saving) return;
    setReaction(nextReaction);
    setSaving(true);
    try {
      const score = REACTION_SCORE[nextReaction];
      const previousFeedback = target.evaluation?.userFeedback;
      const userFeedback: GenerationUserFeedback = {
        reaction: nextReaction,
        keep: previousFeedback?.keep || [],
        change: previousFeedback?.change || [],
        note: previousFeedback?.note || target.evaluation?.comment || "",
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
            <div className="evaluation-question">How did this generation turn out?</div>
            <div className="evaluation-reactions">
              {REACTIONS.map((option) => (
                <button
                  type="button"
                  className={reaction === option.value ? `active ${option.value}` : ""}
                  key={option.value}
                  disabled={saving}
                  onClick={() => void handleRating(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

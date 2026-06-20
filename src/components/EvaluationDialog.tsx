"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useGallery, type EvaluationScore } from "@/context/GalleryContext";

type ScoreKey = "taskMatch" | "subjectMatch" | "labelMatch" | "strengthMatch";
type DraftScores = Record<ScoreKey, EvaluationScore | null>;

const SCORE_LABELS: Array<{ key: ScoreKey; label: string }> = [
  { key: "taskMatch", label: "Task match" },
  { key: "subjectMatch", label: "Subject match" },
  { key: "labelMatch", label: "Label match" },
  { key: "strengthMatch", label: "Strength match" },
];

function hasMeaningfulLabel(labels: Array<string | undefined>) {
  return labels.some((label) => {
    const value = String(label || "").trim().toUpperCase();
    return value && value !== "UNLABELED" && value !== "UNASSIGNED";
  });
}

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
  const labelAvailable = hasMeaningfulLabel(target?.usedImages?.map((image) => image.label) || []);
  const [scores, setScores] = useState<DraftScores>({
    taskMatch: null,
    subjectMatch: null,
    labelMatch: null,
    strengthMatch: null,
  });
  const [comment, setComment] = useState("");
  const [labelNotApplicable, setLabelNotApplicable] = useState(!labelAvailable);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScores({
      taskMatch: target?.evaluation?.taskMatch ?? null,
      subjectMatch: target?.evaluation?.subjectMatch ?? null,
      labelMatch: target?.evaluation?.labelMatch ?? null,
      strengthMatch: target?.evaluation?.strengthMatch ?? null,
    });
    setComment(target?.evaluation?.comment || "");
    setLabelNotApplicable(!labelAvailable || Boolean(target?.evaluation && target.evaluation.labelMatch === null));
  }, [labelAvailable, target?.id, target?.evaluation]);

  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEvaluationQueue();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeEvaluationQueue, target]);

  if (!target || evaluationTargetId === null) return null;

  const canSave = Boolean(scores.taskMatch && scores.subjectMatch && scores.strengthMatch && (scores.labelMatch || labelNotApplicable));

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveEvaluation(target.id, {
        taskMatch: scores.taskMatch!,
        subjectMatch: scores.subjectMatch!,
        labelMatch: labelNotApplicable ? null : scores.labelMatch,
        strengthMatch: scores.strengthMatch!,
        comment: comment.trim(),
        evaluatedAt: new Date().toISOString(),
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
          <span id="evaluation-title">Evaluate generation</span>
          <button type="button" title="Rate later" aria-label="Rate later" onClick={closeEvaluationQueue}>&times;</button>
        </div>
        <div className="evaluation-body">
          <img className="evaluation-image" src={target.imgUrl} alt="Generation to evaluate" />
          <div className="evaluation-content">
            <div className="evaluation-meta">
              <span>{target.pipelineVersion || "legacy-unversioned"}</span>
              <span>{evaluationQueueLength} pending</span>
            </div>
            {SCORE_LABELS.map(({ key, label }) => (
              <div className="evaluation-row" key={key}>
                <span>{label}</span>
                <div className="evaluation-score-options">
                  {([1, 2, 3, 4, 5] as EvaluationScore[]).map((score) => (
                    <button
                      type="button"
                      className={scores[key] === score ? "active" : ""}
                      key={score}
                      onClick={() => {
                        setScores((current) => ({ ...current, [key]: score }));
                        if (key === "labelMatch") setLabelNotApplicable(false);
                      }}
                    >
                      {score}
                    </button>
                  ))}
                  {key === "labelMatch" && (
                    <button
                      type="button"
                      className={labelNotApplicable ? "active na" : "na"}
                      onClick={() => {
                        setLabelNotApplicable(true);
                        setScores((current) => ({ ...current, labelMatch: null }));
                      }}
                    >
                      N/A
                    </button>
                  )}
                </div>
              </div>
            ))}
            <label className="evaluation-comment">
              <span>Comment</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="What translated well or failed?"
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
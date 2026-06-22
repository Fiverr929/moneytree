"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useGallery, type EvaluationScore } from "@/context/GalleryContext";

type ScoreKey = "promptMatch" | "subjectMatch" | "sceneMatch" | "styleMatch" | "qualityMatch";
type DraftScores = Record<ScoreKey, EvaluationScore | null>;

const SCORE_LABELS: Array<{ key: ScoreKey; label: string }> = [
  { key: "promptMatch", label: "Prompt match" },
  { key: "subjectMatch", label: "Subject match" },
  { key: "sceneMatch", label: "Scene match" },
  { key: "styleMatch", label: "Style match" },
  { key: "qualityMatch", label: "Visual quality" },
];

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

  const [scores, setScores] = useState<DraftScores>({
    promptMatch: null,
    subjectMatch: null,
    sceneMatch: null,
    styleMatch: null,
    qualityMatch: null,
  });
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScores({
      promptMatch: target?.evaluation?.promptMatch ?? null,
      subjectMatch: target?.evaluation?.subjectMatch ?? null,
      sceneMatch: target?.evaluation?.sceneMatch ?? null,
      styleMatch: target?.evaluation?.styleMatch ?? null,
      qualityMatch: target?.evaluation?.qualityMatch ?? null,
    });
    setComment(target?.evaluation?.comment || "");
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

  const canSave = Boolean(
    scores.promptMatch &&
    scores.subjectMatch &&
    scores.sceneMatch &&
    scores.styleMatch &&
    scores.qualityMatch
  );

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await saveEvaluation(target.id, {
        promptMatch: scores.promptMatch!,
        subjectMatch: scores.subjectMatch!,
        sceneMatch: scores.sceneMatch!,
        styleMatch: scores.styleMatch!,
        qualityMatch: scores.qualityMatch!,
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
                      }}
                    >
                      {score}
                    </button>
                  ))}
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

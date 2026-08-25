"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useGallery,
  type GenerationReaction,
  type FeedbackAspect,
  type GenerationUserFeedback,
} from "@/context/GalleryContext";

const REACTIONS: Array<{ value: GenerationReaction; label: string; description: string }> = [
  { value: "like", label: "Nailed it", description: "Use this direction again" },
  { value: "mixed", label: "Close", description: "Keep the idea, refine details" },
  { value: "dislike", label: "Try again", description: "Change direction next time" },
];

const REACTION_SCORE = { like: 5, mixed: 3, dislike: 1 } as const;
const FEEDBACK_ASPECTS: FeedbackAspect[] = ["subject", "composition", "lighting", "color", "style", "details", "text", "quality"];

export default function EvaluationDialog() {
  const {
    cells,
    evaluationTargetId,
    evaluationQueueLength,
    closeEvaluationQueue,
    saveEvaluation,
    iterationBrief,
    setGenerationAnchor,
  } = useGallery();
  
  const target = useMemo(
    () => cells.find((cell) => cell.id === evaluationTargetId),
    [cells, evaluationTargetId],
  );

  const [reaction, setReaction] = useState<GenerationReaction | null>(null);
  const [keep, setKeep] = useState<FeedbackAspect[]>([]);
  const [change, setChange] = useState<FeedbackAspect[]>([]);
  const [note, setNote] = useState("");
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const feedback = target?.evaluation?.userFeedback;
    setReaction(feedback?.reaction || null);
    setKeep(feedback?.keep || []);
    setChange(feedback?.change || []);
    setNote(feedback?.note || target?.evaluation?.comment || "");
    setRemember(feedback?.remember || false);
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

  const handleSave = async () => {
    if (saving || !reaction) return;
    setSaving(true);
    try {
      const score = REACTION_SCORE[reaction];
      const userFeedback: GenerationUserFeedback = {
        reaction,
        keep,
        change,
        note: note.trim(),
        remember,
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

  const generationId = target.uuid || String(target.id);
  const anchored = iterationBrief?.anchorGenerationId === generationId;
  const toggleAspect = (
    aspect: FeedbackAspect,
    list: FeedbackAspect[],
    setList: React.Dispatch<React.SetStateAction<FeedbackAspect[]>>,
    setOther: React.Dispatch<React.SetStateAction<FeedbackAspect[]>>,
  ) => {
    setList(list.includes(aspect) ? list.filter((item) => item !== aspect) : [...list, aspect]);
    setOther((items) => items.filter((item) => item !== aspect));
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
            <div className="evaluation-question">What should the agent learn from this?</div>
            <div className="evaluation-reactions">
              {REACTIONS.map((option) => (
                <button
                  type="button"
                  className={reaction === option.value ? `active ${option.value}` : ""}
                  key={option.value}
                  disabled={saving}
                  onClick={() => setReaction(option.value)}
                >
                  <span className="evaluation-reaction-label">{option.label}</span>
                  <span className="evaluation-reaction-description">{option.description}</span>
                </button>
              ))}
            </div>
            <div className="evaluation-aspect-group">
              <span>Keep</span>
              <div className="evaluation-aspects">
                {FEEDBACK_ASPECTS.map((aspect) => <button type="button" className={keep.includes(aspect) ? "active keep" : ""} key={`keep-${aspect}`} onClick={() => toggleAspect(aspect, keep, setKeep, setChange)}>{aspect}</button>)}
              </div>
            </div>
            <div className="evaluation-aspect-group">
              <span>Change</span>
              <div className="evaluation-aspects">
                {FEEDBACK_ASPECTS.map((aspect) => <button type="button" className={change.includes(aspect) ? "active change" : ""} key={`change-${aspect}`} onClick={() => toggleAspect(aspect, change, setChange, setKeep)}>{aspect}</button>)}
              </div>
            </div>
            <label className="evaluation-note">
              <span>Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should stay or change?" />
            </label>
            <label className="evaluation-remember">
              <input type="checkbox" checked={remember} disabled={!note.trim()} onChange={(event) => setRemember(event.target.checked)} />
              <span>Remember this note as a project preference</span>
            </label>
            {(target.evaluation?.summary || target.evaluation?.issues?.length || target.evaluation?.suggestions?.length) && (
              <details className="evaluation-analysis">
                <summary>Automated analysis</summary>
                {target.evaluation.summary && <p>{target.evaluation.summary}</p>}
                {target.evaluation.issues?.map((issue) => <p key={`issue-${issue}`}>Issue · {issue}</p>)}
                {target.evaluation.suggestions?.map((suggestion) => <p key={`suggestion-${suggestion}`}>Suggestion · {suggestion}</p>)}
              </details>
            )}
            <div className="evaluation-controls">
              <button type="button" className={anchored ? "active" : ""} disabled={saving} onClick={() => void setGenerationAnchor(anchored ? null : target.id)}>{anchored ? "ANCHOR ACTIVE" : "USE AS ANCHOR"}</button>
              <button type="button" disabled={saving || !reaction} onClick={() => void handleSave()}>{saving ? "SAVING…" : "SAVE FEEDBACK"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

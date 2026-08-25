"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  activeDecisionQuestions,
  decisionAnswersText,
  updateDecisionAnswer,
} from "@/lib/brief-agent/decisionFlow";
import type { AgentDecisionAnswer, AgentDecisionFlow } from "@/lib/brief-agent/types";

export default function AgentDecisionFlowCard({
  flow,
  currentReferenceFingerprint,
  disabled,
  onSubmit,
}: {
  flow: AgentDecisionFlow;
  currentReferenceFingerprint: string;
  disabled: boolean;
  onSubmit: (answers: AgentDecisionAnswer[], text: string) => void;
}) {
  const [answers, setAnswers] = useState<AgentDecisionAnswer[]>(flow.answers || []);
  const [index, setIndex] = useState(0);
  const [customValue, setCustomValue] = useState("");
  const submittingRef = useRef(false);
  const questions = useMemo(() => activeDecisionQuestions(flow, answers), [answers, flow]);
  const safeIndex = Math.min(index, Math.max(questions.length - 1, 0));
  const question = questions[safeIndex];
  const answer = answers.find((item) => item.questionId === question?.id);
  const stale = flow.status === "stale" || flow.sourceFingerprint !== currentReferenceFingerprint;
  const submitted = flow.status === "submitted";

  if (submitted) {
    return (
      <div className="agent-decision-summary" aria-label="Submitted decision answers">
        <span>SELECTED</span>
        {(flow.answers || []).map((item) => <strong key={item.questionId}>{item.value}</strong>)}
      </div>
    );
  }

  if (!question) return null;

  const choose = (optionId: string | null, value: string, custom: boolean) => {
    const next = updateDecisionAnswer(flow, answers, { questionId: question.id, optionId, value, custom });
    setAnswers(next);
    setCustomValue(custom ? value : "");
  };

  const complete = answers.length === questions.length && questions.every((item) => answers.some((answerItem) => answerItem.questionId === item.id && answerItem.value.trim()));

  return (
    <section className={`agent-decision-flow${stale ? " stale" : ""}`} aria-label={flow.title}>
      <div className="agent-decision-head">
        <strong>{flow.title}</strong>
        <span>QUESTION {safeIndex + 1} OF {questions.length}</span>
      </div>
      {stale ? (
        <p className="agent-decision-warning">References changed. Ask the agent again to refresh these choices.</p>
      ) : (
        <>
          <p className="agent-decision-prompt">{question.prompt}</p>
          {question.options.length > 0 && (
            <div className="agent-decision-options">
              {question.options.map((option, optionIndex) => (
                <button
                  type="button"
                  key={option.id}
                  className={answer?.optionId === option.id ? "active" : ""}
                  disabled={disabled}
                  onClick={() => choose(option.id, option.label, false)}
                >
                  <span>{optionIndex + 1}</span>
                  <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                </button>
              ))}
            </div>
          )}
          {question.allowCustom && (
            <label className="agent-decision-custom">
              <span>Custom response</span>
              <textarea
                value={answer?.custom ? answer.value : customValue}
                disabled={disabled}
                placeholder="Describe the direction you want…"
                onChange={(event) => {
                  setCustomValue(event.target.value);
                  choose(null, event.target.value, true);
                }}
              />
            </label>
          )}
          <div className="agent-decision-controls">
            <button type="button" disabled={safeIndex === 0 || disabled} onClick={() => setIndex((value) => Math.max(0, value - 1))}>BACK</button>
            {safeIndex < questions.length - 1 ? (
              <button type="button" disabled={!answer?.value.trim() || disabled} onClick={() => setIndex((value) => value + 1)}>NEXT</button>
            ) : (
              <button
                type="button"
                disabled={!complete || disabled}
                onClick={() => {
                  if (submittingRef.current) return;
                  submittingRef.current = true;
                  onSubmit(answers, decisionAnswersText(flow, answers));
                }}
              >CONTINUE</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

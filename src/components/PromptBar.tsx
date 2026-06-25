"use client";

import React, { useState, useEffect, useRef, useMemo, KeyboardEvent } from "react";
import { useApp } from "@/context/AppContext";
import { MODELS, useSettings } from "@/context/SettingsContext";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useModule } from "@/context/ModuleContext";
import { generate, storeGenerationDebug } from "@/lib/pipeline/api";
import { collectPayload } from "@/lib/pipeline/prompt-builder";
import {
  createMockBriefDraft,
  createReferenceSnapshot,
  fingerprintModuleFiles,
} from "@/lib/brief-agent/mockPlanner";
import { requestBriefAgent } from "@/lib/brief-agent/client";
import type { AgentMessage } from "@/lib/brief-agent/types";

const PROMPT_DRAFT_STORAGE_KEY = "cafehtml-prompt-draft";

export default function PromptBar() {
  const { activeProjectId } = useApp();
  const settings = useSettings();
  const gallery = useGallery();
  const moduleContext = useModule();
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [generationError, setGenerationError] = useState("");
  
  // Prompt settings state
  const [frameRatio, setFrameRatio] = useState("1:1");
  const [frameVar, setFrameVar] = useState<string | number>("1");
  
  // Prompt Input state
  const [promptText, setPromptText] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftProjectId, setDraftProjectId] = useState<number | null>(null);
  const [agentConsoleOpen, setAgentConsoleOpen] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentPending, setAgentPending] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [referenceSnapshot, setReferenceSnapshot] = useState(() => createReferenceSnapshot([]));
  const inputRef = useRef<HTMLDivElement>(null);
  const promptBarRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (promptBarRef.current && !promptBarRef.current.contains(e.target as Node)) {
        setAgentConsoleOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("agent-console-open", agentConsoleOpen);
    return () => document.body.classList.remove("agent-console-open");
  }, [agentConsoleOpen]);

  // Sync state from custom events (like HUD reuse)
  useEffect(() => {
    const handleSetPrompt = (e: Event) => {
      const ce = e as CustomEvent;
      if (typeof ce.detail === "string") {
        setPromptText(ce.detail);
      }
    };
    window.addEventListener("set-prompt", handleSetPrompt);
    return () => window.removeEventListener("set-prompt", handleSetPrompt);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("__cafeLastGenerationDebug");
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, []);

  // Sync React state back to DOM for contentEditable without jumping cursor
  useEffect(() => {
    if (inputRef.current && inputRef.current.textContent !== promptText) {
      inputRef.current.textContent = promptText;
    }
  }, [promptText]);

  useEffect(() => {
    setDraftProjectId(null);
    setGenerationError("");
    setAgentMessages([]);
    setAgentError("");
    try {
      const savedDraft = window.localStorage.getItem(`${PROMPT_DRAFT_STORAGE_KEY}:${activeProjectId || "none"}`);
      setPromptText(savedDraft || "");
    } catch {
      setPromptText("");
      // Ignore storage access issues in embedded browsers.
    }
    setDraftProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || draftProjectId !== activeProjectId) return;
    try {
      window.localStorage.setItem(`${PROMPT_DRAFT_STORAGE_KEY}:${activeProjectId}`, promptText);
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [activeProjectId, draftProjectId, promptText]);

  const handleGenerate = async () => {
    if (!activeProjectId) return;
    const trimmed = promptText.trim();
    if (!trimmed && moduleContext.files.length === 0) {
      setGenerationError("Add a prompt or at least one module image.");
      return;
    }
    setGenerationError("");
    if (trimmed && promptHistory[0] !== trimmed) {
      setPromptHistory([trimmed, ...promptHistory]);
    }
    setHistoryIndex(-1);

    const fullSettings = {
      ...settings,
      aspectRatio: frameRatio,
      variation: parseInt(frameVar.toString(), 10)
    };

    const payload = collectPayload(
      trimmed,
      moduleContext.files,
      fullSettings
    );

    const debugStartedAt = new Date().toISOString();
    const promptBarDebug = {
      status: 'promptbar-started',
      startedAt: debugStartedAt,
      updatedAt: debugStartedAt,
      source: 'PromptBar.handleGenerate',
      userPrompt: trimmed,
      rawPrompt: trimmed,
      payload,
      settings: {
        mode: "FRAME",
        aspectRatio: fullSettings.aspectRatio,
        variation: fullSettings.variation,
        activeModel: fullSettings.activeModel,
        activeResolution: fullSettings.activeResolution,
        activeThinkingLevel: fullSettings.activeThinkingLevel,
      },
      moduleFiles: moduleContext.files.map(({ url, ...file }) => ({
        ...file,
        hasImage: !!url,
      })),
    };
    storeGenerationDebug(promptBarDebug);

    setActiveGenerationCount((count) => count + 1);
    try {
      await generate(payload, fullSettings, {
        onStart: () => {},
        onLoadingIds: (ids) => {
          ids.forEach(id => gallery.addLoading(
            id,
            (payload.settings.aspectRatio || '1:1'),
            "FRAME",
            activeProjectId
          ));
        },
        onVariationReady: (dataUrl, lid, cellData) => {
          gallery.resolveLoading(lid, { ...cellData, project_id: activeProjectId || undefined } as GalleryCell);
        },
        onVariationBlocked: (lid, statusLabel) => {
          gallery.blockLoading(lid, statusLabel);
        },
        onVariationFailed: (lid, retryFn, statusLabel) => {
          gallery.failLoading(lid, retryFn, statusLabel);
        },
        onGenerationError: (ids, statusLabel) => {
          ids.forEach((id) => {
            if (statusLabel === "BLOCKED") gallery.blockLoading(id, statusLabel);
            else gallery.failLoading(id, undefined, statusLabel);
          });
        },
        onComplete: () => {},
        onError: (err) => {
          console.error('Generation Error:', err);
          setGenerationError(err.message || "Image generation failed.");
        }
      }, moduleContext.files);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed.";
      setGenerationError(message);
      console.error("Generation Error:", error);
    } finally {
      setActiveGenerationCount((count) => Math.max(0, count - 1));
    }
  };

  const referenceFingerprint = useMemo(
    () => fingerprintModuleFiles(moduleContext.files),
    [moduleContext.files],
  );

  useEffect(() => {
    setReferenceSnapshot((current) => {
      if (current.sourceFingerprint === referenceFingerprint) return current;
      return createReferenceSnapshot(moduleContext.files);
    });
  }, [moduleContext.files, referenceFingerprint]);

  const briefDraft = useMemo(
    () => createMockBriefDraft(referenceSnapshot, agentMessages),
    [referenceSnapshot, agentMessages],
  );

  const formatAgentTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--:--";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const submitAgentMessage = async () => {
    const trimmed = promptText.trim();
    if (!trimmed || agentPending) return;
    const createdAt = new Date().toISOString();
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      createdAt,
    };
    const nextUserMessages = [...agentMessages, userMessage];
    setAgentMessages(nextUserMessages);
    setAgentPending(true);
    setAgentError("");
    if (trimmed && promptHistory[0] !== trimmed) {
      setPromptHistory([trimmed, ...promptHistory]);
    }
    setHistoryIndex(-1);
    setPromptText("");
    try {
      const response = await requestBriefAgent({
        referenceSnapshot,
        messages: nextUserMessages,
      });
      setAgentMessages([...nextUserMessages, response.message]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Brief agent failed.";
      setAgentError(message);
      setAgentMessages([
        ...nextUserMessages,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `AGENT ERROR: ${message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setAgentPending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (agentConsoleOpen) void submitAgentMessage();
      else handleGenerate();
    } else if (e.key === "Escape") {
      setPromptText("");
      setHistoryIndex(-1);
      e.currentTarget.blur();
    } else if (e.key === "ArrowUp" && promptText.trim() === "") {
      e.preventDefault();
      if (historyIndex < promptHistory.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setPromptText(promptHistory[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const prevIdx = historyIndex - 1;
        setHistoryIndex(prevIdx);
        setPromptText(promptHistory[prevIdx]);
      } else {
        setHistoryIndex(-1);
        setPromptText("");
      }
    }
  };

  const placeholderText = "What are we making today?";
  const activeModuleCount = moduleContext.files.filter((file) => file.eye !== false && file.url && !file.folder).length;
  const newestMessages = [...agentMessages].reverse();

  return (
    <div className="prompt-bar" id="promptBar" data-state="FRAME" ref={promptBarRef}>
      <div className="prompt-bar-row">
        <button
          className="btn-upload-ref"
          id="moduleQuickUpload"
          type="button"
          title="Add module image"
          aria-label="Add module image"
          onClick={() => document.getElementById("mp-file-input")?.click()}
        ></button>
        
        <div className="settings-anchor" ref={dropdownRef}>
          <button
            className={`btn-settings ${dropdownOpen ? "open" : ""}`}
            id="settingsBtn"
            type="button"
            title="Image settings"
            aria-label="Image settings"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <img src="assets/icon-settings.svg" alt="settings" />
          </button>

          <div className="cmp-menu settings-dropdown" id="settingsDropdown" hidden={!dropdownOpen}>
            <div className="cmp-menu-title">MODEL</div>
            {Object.entries(MODELS).map(([modelKey, model]) => (
              <button
                key={modelKey}
                className={settings.activeModelKey === modelKey ? "primary" : ""}
                type="button"
                onClick={() => settings.setActiveModelKey(modelKey)}
              >
                <span>{model.label}</span>
              </button>
            ))}

            <div className="cmp-menu-title">ASPECT RATIO</div>
            {settings.activeModel.aspectRatios.map((ratio) => {
              const labels: Record<string, string> = {
                "1:1": "SQUARE",
                "16:9": "LANDSCAPE",
                "9:16": "PORTRAIT",
                "4:3": "LANDSCAPE",
                "3:4": "PORTRAIT",
              };
              return (
                <button
                  key={ratio}
                  className={frameRatio === ratio ? "primary" : ""}
                  type="button"
                  onClick={() => setFrameRatio(ratio)}
                >
                  <span>{ratio}</span>
                  <span>{labels[ratio]}</span>
                </button>
              );
            })}

            <div className="cmp-menu-title">RESOLUTION</div>
            {settings.activeModel.resolutions.length ? (
              <div className="image-settings-options">
                {settings.activeModel.resolutions.map((resolution) => (
                  <button
                    key={resolution}
                    className={settings.activeResolution === resolution ? "primary" : ""}
                    type="button"
                    onClick={() => settings.setActiveResolution(resolution)}
                  >
                    {resolution}
                  </button>
                ))}
              </div>
            ) : (
              <button className="primary" type="button">
                <span>DEFAULT</span>
              </button>
            )}

            {settings.activeModel.thinkingLevels && settings.activeModel.thinkingLevels.length > 0 && (
              <>
                <div className="cmp-menu-title">THINKING</div>
                <div className="image-settings-options">
                  {settings.activeModel.thinkingLevels.map((level) => (
                    <button
                      key={level}
                      className={settings.thinkingLevel === level ? "primary" : ""}
                      type="button"
                      onClick={() => settings.setThinkingLevel(level)}
                    >
                      {level.toUpperCase()}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="cmp-menu-title">VARIATIONS</div>
            <div className="image-settings-stepper">
              <button
                type="button"
                title="Decrease variations"
                disabled={parseInt(frameVar.toString(), 10) <= 1}
                onClick={() => {
                  const value = parseInt(frameVar.toString(), 10);
                  if (value > 1) setFrameVar(value - 1);
                }}
              >
                -
              </button>
              <span>
                {frameVar} IMAGE{parseInt(frameVar.toString(), 10) === 1 ? "" : "S"}
              </span>
              <button
                type="button"
                title="Increase variations"
                disabled={parseInt(frameVar.toString(), 10) >= 10}
                onClick={() => {
                  const value = parseInt(frameVar.toString(), 10);
                  if (value < 10) setFrameVar(value + 1);
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>

        {generationError && (
          <button
            className="prompt-inline-error"
            type="button"
            title={generationError}
            onClick={() => setGenerationError("")}
          >
            {generationError}
          </button>
        )}
        <div className="prompt-input-area">
          <div
            className={`prompt-text-field ${promptText === "" ? "has-placeholder" : ""}`}
            id="promptText"
            contentEditable="true"
            role="textbox"
            aria-label="Image prompt"
            data-placeholder={placeholderText}
            ref={inputRef}
            onFocus={() => setAgentConsoleOpen(true)}
            onClick={() => setAgentConsoleOpen(true)}
            onInput={(e) => setPromptText(e.currentTarget.textContent || "")}
            onKeyDown={handleKeyDown}
            suppressContentEditableWarning={true}
          ></div>
          <button
            className={`btn-frame ${activeGenerationCount > 0 ? 'cafe-loading' : ''}`}
            id="generateBtn"
            type="button"
            disabled={!activeProjectId}
            onClick={handleGenerate}
          >
            FRAME
          </button>
        </div>
      </div>
      <div className={`agent-console ${agentConsoleOpen ? "open" : ""}`} aria-hidden={!agentConsoleOpen}>
        <div className="agent-console-scroll">
          <div className="agent-section">
            <div className="agent-line">&gt; <mark>CAFE AGENT / BRIEF DRAFT</mark></div>
            <div className="agent-line">&gt; STATE: <mark>{briefDraft.status.toUpperCase()}</mark></div>
            <div className="agent-line">&gt; ROUTE: <mark>{agentPending ? "THINKING" : "CONNECTED / MOCK BRAIN"}</mark></div>
          </div>
          {promptText.trim() && (
            <div className="agent-section">
              <div className="agent-line">&gt; INPUT: {promptText.trim()}</div>
            </div>
          )}
          <div className="agent-section agent-transcript">
            <div className="agent-line">&gt; <mark>LATEST FIRST</mark></div>
            {newestMessages.length ? (
              newestMessages.map((message) => (
                <div className="agent-turn" key={message.id}>
                  <div className="agent-line">
                    &gt; <mark>{formatAgentTime(message.createdAt)} / {message.role.toUpperCase()}</mark>
                  </div>
                  {message.text.split("\n").map((line, index) => (
                    <div className="agent-line" key={`${message.id}-${index}`}>&gt; {line}</div>
                  ))}
                </div>
              ))
            ) : (
              <div className="agent-line agent-muted">&gt; NO CONVERSATION YET. TYPE A DIRECTION AND PRESS ENTER.</div>
            )}
            {agentPending && (
              <div className="agent-line agent-muted">&gt; WAITING FOR AGENT RESPONSE.</div>
            )}
            {agentError && (
              <div className="agent-line agent-muted">&gt; ERROR: <mark>{agentError}</mark></div>
            )}
          </div>
          <div className="agent-section agent-reference">
            <div className="agent-line">&gt; <mark>REFERENCE SNAPSHOT</mark></div>
            <div className="agent-line">&gt; READ ONCE: {formatAgentTime(referenceSnapshot.createdAt)} / {activeModuleCount} ACTIVE</div>
            {referenceSnapshot.observations.map((observation, index) => (
              <div className="agent-line" key={observation.imageId}>
                &gt; REF {index + 1}: <mark>{observation.role} / {observation.label}</mark> PRESERVE {observation.mustPreserve.join(", ")}.
              </div>
            ))}
          </div>
          <div className="agent-section">
            {briefDraft.clarification.needed && !newestMessages.length && (
              <>
                <div className="agent-line">&gt; CLARIFY: <mark>{briefDraft.clarification.reason}</mark></div>
                {briefDraft.clarification.questions.map((question, index) => (
                  <div className="agent-line" key={question}>&gt; Q{index + 1}: {question}</div>
                ))}
              </>
            )}
            <div className="agent-line">&gt; PLAN: <mark>{briefDraft.plan.intent}</mark></div>
            <div className="agent-line">&gt; SUBJECT: {briefDraft.plan.subjectPolicy}</div>
            <div className="agent-line">&gt; SCENE: {briefDraft.plan.scenePolicy}</div>
            <div className="agent-line">&gt; STYLE: {briefDraft.plan.stylePolicy}</div>
            {briefDraft.warnings.map((warning) => (
              <div className="agent-line agent-muted" key={warning}>&gt; WARNING: <mark>{warning}</mark></div>
            ))}
          </div>
          <div className="agent-section">
            <div className="agent-line">&gt; FINAL PROMPT:</div>
            {briefDraft.finalPrompt
              ? briefDraft.finalPrompt.split("\n").map((line, index) => (
                <div className="agent-line agent-muted" key={`${line}-${index}`}>&gt; {line}</div>
              ))
              : <div className="agent-line agent-muted">&gt; WAITING FOR CLARIFICATION.</div>}
            <div className="agent-line agent-muted">&gt; STATUS: <mark>AGENT ROUTE CONNECTED. MODEL BRAIN NOT CONNECTED YET.</mark></div>
          </div>
        </div>
      </div>
    </div>
  );
}





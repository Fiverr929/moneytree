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
import { requestBriefAgent, requestReferenceRead } from "@/lib/brief-agent/client";
import { applySkillContract } from "@/lib/brief-agent/skillContract";
import type { AgentMessage, BriefDraft, BriefReferenceImageInput, BriefReferenceRole, BriefReferenceSnapshot } from "@/lib/brief-agent/types";

const PROMPT_DRAFT_STORAGE_KEY = "cafehtml-prompt-draft";
const IMAGE_PROMPT_SETTINGS_KEY = "cafehtml-image-prompt-settings";
const REFERENCE_SNAPSHOT_CACHE_KEY = "cafehtml-brief-reference-cache-v1";
const REFERENCE_SNAPSHOT_CACHE_LIMIT = 20;
const GENERATE_COMMAND = "/Generate";
const DEFAULT_FRAME_RATIO = "1:1";
const DEFAULT_FRAME_VARIATIONS = 1;

type ReferenceSnapshotCacheEntry = {
  sourceFingerprint: string;
  snapshot: BriefReferenceSnapshot;
  model: string | null;
  cachedAt: string;
};

function readReferenceSnapshotCache(): ReferenceSnapshotCacheEntry[] {
  try {
    const raw = window.localStorage.getItem(REFERENCE_SNAPSHOT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findReferenceSnapshotCache(sourceFingerprint: string) {
  return readReferenceSnapshotCache().find((entry) => entry.sourceFingerprint === sourceFingerprint) || null;
}

function writeReferenceSnapshotCache(entry: ReferenceSnapshotCacheEntry) {
  try {
    const next = [
      entry,
      ...readReferenceSnapshotCache().filter((item) => item.sourceFingerprint !== entry.sourceFingerprint),
    ].slice(0, REFERENCE_SNAPSHOT_CACHE_LIMIT);
    window.localStorage.setItem(REFERENCE_SNAPSHOT_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage access issues in embedded browsers.
  }
}

function flattenPromptArtifact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function parseGenerateCommand(text: string) {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(/^\/generate(?:\s+|$)/i);
  if (!commandMatch) return null;
  return trimmed.slice(commandMatch[0].length).trim();
}

function normalizeFrameVariations(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FRAME_VARIATIONS;
  return Math.min(10, Math.max(1, Math.round(parsed)));
}

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
  const [frameRatio, setFrameRatio] = useState(DEFAULT_FRAME_RATIO);
  const [frameVar, setFrameVar] = useState<string | number>(String(DEFAULT_FRAME_VARIATIONS));
  const [imagePromptSettingsLoaded, setImagePromptSettingsLoaded] = useState(false);
  
  // Prompt Input state
  const [promptText, setPromptText] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draftProjectId, setDraftProjectId] = useState<number | null>(null);
  const [agentConsoleOpen, setAgentConsoleOpen] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentPending, setAgentPending] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentBrain, setAgentBrain] = useState<"model" | "mock">("mock");
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<BriefDraft | null>(null);
  const [referenceReadError, setReferenceReadError] = useState("");
  const [referenceReadModel, setReferenceReadModel] = useState<string | null>(null);
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IMAGE_PROMPT_SETTINGS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { frameRatio?: unknown; frameVar?: unknown };
        if (typeof saved.frameRatio === "string") {
          setFrameRatio(saved.frameRatio);
        }
        setFrameVar(String(normalizeFrameVariations(saved.frameVar)));
      }
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
    setImagePromptSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!imagePromptSettingsLoaded) return;
    try {
      window.localStorage.setItem(IMAGE_PROMPT_SETTINGS_KEY, JSON.stringify({
        frameRatio,
        frameVar: normalizeFrameVariations(frameVar),
      }));
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [frameRatio, frameVar, imagePromptSettingsLoaded]);

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
    setAgentBrain("mock");
    setAgentModel(null);
    setAgentDraft(null);
    setReferenceReadError("");
    setReferenceReadModel(null);
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
    const agentFinalPrompt = agentDraft?.finalPrompt.trim() || "";
    const commandPrompt = parseGenerateCommand(trimmed);
    if (agentPending) {
      setGenerationError("Wait for the agent response before framing.");
      return;
    }
    if (commandPrompt === null) {
      setGenerationError("Use /Generate to frame, or press Enter to talk to the agent.");
      return;
    }
    if (!commandPrompt) {
      setGenerationError("Add a prompt after /Generate.");
      return;
    }
    const executionPrompt = commandPrompt;
    const stagedPromptArtifact = findPromptArtifactByPrompt(executionPrompt);
    const executionSource = stagedPromptArtifact
      ? "agent-final-prompt"
      : "generate-command";
    if (!executionPrompt) {
      setGenerationError("Add a prompt after /Generate.");
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
      variation: parseInt(frameVar.toString(), 10),
      projectId: activeProjectId,
    };

    const payload = {
      ...collectPayload(
        executionPrompt,
        moduleContext.files,
        fullSettings
      ),
      executionSource,
      effectivePrompt: executionPrompt,
      agentDraft: stagedPromptArtifact
        ? {
          id: stagedPromptArtifact.sourceDraftId || agentDraft?.id || null,
          promptArtifactId: stagedPromptArtifact.id,
          sourceFingerprint: stagedPromptArtifact.sourceFingerprint || null,
          refCount: stagedPromptArtifact.refCount ?? null,
          brain: agentBrain,
          model: agentModel,
          skillChecks: agentDraft?.skillChecks || [],
          warnings: agentDraft?.warnings || [],
        }
        : null,
    };

    const debugStartedAt = new Date().toISOString();
    const promptBarDebug = {
      status: 'promptbar-started',
      startedAt: debugStartedAt,
      updatedAt: debugStartedAt,
      source: 'PromptBar.handleGenerate',
      executionSource,
      userPrompt: executionPrompt,
      rawPrompt: trimmed,
      agentFinalPrompt: agentFinalPrompt || null,
      agentBrain,
      agentModel,
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
    let cancelled = false;
    const fallbackSnapshot = createReferenceSnapshot(moduleContext.files);
    setReferenceSnapshot((current) => {
      if (current.sourceFingerprint === referenceFingerprint) return current;
      return fallbackSnapshot;
    });
    setAgentDraft(null);
    setReferenceReadError("");
    setReferenceReadModel(null);

    const images: BriefReferenceImageInput[] = moduleContext.files
      .filter((file) => file.eye !== false && file.url && !file.folder)
      .map((file) => {
        const role = String(file.mode || "").toUpperCase();
        return {
          imageId: file.uuid || String(file.id),
          role: role === "SUBJECT" || role === "SCENE" || role === "STYLE" ? role as BriefReferenceRole : "UNASSIGNED",
          label: file.label || file.name || "UNLABELED",
          strength: Number.isFinite(file.strength) ? file.strength : 0,
          dataUrl: file.url,
        };
      });

    if (!images.length) {
      return () => {
        cancelled = true;
      };
    }

    const cached = findReferenceSnapshotCache(referenceFingerprint);
    if (cached) {
      setReferenceSnapshot(cached.snapshot);
      setReferenceReadModel(cached.model);
      return () => {
        cancelled = true;
      };
    }

    requestReferenceRead({
      sourceFingerprint: referenceFingerprint,
      images,
    }).then((response) => {
      if (cancelled) return;
      setReferenceSnapshot(response.snapshot);
      setReferenceReadModel(response.model);
      writeReferenceSnapshotCache({
        sourceFingerprint: referenceFingerprint,
        snapshot: response.snapshot,
        model: response.model,
        cachedAt: new Date().toISOString(),
      });
    }).catch((error) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : "Reference reader failed.";
      setReferenceReadError(message);
      setReferenceSnapshot(fallbackSnapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [moduleContext.files, referenceFingerprint]);

  const formatAgentTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--:--";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const currentReferenceContext = (): NonNullable<AgentMessage["context"]> => ({
    refCount: activeModuleCount,
  });

  const formatMessageHeader = (message: AgentMessage) => {
    const parts = [formatAgentTime(message.createdAt), message.role.toUpperCase()];
    if (message.role === "agent" && message.context) {
      parts.push(
        `${message.context.refCount} REFS`,
      );
    }
    return parts.join(" / ");
  };

  function findPromptArtifactByPrompt(prompt: string) {
    const normalized = flattenPromptArtifact(prompt);
    return [...agentMessages].reverse().find((message) => (
      message.promptArtifact
      && flattenPromptArtifact(message.promptArtifact.prompt) === normalized
    ))?.promptArtifact || null;
  }

  const stagePromptArtifact = (artifact: NonNullable<AgentMessage["promptArtifact"]>) => {
    const text = artifact.prompt.trim();
    if (!text) return;
    setPromptText(`${GENERATE_COMMAND} ${flattenPromptArtifact(text)}`);
    setGenerationError(
      artifact.sourceFingerprint && artifact.sourceFingerprint !== referenceFingerprint
        ? "This prompt was drafted for an older reference set."
        : ""
    );
    requestAnimationFrame(() => inputRef.current?.focus());
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
    setAgentDraft(applySkillContract(createMockBriefDraft(referenceSnapshot, nextUserMessages)));
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
      setAgentBrain(response.brain);
      setAgentModel(response.model);
      setAgentDraft(response.draft);
      setAgentMessages([
        ...nextUserMessages,
        {
          ...response.message,
          context: currentReferenceContext(),
        },
      ]);
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
      if (parseGenerateCommand(promptText) !== null) void handleGenerate();
      else if (agentConsoleOpen) void submitAgentMessage();
      else {
        setAgentConsoleOpen(true);
        void submitAgentMessage();
      }
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
  const hasAgentFinalPrompt = !!agentDraft?.finalPrompt.trim();
  const stagedGeneratePrompt = parseGenerateCommand(promptText);
  const frameExecutionState = agentPending
    ? "WAITING FOR AGENT"
    : stagedGeneratePrompt !== null
    ? "READY: /GENERATE COMMAND"
    : hasAgentFinalPrompt
    ? "USE STAGES /GENERATE"
    : "TEXT GOES TO AGENT";
  const footerModelSummary = agentModel && referenceReadModel && agentModel !== referenceReadModel
    ? `PLANNER ${agentModel} / READER ${referenceReadModel}`
    : `MODEL ${agentModel || referenceReadModel || "NO MODEL"}`;

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
          <div className="agent-section agent-transcript">
            {newestMessages.length ? (
              newestMessages.map((message) => (
                <div className="agent-turn" key={message.id}>
                  <div className="agent-line">
                    &gt; <mark>{formatMessageHeader(message)}</mark>
                  </div>
                  {message.text.split("\n").map((line, index) => (
                    <div className="agent-line" key={`${message.id}-${index}`}>&gt; {line}</div>
                  ))}
                  {message.promptArtifact && (
                    <div className="agent-prompt-draft agent-turn-artifact">
                      <div className="agent-artifact-head">
                        <span>&gt; <mark>{message.promptArtifact.title}</mark></span>
                        <button type="button" onClick={() => stagePromptArtifact(message.promptArtifact!)}>USE</button>
                      </div>
                      <div className="agent-prompt-box">
                        {message.promptArtifact.prompt}
                      </div>
                      {message.promptArtifact.sourceFingerprint && message.promptArtifact.sourceFingerprint !== referenceFingerprint && (
                        <div className="agent-line agent-muted">&gt; REFS CHANGED SINCE THIS PROMPT.</div>
                      )}
                      <div className="agent-line agent-muted">&gt; USE STAGES /GENERATE FROM THIS TURN.</div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="agent-line agent-muted">&gt; TYPE A DIRECTION AND PRESS ENTER.</div>
            )}
            {agentPending && (
              <div className="agent-line">&gt; <mark>THINKING...</mark></div>
            )}
            {agentError && (
              <div className="agent-line agent-muted">&gt; ERROR: <mark>{agentError}</mark></div>
            )}
          </div>
          {promptText.trim() && parseGenerateCommand(promptText) === null && (
            <div className="agent-section">
              <div className="agent-line">&gt; <mark>UNSENT CHANGE</mark></div>
              <div className="agent-line agent-muted">&gt; PRESS ENTER TO UPDATE THE DRAFT.</div>
            </div>
          )}
          <div className="agent-section">
            <div className="agent-line agent-muted">&gt; {frameExecutionState}</div>
          </div>
          {referenceReadError && (
            <div className="agent-section agent-reference">
              <div className="agent-line agent-muted">&gt; READER ERROR: <mark>{referenceReadError}</mark></div>
            </div>
          )}
          <div className="agent-footer">
            &gt; CAFE AGENT / {footerModelSummary}
          </div>
        </div>
      </div>
    </div>
  );
}





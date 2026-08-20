"use client";

import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { useApp } from "@/context/AppContext";
import { MODELS, useSettings } from "@/context/SettingsContext";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useModule } from "@/context/ModuleContext";
import { generate, storeGenerationDebug } from "@/lib/pipeline/api";
import { collectPayload } from "@/lib/pipeline/prompt-builder";
import DB from "@/lib/db";
import {
  createReferenceSnapshot,
  fingerprintModuleFiles,
} from "@/lib/brief-agent/referenceSnapshot";
import {
  fingerprintReferenceImage,
  hasCurrentReferenceRead,
  REFERENCE_READER_CONTRACT_VERSION,
} from "@/lib/brief-agent/referenceFreshness";
import { ReferenceReadRequestError, requestBriefAgent, requestGenerationInspection, requestReferenceRead } from "@/lib/brief-agent/client";
import { requestGenerationEvaluation, type AiGenerationEvaluation } from "@/lib/evaluationReview";
import type { AgentActionProposalStatus, AgentAppAction, AgentAppEvent, AgentMemoryScope, AgentMessage, BriefAgentAction, BriefDraft, BriefGenerationEvidence, BriefReferenceImageInput, BriefReferenceRole, BriefReferenceSnapshot, CafeWorkspaceSnapshot } from "@/lib/brief-agent/types";
import { applyAgentAppAction, describeAgentAppAction } from "@/lib/brief-agent/appActions";
import { canResolveAgentActionProposal, createAgentActionProposal, proposalStatusFromEvents, recoverInterruptedActionProposal, resolveAgentActionProposal } from "@/lib/brief-agent/actionApproval";
import { moduleFileForStorage } from "@/lib/moduleFiles";
import { getGenerationModuleImages } from "@/lib/pipeline/module-order";
import { fingerprintReferenceValues } from "@/lib/brief-agent/referenceFingerprint";
import {
  observeAgentGeneration,
  observeAgentReview,
  requestAgentGeneration,
  requestAgentPromptRevision,
  recoverInterruptedAgentRun,
  type AgentRun,
} from "@/lib/brief-agent/runState";
import {
  captureSessionStateMemory,
  captureUserMessageMemories,
  clearAgentMemories,
  listAgentMemories,
  recallAgentMemories,
  rememberAgentMemory,
} from "@/lib/brief-agent/memory";

const PROMPT_DRAFT_STORAGE_KEY = "cafehtml-prompt-draft";
const IMAGE_PROMPT_SETTINGS_KEY = "cafehtml-image-prompt-settings";
const REFERENCE_SNAPSHOT_CACHE_KEY = "cafehtml-brief-reference-cache-v4";
const REFERENCE_SNAPSHOT_CACHE_LIMIT = 20;
const REFERENCE_SNAPSHOT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_RUN_CLEARED_KEY = "cafehtml-agent-run-cleared";
const GENERATION_VISION_CACHE_KEY = "cafehtml-generation-vision-cache-v2";
const GENERATION_VISION_CACHE_LIMIT = 30;
const GENERATE_COMMAND = "/Generate";
const CANVAS_COMMANDS = [
  { value: GENERATE_COMMAND, label: "/generate", description: "Generate a frame" },
  { value: "/undo", label: "/undo", description: "Undo the last change" },
  { value: "/status", label: "/status", description: "Show what is running" },
  { value: "/retry", label: "/retry", description: "Retry the failed message" },
  { value: "/stop", label: "/stop", description: "Stop the current task" },
  { value: "/clear", label: "/clear", description: "Start a fresh chat" },
  { value: "/help", label: "/help", description: "Show available commands" },
];
const DEFAULT_FRAME_RATIO = "1:1";
const DEFAULT_FRAME_VARIATIONS = 1;
const MAX_AGENT_QUEUE_LENGTH = 20;

type ReferenceSnapshotCacheEntry = {
  sourceFingerprint: string;
  snapshot: BriefReferenceSnapshot;
  model: string | null;
  cachedAt: string;
  readerContractVersion: string;
};

type GenerationVisionCacheEntry = {
  cacheKey: string;
  generationId: string;
  contentFingerprint: string;
  visualRead: string;
  comparison: string | null;
  inspectedAt: string;
};

type PersistedAgentWorkspace = {
  run: AgentRun;
  messages: AgentMessage[];
  draft: BriefDraft | null;
  brain: "model" | "local";
  model: string | null;
  reviewComplete: boolean;
  reviewEvaluation: AiGenerationEvaluation | null;
  revisionRequested: boolean;
  reviewTargetKeys: string[];
  queuedInputs?: string[];
};

type CanvasLocalCommand = "/help" | "/clear" | "/undo" | "/actions" | "/approve" | "/reject" | "/pending" | "/status" | "/memory" | "/remember" | "/forget" | "/retry" | "/stop";

type AgentActivity = {
  kind: "thinking" | "reading" | "working" | "reviewing";
  label: string;
  detail: string;
  startedAt: number;
};

type GenerationActivity = {
  completed: number;
  total: number;
  stage: string;
};

type PersistedAgentRunRecord = {
  id: string;
  project_id: number;
  active: 0 | 1;
  schemaVersion: 1;
  state?: PersistedAgentWorkspace;
};

function validPersistedAgentRun(value: unknown): value is AgentRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<AgentRun>;
  return run.version === 1
    && typeof run.id === "string"
    && typeof run.goal === "string"
    && typeof run.status === "string"
    && typeof run.referenceFingerprint === "string"
    && Array.isArray(run.steps)
    && Array.isArray(run.generationIds)
    && typeof run.generationAttempts === "number"
    && !!run.budget;
}

function galleryCellKey(cell: GalleryCell) {
  return cell.uuid ? `uuid:${cell.uuid}` : `id:${cell.id}`;
}

function generationContentFingerprint(cell: GalleryCell) {
  if (!cell.imgUrl) return "";
  return fingerprintReferenceValues([[
    cell.uuid || cell.id,
    cell.imgUrl,
    cell.effectivePrompt || cell.prompt || "",
  ]]);
}

function agentRunClearedStorageKey(projectId: number) {
  return `${AGENT_RUN_CLEARED_KEY}:${projectId}`;
}

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
  const now = Date.now();
  return readReferenceSnapshotCache().find((entry) => (
    entry.sourceFingerprint === sourceFingerprint
    && entry.readerContractVersion === REFERENCE_READER_CONTRACT_VERSION
    && Number.isFinite(Date.parse(entry.cachedAt))
    && now - Date.parse(entry.cachedAt) <= REFERENCE_SNAPSHOT_CACHE_TTL_MS
  )) || null;
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

function readGenerationVisionCache(): GenerationVisionCacheEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GENERATION_VISION_CACHE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGenerationVisionCache(entries: GenerationVisionCacheEntry[]) {
  try {
    const keys = new Set(entries.map((entry) => entry.cacheKey));
    const next = [...entries, ...readGenerationVisionCache().filter((entry) => !keys.has(entry.cacheKey))]
      .slice(0, GENERATION_VISION_CACHE_LIMIT);
    window.localStorage.setItem(GENERATION_VISION_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Inspection remains usable when browser storage is unavailable.
  }
}

function generationInspectionCount(text: string) {
  const normalized = text.trim().toLowerCase();
  if (/\b(compare|comparison|difference|versus|vs\.?|between)\b/.test(normalized)
    && /\b(generation|image|result|version|frame)s?\b/.test(normalized)) return 2;
  if (/\b(inspect|look at|analy[sz]e|visually check|what do you see|visible in)\b/.test(normalized)
    && /\b(latest|last|previous|selected|generation|image|result|version|frame)\b/.test(normalized)) return 1;
  return 0;
}

function promptLexicalDiff(previousPrompt: string, nextPrompt: string) {
  const words = (value: string) => value.match(/[\p{L}\p{N}'-]+/gu) || [];
  const previousWords = words(previousPrompt);
  const nextWords = words(nextPrompt);
  const previousSet = new Set(previousWords.map((word) => word.toLowerCase()));
  const nextSet = new Set(nextWords.map((word) => word.toLowerCase()));
  return {
    added: nextWords.filter((word, index) => (
      !previousSet.has(word.toLowerCase())
      && nextWords.findIndex((candidate) => candidate.toLowerCase() === word.toLowerCase()) === index
    )).slice(0, 18),
    removed: previousWords.filter((word, index) => (
      !nextSet.has(word.toLowerCase())
      && previousWords.findIndex((candidate) => candidate.toLowerCase() === word.toLowerCase()) === index
    )).slice(0, 18),
  };
}

function parseCanvasLocalCommand(text: string) {
  const command = text.trim().toLowerCase().split(/\s+/, 1)[0];
  return command === "/help" || command === "/clear" || command === "/undo" || command === "/actions"
    || command === "/approve" || command === "/reject" || command === "/pending" || command === "/status"
    || command === "/memory" || command === "/remember" || command === "/forget"
    || command === "/retry" || command === "/stop" ? command as CanvasLocalCommand : null;
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
  const [agentWorkspaceHydrating, setAgentWorkspaceHydrating] = useState(true);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentPending, setAgentPending] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [activityElapsedSeconds, setActivityElapsedSeconds] = useState(0);
  const [queuedAgentInputs, setQueuedAgentInputs] = useState<string[]>([]);
  const [lastFailedAgentInput, setLastFailedAgentInput] = useState("");
  const [agentToolPending, setAgentToolPending] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [agentBrain, setAgentBrain] = useState<"model" | "local">("local");
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<BriefDraft | null>(null);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentReviewTargets, setAgentReviewTargets] = useState<GalleryCell[]>([]);
  const [agentReviewPending, setAgentReviewPending] = useState(false);
  const [agentReviewComplete, setAgentReviewComplete] = useState(false);
  const [agentReviewEvaluation, setAgentReviewEvaluation] = useState<AiGenerationEvaluation | null>(null);
  const [restoredReviewTargetKeys, setRestoredReviewTargetKeys] = useState<string[]>([]);
  const [agentRevisionPending, setAgentRevisionPending] = useState(false);
  const [agentRevisionRequested, setAgentRevisionRequested] = useState(false);
  const [referenceReadError, setReferenceReadError] = useState("");
  const [referenceReadRetryTick, setReferenceReadRetryTick] = useState(0);
  const [referenceReadModel, setReferenceReadModel] = useState<string | null>(null);
  const [referenceReadPending, setReferenceReadPending] = useState(false);
  const [generationActivity, setGenerationActivity] = useState<GenerationActivity | null>(null);
  const [referenceSnapshot, setReferenceSnapshot] = useState(() => createReferenceSnapshot([]));
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptBarRef = useRef<HTMLDivElement>(null);
  const agentConsoleScrollRef = useRef<HTMLDivElement>(null);
  const referenceReadInFlightRef = useRef(new Set<string>());
  const referenceReadAttemptsRef = useRef(new Map<string, number>());
  const agentRunHydratedProjectRef = useRef<number | null>(null);
  const agentToolPendingRef = useRef(false);
  const agentMessagesRef = useRef<AgentMessage[]>([]);
  const agentPendingRef = useRef(false);
  const queuedAgentInputsRef = useRef<string[]>([]);
  const agentAbortRef = useRef<AbortController | null>(null);
  const agentRequestIdRef = useRef(0);
  const agentReviewRequestIdRef = useRef(0);
  const activeProjectIdRef = useRef(activeProjectId);
  const moduleFilesRef = useRef(moduleContext.files);
  const moduleFoldersRef = useRef(moduleContext.folders);
  const referenceFingerprint = fingerprintModuleFiles(moduleContext.files);
  const referenceFingerprintRef = useRef(referenceFingerprint);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    moduleFilesRef.current = moduleContext.files;
    referenceFingerprintRef.current = fingerprintModuleFiles(moduleContext.files);
  }, [moduleContext.files]);

  useEffect(() => {
    moduleFoldersRef.current = moduleContext.folders;
  }, [moduleContext.folders]);

  useEffect(() => {
    agentMessagesRef.current = agentMessages;
  }, [agentMessages]);

  useEffect(() => {
    queuedAgentInputsRef.current = queuedAgentInputs;
  }, [queuedAgentInputs]);

  useEffect(() => {
    if (!agentActivity) {
      setActivityElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => {
      setActivityElapsedSeconds(Math.max(0, Math.floor((Date.now() - agentActivity.startedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [agentActivity]);

  const beginAgentActivity = useCallback((
    kind: AgentActivity["kind"],
    label: string,
    detail: string,
  ) => {
    setAgentActivity({ kind, label, detail, startedAt: Date.now() });
  }, []);

  const updateAgentActivity = useCallback((
    kind: AgentActivity["kind"],
    label: string,
    detail: string,
  ) => {
    setAgentActivity((current) => ({
      kind,
      label,
      detail,
      startedAt: current?.startedAt || Date.now(),
    }));
  }, []);

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
    if (!agentConsoleOpen) return;
    requestAnimationFrame(() => {
      agentConsoleScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [agentActivity, agentConsoleOpen, agentMessages, agentPending, generationActivity]);

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
    const focusAgentInput = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setAgentConsoleOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusAgentInput);
    return () => window.removeEventListener("keydown", focusAgentInput);
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

  const commandQuery = promptText.startsWith("/") ? promptText.split(/\s/, 1)[0].toLowerCase() : "";
  const filteredCommands = commandQuery
    ? CANVAS_COMMANDS.filter((command) => command.value.toLowerCase().startsWith(commandQuery))
    : CANVAS_COMMANDS;

  useEffect(() => {
    const isLeadingCommand = promptText.startsWith("/") && !promptText.includes(" ");
    const nextCommandMenuOpen = isLeadingCommand && filteredCommands.length > 0;
    setCommandMenuOpen(nextCommandMenuOpen);
    if (nextCommandMenuOpen) setAgentConsoleOpen(false);
    setCommandIndex((index) => Math.min(index, Math.max(0, filteredCommands.length - 1)));
  }, [filteredCommands.length, promptText]);

  const setPromptTextAndFocus = (nextPrompt: string) => {
    setPromptText(nextPrompt);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextPrompt.length, nextPrompt.length);
    });
  };

  const insertCanvasCommand = (command: string) => {
    setPromptTextAndFocus(`${command} `);
    setCommandMenuOpen(false);
    setAgentConsoleOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    setAgentWorkspaceHydrating(true);
    agentRunHydratedProjectRef.current = null;
    setDraftProjectId(null);
    setGenerationError("");
    setAgentMessages([]);
    agentMessagesRef.current = [];
    setAgentPending(false);
    agentPendingRef.current = false;
    setAgentActivity(null);
    setQueuedAgentInputs([]);
    queuedAgentInputsRef.current = [];
    setLastFailedAgentInput("");
    agentAbortRef.current?.abort();
    agentAbortRef.current = null;
    agentRequestIdRef.current += 1;
    agentReviewRequestIdRef.current += 1;
    setAgentToolPending(false);
    agentToolPendingRef.current = false;
    setAgentError("");
    setAgentBrain("local");
    setAgentModel(null);
    setAgentDraft(null);
    setAgentRun(null);
    setAgentReviewTargets([]);
    setAgentReviewPending(false);
    setAgentReviewComplete(false);
    setAgentReviewEvaluation(null);
    setRestoredReviewTargetKeys([]);
    setAgentRevisionPending(false);
    setAgentRevisionRequested(false);
    setReferenceReadError("");
    setReferenceReadModel(null);
    setReferenceReadPending(false);
    setGenerationActivity(null);
    try {
      const savedDraft = window.localStorage.getItem(`${PROMPT_DRAFT_STORAGE_KEY}:${activeProjectId || "none"}`);
      setPromptText(savedDraft || "");
    } catch {
      setPromptText("");
      // Ignore storage access issues in embedded browsers.
    }
    setDraftProjectId(activeProjectId);
    if (activeProjectId) {
      const clearedKey = agentRunClearedStorageKey(activeProjectId);
      if (window.localStorage.getItem(clearedKey)) {
        agentRunHydratedProjectRef.current = activeProjectId;
        setAgentWorkspaceHydrating(false);
        void DB.agentRuns.clearActive(activeProjectId).catch((error) => console.error("Failed to finish clearing agent run", error));
        return () => {
          cancelled = true;
        };
      }
      void DB.agentRuns.getActive(activeProjectId).then((value) => {
        if (cancelled) return;
        const record = value as PersistedAgentRunRecord | undefined;
        const state = record?.schemaVersion === 1 ? record.state : undefined;
        if (state && validPersistedAgentRun(state.run)) {
          const restoredRun = recoverInterruptedAgentRun(state.run);
          setAgentRun(restoredRun);
          setAgentMessages(Array.isArray(state.messages) ? state.messages.map((message) => (
            message.toolProposal
              ? { ...message, toolProposal: recoverInterruptedActionProposal(message.toolProposal) }
              : message
          )) : []);
          setAgentDraft(state.draft || null);
          setAgentBrain(state.brain === "model" ? "model" : "local");
          setAgentModel(typeof state.model === "string" ? state.model : null);
          setAgentReviewComplete(Boolean(state.reviewComplete));
          setAgentReviewEvaluation(state.reviewEvaluation || null);
          setAgentRevisionRequested(Boolean(state.revisionRequested));
          setRestoredReviewTargetKeys(Array.isArray(state.reviewTargetKeys) ? state.reviewTargetKeys : []);
          const restoredQueue = Array.isArray(state.queuedInputs)
            ? state.queuedInputs.filter((item) => typeof item === "string" && item.trim()).slice(0, MAX_AGENT_QUEUE_LENGTH)
            : [];
          setQueuedAgentInputs((current) => {
            const next = [...restoredQueue, ...current].slice(0, MAX_AGENT_QUEUE_LENGTH);
            queuedAgentInputsRef.current = next;
            return next;
          });
        }
        agentRunHydratedProjectRef.current = activeProjectId;
        setAgentWorkspaceHydrating(false);
      }).catch((error) => {
        if (!cancelled) {
          agentRunHydratedProjectRef.current = activeProjectId;
          setAgentWorkspaceHydrating(false);
          console.error("Failed to restore agent run", error);
        }
      });
    } else {
      setAgentWorkspaceHydrating(false);
    }
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || agentRunHydratedProjectRef.current !== activeProjectId || !agentRun) return;
    const state: PersistedAgentWorkspace = {
      run: agentRun,
      messages: agentMessages,
      draft: agentDraft,
      brain: agentBrain,
      model: agentModel,
      reviewComplete: agentReviewComplete,
      reviewEvaluation: agentReviewEvaluation,
      revisionRequested: agentRevisionRequested,
      reviewTargetKeys: agentReviewTargets.map(galleryCellKey),
      queuedInputs: queuedAgentInputs,
    };
    void DB.agentRuns.saveActive(activeProjectId, {
      id: agentRun.id,
      state,
    }).then(() => {
      window.localStorage.removeItem(agentRunClearedStorageKey(activeProjectId));
    }).catch((error) => console.error("Failed to persist agent run", error));
  }, [
    activeProjectId,
    agentBrain,
    agentDraft,
    agentMessages,
    agentModel,
    agentReviewComplete,
    agentReviewEvaluation,
    agentReviewTargets,
    agentRevisionRequested,
    agentRun,
    queuedAgentInputs,
  ]);

  useEffect(() => {
    if (!restoredReviewTargetKeys.length || !gallery.cells.length) return;
    const keys = new Set(restoredReviewTargetKeys);
    const targets = gallery.cells.filter((cell) => keys.has(galleryCellKey(cell)));
    if (targets.length) {
      setAgentReviewTargets(targets);
      setRestoredReviewTargetKeys([]);
    }
  }, [gallery.cells, restoredReviewTargetKeys]);

  useEffect(() => {
    if (!activeProjectId || draftProjectId !== activeProjectId) return;
    try {
      window.localStorage.setItem(`${PROMPT_DRAFT_STORAGE_KEY}:${activeProjectId}`, promptText);
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [activeProjectId, draftProjectId, promptText]);

  const handleGenerate = async (
    approvedArtifact?: NonNullable<AgentMessage["promptArtifact"]>,
    runOverride?: AgentRun | null,
    allowWhileAgentPending = false,
  ) => {
    if (!activeProjectId) return;
    const approvedPrompt = approvedArtifact?.prompt.trim() || "";
    const trimmed = approvedPrompt
      ? `${GENERATE_COMMAND} ${flattenPromptArtifact(approvedPrompt)}`
      : promptText.trim();
    const agentFinalPrompt = agentDraft?.finalPrompt.trim() || "";
    const commandPrompt = parseGenerateCommand(trimmed);
    if (agentPending && !allowWhileAgentPending) {
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
    // Only a direct agent approval should enter the run-approval lifecycle.
    // Text staged through EDIT belongs to the prompt bar and must remain a
    // normal manual generation, even when it still matches an old artifact.
    const stagedPromptArtifact = approvedArtifact || null;
    if (
      stagedPromptArtifact?.sourceFingerprint
      && stagedPromptArtifact.sourceFingerprint !== referenceFingerprintRef.current
    ) {
      setGenerationError("References changed after this prompt was drafted. Ask the agent to update it before generating.");
      return;
    }
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

    let approvedRun = runOverride ?? agentRun;
    if (stagedPromptArtifact && approvedRun) {
      const approval = requestAgentGeneration(approvedRun, executionPrompt);
      if (!approval.allowed) {
        setGenerationError(approval.reason);
        return;
      }
      approvedRun = approval.run;
      setAgentRun(approval.run);
    }

    const loadingIds = new Set<string>();
    const readyIds = new Set<string>();
    const readyCells = new Map<string, GalleryCell>();
    const blockedIds = new Set<string>();
    const failedIds = new Set<string>();
    const requestedVariationCount = Math.max(1, Number(fullSettings.variation) || 1);
    setActiveGenerationCount((count) => count + 1);
    setGenerationActivity({ completed: 0, total: requestedVariationCount, stage: "Preparing prompt" });
    if (stagedPromptArtifact) {
      setAgentReviewTargets([]);
      setAgentReviewComplete(false);
      setAgentReviewEvaluation(null);
      setAgentRevisionPending(false);
      setAgentRevisionRequested(Boolean(stagedPromptArtifact.previousPrompt));
    }
    try {
      await generate(payload, fullSettings, {
        onStart: () => {
          setGenerationActivity((current) => current ? { ...current, stage: "Sending to image model" } : current);
        },
        onLoadingIds: (ids) => {
          setGenerationActivity({ completed: 0, total: Math.max(ids.length, requestedVariationCount), stage: "Generating images" });
          ids.forEach(id => {
            loadingIds.add(id);
            gallery.addLoading(
              id,
              (payload.settings.aspectRatio || '1:1'),
              "FRAME",
              activeProjectId
            );
          });
        },
        onVariationReady: (dataUrl, lid, cellData) => {
          readyIds.add(lid);
          setGenerationActivity((current) => current ? {
            ...current,
            completed: Math.min(current.total, readyIds.size + blockedIds.size + failedIds.size),
            stage: "Rendering results",
          } : current);
          const resolvedCell = { ...cellData, project_id: activeProjectId || undefined } as GalleryCell;
          readyCells.set(lid, resolvedCell);
          gallery.resolveLoading(lid, resolvedCell);
        },
        onVariationBlocked: (lid, statusLabel) => {
          blockedIds.add(lid);
          setGenerationActivity((current) => current ? {
            ...current,
            completed: Math.min(current.total, readyIds.size + blockedIds.size + failedIds.size),
            stage: "Finishing results",
          } : current);
          gallery.blockLoading(lid, statusLabel);
        },
        onVariationFailed: (lid, retryFn, statusLabel) => {
          failedIds.add(lid);
          setGenerationActivity((current) => current ? {
            ...current,
            completed: Math.min(current.total, readyIds.size + blockedIds.size + failedIds.size),
            stage: "Finishing results",
          } : current);
          gallery.failLoading(lid, retryFn, statusLabel);
        },
        onGenerationError: (ids, statusLabel) => {
          ids.forEach((id) => {
            if (statusLabel === "BLOCKED") {
              blockedIds.add(id);
              gallery.blockLoading(id, statusLabel);
            } else {
              failedIds.add(id);
              gallery.failLoading(id, undefined, statusLabel);
            }
          });
        },
        onComplete: () => {},
        onError: (err) => {
          console.error('Generation Error:', err);
          setGenerationError(err.message || "Image generation failed.");
        }
      }, moduleContext.files);
      if (stagedPromptArtifact && approvedRun) {
        const outcome = readyIds.size > 0
          ? "succeeded"
          : blockedIds.size > 0 && failedIds.size === 0
          ? "blocked"
          : "failed";
        const message = outcome === "succeeded"
          ? `Generation completed with ${readyIds.size} image${readyIds.size === 1 ? "" : "s"}.`
          : outcome === "blocked"
          ? "Generation was blocked."
          : "Generation completed without a usable image.";
        const observedRun = observeAgentGeneration(approvedRun, {
          outcome,
          generationIds: [...readyIds, ...blockedIds, ...failedIds, ...loadingIds],
          message,
        });
        setAgentRun(observedRun);
        if (outcome === "succeeded") {
          setAgentReviewTargets(Array.from(readyCells.values()));
        }
        setAgentMessages((messages) => [...messages, {
          id: crypto.randomUUID(),
          role: "system",
          text: message,
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed.";
      setGenerationError(message);
      if (stagedPromptArtifact && approvedRun) {
        setAgentRun(observeAgentGeneration(approvedRun, {
          outcome: "failed",
          generationIds: [...loadingIds],
          message,
        }));
        setAgentMessages((messages) => [...messages, {
          id: crypto.randomUUID(),
          role: "system",
          text: `GENERATION ERROR: ${message}`,
          createdAt: new Date().toISOString(),
        }]);
      }
      console.error("Generation Error:", error);
    } finally {
      setActiveGenerationCount((count) => Math.max(0, count - 1));
      setGenerationActivity(null);
    }
  };

  const setModuleFiles = moduleContext.setFiles;

  const applyReferenceSnapshotToModules = useCallback((snapshot: BriefReferenceSnapshot) => {
    const observationsById = new Map(snapshot.observations.map((observation) => [observation.imageId, observation]));
    setModuleFiles((current) => {
      let changed = false;
      const next = current.map((file) => {
        const observation = observationsById.get(file.uuid || String(file.id));
        if (!observation) return file;
        const visualRead = observation.visualRead || "";
        const visualReadSource = observation.readSource || "local";
        const visualReadFingerprint = fingerprintReferenceImage(file);
        if (
          file.visualRead === visualRead
          && file.visualReadSource === visualReadSource
          && file.visualReadFingerprint === visualReadFingerprint
          && file.visualReadVersion === REFERENCE_READER_CONTRACT_VERSION
        ) return file;
        changed = true;
        const updated = {
          ...file,
          visualRead,
          visualReadSource,
          visualReadFingerprint,
          visualReadVersion: REFERENCE_READER_CONTRACT_VERSION,
        };
        if (activeProjectId) {
          void DB.references.put({ ...moduleFileForStorage(updated), project_id: activeProjectId })
            .catch((error) => console.error("Failed to persist reference vision read", error));
        }
        return updated;
      });
      return changed ? next : current;
    });
  }, [activeProjectId, setModuleFiles]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const fallbackSnapshot = createReferenceSnapshot(moduleContext.files);
    setReferenceSnapshot((current) => {
      if (current.sourceFingerprint === referenceFingerprint) return current;
      return fallbackSnapshot;
    });
    setAgentDraft(null);
    setReferenceReadError("");
    setReferenceReadModel(null);

    const activeReferenceFiles = getGenerationModuleImages(moduleContext.files);
    const images: BriefReferenceImageInput[] = activeReferenceFiles
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

    const imageIdsNeedingRead = new Set(
      activeReferenceFiles
        .filter((file) => !hasCurrentReferenceRead(file))
        .map((file) => file.uuid || String(file.id)),
    );
    const imagesToRead = images.filter((image) => imageIdsNeedingRead.has(image.imageId));

    if (!images.length) {
      return () => {
        cancelled = true;
      };
    }

    if (!imagesToRead.length) {
      referenceReadAttemptsRef.current.delete(referenceFingerprint);
      setReferenceSnapshot(fallbackSnapshot);
      return () => {
        cancelled = true;
      };
    }

    const cached = findReferenceSnapshotCache(referenceFingerprint);
    if (cached) {
      referenceReadAttemptsRef.current.delete(referenceFingerprint);
      setReferenceSnapshot(cached.snapshot);
      setReferenceReadModel(cached.model);
      applyReferenceSnapshotToModules(cached.snapshot);
      return () => {
        cancelled = true;
      };
    }

    if (referenceReadInFlightRef.current.has(referenceFingerprint)) {
      return () => {
        cancelled = true;
      };
    }
    const debounceTimer = setTimeout(() => {
      if (cancelled || referenceReadInFlightRef.current.has(referenceFingerprint)) return;
      referenceReadInFlightRef.current.add(referenceFingerprint);
      setReferenceReadPending(true);
      const attempt = (referenceReadAttemptsRef.current.get(referenceFingerprint) || 0) + 1;

      requestReferenceRead({
        sourceFingerprint: referenceFingerprint,
        images: imagesToRead,
      }, settings.geminiApiKey, controller.signal).then((response) => {
        if (cancelled) return;
        const newObservations = new Map(response.snapshot.observations.map((observation) => [observation.imageId, observation]));
        const mergedSnapshot: BriefReferenceSnapshot = {
          ...response.snapshot,
          sourceFingerprint: referenceFingerprint,
          observations: fallbackSnapshot.observations.map((observation) => newObservations.get(observation.imageId) || observation),
        };
        referenceReadAttemptsRef.current.delete(referenceFingerprint);
        setReferenceReadError("");
        setReferenceSnapshot(mergedSnapshot);
        setReferenceReadModel(response.model);
        applyReferenceSnapshotToModules(mergedSnapshot);
        writeReferenceSnapshotCache({
          sourceFingerprint: referenceFingerprint,
          snapshot: mergedSnapshot,
          model: response.model,
          cachedAt: new Date().toISOString(),
          readerContractVersion: REFERENCE_READER_CONTRACT_VERSION,
        });
      }).catch((error) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReferenceSnapshot(fallbackSnapshot);
        if (error instanceof ReferenceReadRequestError && error.status === 429) {
          referenceReadAttemptsRef.current.set(referenceFingerprint, attempt);
          if (attempt < 3) {
            const retryDelay = Math.max(error.retryAfterMs || 0, [8_000, 20_000][attempt - 1]);
            setReferenceReadError(`Reference reader is busy. Retrying in ${Math.ceil(retryDelay / 1000)} seconds; existing reference notes remain active.`);
            retryTimer = setTimeout(() => {
              if (!cancelled) setReferenceReadRetryTick((tick) => tick + 1);
            }, retryDelay);
            return;
          }
          setReferenceReadError("Reference reader is still busy. Existing reference notes remain active; it will try again after a reference changes.");
          return;
        }
        const message = error instanceof Error ? error.message : "Reference reader failed.";
        setReferenceReadError(message);
      }).finally(() => {
        referenceReadInFlightRef.current.delete(referenceFingerprint);
        if (referenceFingerprintRef.current === referenceFingerprint) setReferenceReadPending(false);
        if (cancelled && referenceFingerprintRef.current === referenceFingerprint) {
          setReferenceReadRetryTick((tick) => tick + 1);
        }
      });
    }, 600);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [applyReferenceSnapshotToModules, moduleContext.files, referenceFingerprint, referenceReadRetryTick, settings.geminiApiKey]);

  const activeModuleCount = moduleContext.files.filter((file) => file.eye !== false && file.url && !file.folder).length;

  const currentReferenceContext = (): NonNullable<AgentMessage["context"]> => ({
    refCount: activeModuleCount,
  });

  const currentGenerationEvidence = (): BriefGenerationEvidence[] => gallery.cells
    .filter((cell) => cell.origin === "generation" && !cell.loadingId && !cell.error && !cell.blocked)
    .sort((left, right) => String(right.createdAt || right.date || "").localeCompare(String(left.createdAt || left.date || "")))
    .slice(0, 6)
    .map((cell, index) => {
      const generationId = cell.uuid || String(cell.id);
      const contentFingerprint = generationContentFingerprint(cell);
      const cached = contentFingerprint
        ? readGenerationVisionCache().find((entry) => (
          entry.generationId === generationId && entry.contentFingerprint === contentFingerprint
        ))
        : null;
      return {
      generationId,
      recency: index + 1,
      createdAt: cell.createdAt || cell.date || null,
      prompt: cell.effectivePrompt || cell.prompt || "",
      model: cell.model || cell.modelId || null,
      visualReview: cell.evaluation ? {
        summary: cell.evaluation.summary || "",
        issues: cell.evaluation.issues || [],
        suggestions: cell.evaluation.suggestions || [],
        scores: {
          prompt: cell.evaluation.promptMatch,
          subject: cell.evaluation.subjectMatch,
          scene: cell.evaluation.sceneMatch,
          style: cell.evaluation.styleMatch,
          quality: cell.evaluation.qualityMatch,
        },
      } : null,
      userFeedback: cell.evaluation?.userFeedback || null,
      visionObservation: cached ? {
        visualRead: cached.visualRead,
        comparison: cached.comparison,
        inspectedAt: cached.inspectedAt,
      } : null,
    };
    });

  const inspectGenerationsForMessage = async (text: string, evidence: BriefGenerationEvidence[], signal?: AbortSignal) => {
    const requestedCount = generationInspectionCount(text);
    if (!requestedCount) return evidence;
    const recentCells = gallery.cells
      .filter((cell) => cell.origin === "generation" && cell.imgUrl && !cell.loadingId && !cell.error && !cell.blocked)
      .sort((left, right) => String(right.createdAt || right.date || "").localeCompare(String(left.createdAt || left.date || "")));
    const selected = recentCells.filter((cell) => gallery.selectedIds.has(cell.id));
    const targets = [...selected, ...recentCells.filter((cell) => !gallery.selectedIds.has(cell.id))]
      .slice(0, requestedCount);
    if (!targets.length || (requestedCount === 2 && targets.length < 2)) {
      throw new Error(requestedCount === 2
        ? "Select two generations, or create at least two results, before comparing them."
        : "Select a generation or create a result before asking for visual inspection.");
    }
    const cacheKey = fingerprintReferenceValues(targets.map((cell) => [
      cell.uuid || cell.id,
      cell.imgUrl || "",
      cell.effectivePrompt || cell.prompt || "",
    ]));
    const cachedEntries = readGenerationVisionCache().filter((entry) => entry.cacheKey === cacheKey);
    let inspectionEntries = cachedEntries;
    if (inspectionEntries.length !== targets.length) {
      const response = await requestGenerationInspection({
        images: targets.map((cell) => ({
          generationId: cell.uuid || String(cell.id),
          dataUrl: cell.imgUrl!,
          prompt: cell.effectivePrompt || cell.prompt || "",
        })),
      }, settings.geminiApiKey, signal);
      const inspectedAt = new Date().toISOString();
      inspectionEntries = response.observations.map((observation) => ({
        cacheKey,
        generationId: observation.generationId,
        contentFingerprint: generationContentFingerprint(targets.find((cell) => (
          String(cell.uuid || cell.id) === observation.generationId
        ))!),
        visualRead: observation.visualRead,
        comparison: response.comparison,
        inspectedAt,
      }));
      writeGenerationVisionCache(inspectionEntries);
    }
    const byId = new Map(inspectionEntries.map((entry) => [entry.generationId, entry]));
    return evidence.map((item) => {
      const inspected = byId.get(item.generationId);
      return inspected ? {
        ...item,
        visionObservation: {
          visualRead: inspected.visualRead,
          comparison: inspected.comparison,
          inspectedAt: inspected.inspectedAt,
        },
      } : item;
    });
  };

  function canApprovePromptArtifact(artifact: NonNullable<AgentMessage["promptArtifact"]>) {
    if (!agentRun || agentRun.status !== "awaiting_approval") return false;
    if (agentRun.generationAttempts >= agentRun.budget.maxGenerations) return false;
    if (artifact.sourceFingerprint && artifact.sourceFingerprint !== referenceFingerprint) return false;
    return flattenPromptArtifact(artifact.prompt) === flattenPromptArtifact(agentRun.currentPrompt);
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

  const handleReviewAgentGeneration = async () => {
    const target = agentReviewTargets[0];
    if (!target?.imgUrl || agentReviewPending || agentReviewComplete) return;
    const reviewProjectId = activeProjectId;
    const reviewRequestId = ++agentReviewRequestIdRef.current;
    setAgentReviewPending(true);
    beginAgentActivity("reviewing", "Reviewing generated image", "Checking prompt match, composition, and visual quality");
    setAgentError("");
    try {
      const evaluation = await requestGenerationEvaluation({
        imageDataUrl: target.imgUrl,
        effectivePrompt: target.effectivePrompt || target.prompt || agentRun?.currentPrompt || "",
        userPrompt: target.userPrompt || agentRun?.goal || "",
        references: (target.usedImages || []).map((image) => ({
          role: image.role || null,
          label: image.label || null,
          strength: typeof image.strength === "number" ? image.strength : null,
          strengthBand: image.strengthBand || null,
          dataUrl: image.imgUrl,
        })),
      });
      if (reviewRequestId !== agentReviewRequestIdRef.current || activeProjectIdRef.current !== reviewProjectId) return;
      await gallery.saveEvaluation(target.id, evaluation);
      if (reviewRequestId !== agentReviewRequestIdRef.current || activeProjectIdRef.current !== reviewProjectId) return;
      const review = {
        generationId: target.uuid || String(target.id),
        scores: {
          prompt: evaluation.promptMatch,
          subject: evaluation.subjectMatch,
          scene: evaluation.sceneMatch,
          style: evaluation.styleMatch,
          quality: evaluation.qualityMatch,
        },
        summary: evaluation.summary,
        issues: evaluation.issues,
        suggestions: evaluation.suggestions,
      };
      if (agentRun) setAgentRun(observeAgentReview(agentRun, review));
      const scoreLine = `PROMPT ${evaluation.promptMatch}/5 · SUBJECT ${evaluation.subjectMatch}/5 · SCENE ${evaluation.sceneMatch}/5 · STYLE ${evaluation.styleMatch}/5 · QUALITY ${evaluation.qualityMatch}/5`;
      const reviewLines = [
        "VISUAL REVIEW",
        scoreLine,
        evaluation.summary,
        ...evaluation.issues.map((issue) => `ISSUE: ${issue}`),
        ...evaluation.suggestions.map((suggestion) => `NEXT: ${suggestion}`),
      ];
      setAgentMessages((messages) => [...messages, {
        id: crypto.randomUUID(),
        role: "system",
        text: reviewLines.join("\n"),
        createdAt: new Date().toISOString(),
      }]);
      setAgentReviewComplete(true);
      setAgentReviewEvaluation(evaluation);
    } catch (error) {
      if (reviewRequestId !== agentReviewRequestIdRef.current || activeProjectIdRef.current !== reviewProjectId) return;
      const message = error instanceof Error ? error.message : "Generation review failed.";
      setAgentError(message);
    } finally {
      if (reviewRequestId === agentReviewRequestIdRef.current) {
        setAgentReviewPending(false);
        setAgentActivity(null);
      }
    }
  };

  const handleImprovePromptFromReview = async () => {
    if (!agentRun || !agentReviewEvaluation || agentRevisionPending || agentRevisionRequested) return;
    const target = agentReviewTargets[0];
    if (!target) return;
    const revisionRun = requestAgentPromptRevision(agentRun, {
      generationId: target.uuid || String(target.id),
      summary: agentReviewEvaluation.summary,
      issues: agentReviewEvaluation.issues,
      suggestions: agentReviewEvaluation.suggestions,
    });
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: "Improve the last prompt using the visual review. Preserve the original intent and change only what the review evidence supports.",
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...agentMessagesRef.current, userMessage];
    const revisionProjectId = activeProjectId;
    const requestId = ++agentRequestIdRef.current;
    const controller = new AbortController();
    agentAbortRef.current?.abort();
    agentAbortRef.current = controller;
    setAgentMessages(nextMessages);
    agentMessagesRef.current = nextMessages;
    setAgentRun(revisionRun);
    setAgentRevisionPending(true);
    agentPendingRef.current = true;
    setAgentPending(true);
    beginAgentActivity("thinking", "Improving the prompt", "Turning review findings into a stronger direction");
    setAgentError("");
    try {
      const memories = revisionProjectId
        ? await recallAgentMemories({
          projectId: revisionProjectId,
          sessionId: revisionRun.id,
          query: userMessage.text,
        })
        : [];
      const response = await requestBriefAgent({
        referenceSnapshot,
        messages: nextMessages,
        session: agentDraft?.session || null,
        run: revisionRun,
        generations: currentGenerationEvidence(),
        workspace: await currentWorkspace(),
        memories,
      }, settings.geminiApiKey, controller.signal);
      if (controller.signal.aborted || requestId !== agentRequestIdRef.current) return;
      if (activeProjectIdRef.current !== revisionProjectId) {
        throw new Error("Project changed while the prompt revision was running.");
      }
      setAgentBrain(response.brain);
      setAgentModel(response.model);
      setAgentDraft(response.draft);
      setAgentRun(response.run);
      setAgentMessages((messages) => [
        ...messages,
        {
          ...response.message,
          context: currentReferenceContext(),
        },
      ]);
      if (revisionProjectId) {
        void captureSessionStateMemory(response.draft.session, revisionProjectId, response.run.id)
          .catch((error) => console.error("Failed to persist revised session memory", error));
      }
      setAgentRevisionRequested(true);
    } catch (error) {
      if (requestId !== agentRequestIdRef.current) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setAgentMessages((messages) => [...messages, {
          id: crypto.randomUUID(),
          role: "system",
          text: "PROMPT REVISION STOPPED - The current revision was cancelled.",
          createdAt: new Date().toISOString(),
        }]);
        return;
      }
      const message = error instanceof Error ? error.message : "Prompt revision failed.";
      setAgentError(message);
      setAgentMessages((messages) => [...messages, {
        id: crypto.randomUUID(),
        role: "system",
        text: `REVISION ERROR: ${message}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      if (requestId === agentRequestIdRef.current) {
        agentAbortRef.current = null;
        setAgentRevisionPending(false);
        agentPendingRef.current = false;
        setAgentPending(false);
        setAgentActivity(null);
      }
    }
  };

  const addLocalAgentMessage = (text: string, action: BriefAgentAction = "talk") => {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text,
      action,
      createdAt: new Date().toISOString(),
      context: currentReferenceContext(),
    };
    setAgentMessages((messages) => [...messages, message]);
    setAgentConsoleOpen(true);
  };

  const currentWorkspace = async (): Promise<CafeWorkspaceSnapshot | null> => {
    if (!activeProjectId) return null;
    const project = await DB.projects.get(activeProjectId) as { id?: number; name?: string } | undefined;
    return {
      project: { id: activeProjectId, name: project?.name || "Project" },
      folders: moduleContext.folders.map((folder) => ({ id: folder.id, name: folder.name })),
      references: moduleFilesRef.current.map((file, index) => {
        const role = String(file.mode || "UNASSIGNED").toUpperCase();
        return {
          position: index + 1,
          imageId: file.uuid || String(file.id),
          name: file.name || file.label || "UNLABELED",
          label: file.label || file.name || "UNLABELED",
          role: role === "SUBJECT" || role === "SCENE" || role === "STYLE" ? role as BriefReferenceRole : "UNASSIGNED",
          strength: Number.isFinite(file.strength) ? file.strength : 50,
          visible: file.eye !== false,
          folder: file.folder || null,
        };
      }),
    };
  };

  const persistAppActionResult = async (
    projectId: number,
    action: AgentAppAction,
    projectName: string,
    files: typeof moduleContext.files,
    folders: typeof moduleContext.folders,
    event: AgentAppEvent,
    previousFiles: typeof moduleContext.files,
  ) => {
    if (action.type === "project.rename") {
      await DB.agentEvents.recordProjectMutation(projectId, { name: projectName }, event);
    } else if (action.type === "folder.create" || action.type === "folder.remove") {
      await DB.agentEvents.recordModuleMutation(projectId, { folders }, event);
    } else if (action.type === "reference.duplicate") {
      const copyId = event.inverse?.type === "reference.remove_copy" ? event.inverse.imageId : null;
      const copy = copyId ? files.find((candidate) => candidate.uuid === copyId) : null;
      if (!copy) throw new Error("The duplicated reference could not be resolved.");
      await DB.agentEvents.recordReferenceCreation(
        projectId,
        moduleFileForStorage(copy),
        copy.url,
        event,
      );
    } else if (action.type === "reference.remove_copy") {
      const removed = previousFiles.find((candidate) => candidate.uuid === action.imageId);
      if (!removed) throw new Error(`Duplicate ${action.imageId} is no longer available.`);
      await DB.agentEvents.recordReferenceDeletion(projectId, removed.id, removed.uuid, event);
    } else {
      const file = files.find((candidate) => candidate.uuid === action.imageId);
      if (!file) throw new Error(`Reference ${action.imageId} is no longer available.`);
      await DB.agentEvents.recordReferenceMutation(projectId, moduleFileForStorage(file), event);
    }
  };

  const executeAppActions = async (actions: AgentAppAction[], runId: string) => {
    if (!actions.length || !activeProjectId) return [];
    const executionProjectId = activeProjectId;
    const project = await DB.projects.get(activeProjectId) as { name?: string } | undefined;
    let projectName = project?.name || "Project";
    let files = moduleFilesRef.current;
    let folders = moduleFoldersRef.current;
    const events: AgentAppEvent[] = [];
    for (const action of actions) {
      if (activeProjectIdRef.current !== executionProjectId) {
        const failedEvent: AgentAppEvent = {
          id: crypto.randomUUID(),
          runId,
          actor: "agent",
          action,
          inverse: null,
          status: "failed",
          summary: describeAgentAppAction(action),
          error: "Project changed before this action could execute.",
          createdAt: new Date().toISOString(),
        };
        await DB.agentEvents.put(executionProjectId, failedEvent).catch(() => undefined);
        events.push(failedEvent);
        continue;
      }
      try {
        files = moduleFilesRef.current;
        folders = moduleFoldersRef.current;
        const previousFiles = files;
        const result = applyAgentAppAction({ action, projectName, files, folders, runId });
        await persistAppActionResult(executionProjectId, action, result.projectName, result.files, result.folders, result.event, previousFiles);
        projectName = result.projectName;
        files = result.files;
        folders = result.folders;
        if (activeProjectIdRef.current === executionProjectId) {
          moduleFilesRef.current = files;
          moduleFoldersRef.current = folders;
          moduleContext.setFiles(files);
          moduleContext.setFolders(folders);
        }
        events.push(result.event);
      } catch (error) {
        const failedEvent: AgentAppEvent = {
          id: crypto.randomUUID(),
          runId,
          actor: "agent",
          action,
          inverse: null,
          status: "failed",
          summary: describeAgentAppAction(action),
          error: error instanceof Error ? error.message : "Action failed.",
          createdAt: new Date().toISOString(),
        };
        await DB.agentEvents.put(executionProjectId, failedEvent).catch(() => undefined);
        events.push(failedEvent);
      }
    }
    return events;
  };

  const latestPendingActionProposal = () => [...agentMessagesRef.current].reverse().find((message) => (
    message.toolProposal?.status === "pending"
  ));

  const setActionProposalStatus = (
    messageId: string,
    status: Exclude<AgentActionProposalStatus, "pending">,
    error?: string,
  ) => {
    setAgentMessages((messages) => messages.map((message) => {
      if (message.id !== messageId || !message.toolProposal) return message;
      const proposal = status === "executing"
        ? { ...message.toolProposal, status }
        : resolveAgentActionProposal(
          message.toolProposal,
          status,
          error,
        );
      return { ...message, toolProposal: proposal };
    }));
  };

  const approveActionProposal = async (messageId?: string) => {
    if (agentToolPendingRef.current) return;
    const proposalMessage = messageId
      ? agentMessagesRef.current.find((message) => message.id === messageId)
      : latestPendingActionProposal();
    const proposal = proposalMessage?.toolProposal;
    if (!proposalMessage || !proposal || !canResolveAgentActionProposal(proposal)) {
      addLocalAgentMessage("No app actions are waiting for approval.", "inspect");
      return;
    }
    if (!activeProjectId || proposal.projectId !== activeProjectId) {
      setActionProposalStatus(proposalMessage.id, "stale", "The active project changed before approval.");
      addLocalAgentMessage("APPROVAL STALE - The active project changed. No actions were executed.", "inspect");
      return;
    }

    agentToolPendingRef.current = true;
    setAgentToolPending(true);
    beginAgentActivity("working", "Applying approved changes", `Updating ${proposal.actions.length} workspace item${proposal.actions.length === 1 ? "" : "s"}`);
    setActionProposalStatus(proposalMessage.id, "executing");
    try {
      const events = await executeAppActions(proposal.actions, proposal.runId);
      const status = proposalStatusFromEvents(events);
      const resultText = events.length
        ? events.map((event) => event.status === "completed"
          ? `ACTION OK - ${event.summary}`
          : `ACTION FAILED - ${event.summary} - ${event.error || "unknown error"}`).join("\n")
        : "ACTION FAILED - No actions were executed.";
      setAgentMessages((messages) => [
        ...messages.map((message) => message.id === proposalMessage.id && message.toolProposal
          ? { ...message, toolProposal: resolveAgentActionProposal(message.toolProposal, status) }
          : message),
        {
          id: crypto.randomUUID(),
          role: "system" as const,
          text: resultText,
          action: "inspect" as const,
          createdAt: new Date().toISOString(),
          context: currentReferenceContext(),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action execution failed.";
      setActionProposalStatus(proposalMessage.id, "failed", message);
      addLocalAgentMessage(`ACTION FAILED - ${message}`, "inspect");
    } finally {
      agentToolPendingRef.current = false;
      setAgentToolPending(false);
      setAgentActivity(null);
    }
  };

  const rejectActionProposal = (messageId?: string) => {
    if (agentToolPendingRef.current) return;
    const proposalMessage = messageId
      ? agentMessagesRef.current.find((message) => message.id === messageId)
      : latestPendingActionProposal();
    if (!proposalMessage?.toolProposal || !canResolveAgentActionProposal(proposalMessage.toolProposal)) {
      addLocalAgentMessage("No app actions are waiting for approval.", "inspect");
      return;
    }
    setActionProposalStatus(proposalMessage.id, "rejected");
    addLocalAgentMessage(`REJECTED - ${proposalMessage.toolProposal.actions.length} proposed app action${proposalMessage.toolProposal.actions.length === 1 ? "" : "s"}.`, "inspect");
  };

  const showPendingActionProposals = () => {
    const pending = agentMessages.filter((message) => message.toolProposal?.status === "pending");
    addLocalAgentMessage(pending.length
      ? pending.map((message) => message.toolProposal!.actions.map((action) => `PENDING - ${describeAgentAppAction(action)}`).join("\n")).join("\n")
      : "No app actions are waiting for approval.", "inspect");
  };

  const undoLastAppAction = async () => {
    if (!activeProjectId) return;
    const events = await DB.agentEvents.getByProject(activeProjectId) as AgentAppEvent[];
    const undoneIds = new Set(events.filter((event) => event.undoOf).map((event) => event.undoOf));
    const target = [...events].reverse().find((event) => event.status === "completed" && event.inverse && !event.undoOf && !undoneIds.has(event.id));
    if (!target?.inverse) {
      addLocalAgentMessage("No agent app action is available to undo.", "inspect");
      return;
    }
    const project = await DB.projects.get(activeProjectId) as { name?: string } | undefined;
    const result = applyAgentAppAction({
      action: target.inverse,
      projectName: project?.name || "Project",
      files: moduleFilesRef.current,
      folders: moduleFoldersRef.current,
      runId: target.runId,
    });
    const undoEvent: AgentAppEvent = {
      ...result.event,
      actor: "user",
      summary: `undid ${target.summary}`,
      undoOf: target.id,
    };
    await persistAppActionResult(
      activeProjectId,
      target.inverse,
      result.projectName,
      result.files,
      result.folders,
      undoEvent,
      moduleFilesRef.current,
    );
    await DB.agentEvents.put(activeProjectId, { ...target, status: "undone", undoneAt: undoEvent.createdAt });
    moduleContext.setFiles(result.files);
    moduleFilesRef.current = result.files;
    moduleContext.setFolders(result.folders);
    moduleFoldersRef.current = result.folders;
    addLocalAgentMessage(`UNDO OK · ${target.summary}`, "inspect");
  };

  const showRecentAppActions = async () => {
    if (!activeProjectId) return;
    const events = await DB.agentEvents.getByProject(activeProjectId) as AgentAppEvent[];
    const recent = events.slice(-8).reverse();
    addLocalAgentMessage(recent.length
      ? recent.map((event) => `${event.status.toUpperCase()} · ${event.summary}`).join("\n")
      : "No agent app actions recorded for this project.", "inspect");
  };

  const showAgentMemory = async () => {
    if (!activeProjectId) return;
    const memories = await listAgentMemories(activeProjectId, agentRun?.id);
    const ordered = memories
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 12);
    addLocalAgentMessage(ordered.length
      ? [
        `MEMORY · ${memories.length} SAVED`,
        ...ordered.map((memory) => `${memory.scope.toUpperCase()} · ${memory.kind.toUpperCase()} · ${memory.text}`),
        memories.length > ordered.length ? `…and ${memories.length - ordered.length} more.` : "",
      ].filter(Boolean).join("\n")
      : "Memory is empty for this project and session.", "inspect");
  };

  const rememberFromCommand = async (rawInput: string) => {
    if (!activeProjectId) return;
    const match = rawInput.trim().match(/^\/remember(?:\s+(user|project|session))?\s+([\s\S]+)$/i);
    if (!match) {
      addLocalAgentMessage("Use /remember [user|project|session] <fact>. The default scope is project.", "inspect");
      return;
    }
    const scope = (match[1]?.toLowerCase() || "project") as AgentMemoryScope;
    if (scope === "session" && !agentRun?.id) {
      addLocalAgentMessage("Start an agent conversation before saving session memory.", "inspect");
      return;
    }
    const memory = await rememberAgentMemory({
      scope,
      kind: scope === "user" ? "preference" : "constraint",
      text: match[2],
      projectId: activeProjectId,
      sessionId: agentRun?.id || null,
      source: "explicit",
      confidence: 1,
      pinned: true,
    });
    addLocalAgentMessage(memory
      ? `MEMORY SAVED · ${scope.toUpperCase()} · ${memory.text}`
      : "Nothing was saved because the memory was empty.", "inspect");
  };

  const forgetFromCommand = async (rawInput: string) => {
    if (!activeProjectId) return;
    const match = rawInput.trim().match(/^\/forget\s+(user|project|session|all)$/i);
    if (!match) {
      addLocalAgentMessage("Use /forget user, /forget project, /forget session, or /forget all.", "inspect");
      return;
    }
    const scope = match[1].toLowerCase() as AgentMemoryScope | "all";
    const removed = await clearAgentMemories(scope, activeProjectId, agentRun?.id);
    addLocalAgentMessage(`MEMORY CLEARED · ${scope.toUpperCase()} · ${removed} item${removed === 1 ? "" : "s"} removed.`, "inspect");
  };

  const runCanvasLocalCommand = (command: CanvasLocalCommand, rawInput = promptText) => {
    setCommandMenuOpen(false);
    setHistoryIndex(-1);
    if (command === "/stop") {
      setPromptText("");
      setQueuedAgentInputs([]);
      queuedAgentInputsRef.current = [];
      if (agentAbortRef.current) {
        agentAbortRef.current.abort();
      } else {
        addLocalAgentMessage(activeGenerationCount > 0
          ? `No agent request is running. ${activeGenerationCount} image generation${activeGenerationCount === 1 ? " is" : "s are"} still active.`
          : "No agent request is running.", "inspect");
      }
      return;
    }
    if (command === "/status") {
      setPromptText("");
      const pendingActions = agentMessagesRef.current.filter((message) => message.toolProposal?.status === "pending").length;
      addLocalAgentMessage([
        `AGENT ${agentPending ? "THINKING" : "READY"} | MODEL ${agentModel || referenceReadModel || "UNAVAILABLE"}`,
        `RUN ${agentRun?.status?.replaceAll("_", " ").toUpperCase() || "IDLE"} | GENERATIONS ${activeGenerationCount} ACTIVE`,
        `REFERENCES ${activeModuleCount} | QUEUE ${queuedAgentInputs.length} | APPROVALS ${pendingActions}`,
      ].join("\n"), "inspect");
      return;
    }
    if (command === "/memory") {
      setPromptText("");
      void showAgentMemory().catch((error) => setAgentError(error instanceof Error ? error.message : "Could not read memory."));
      return;
    }
    if (command === "/remember") {
      setPromptText("");
      void rememberFromCommand(rawInput).catch((error) => setAgentError(error instanceof Error ? error.message : "Could not save memory."));
      return;
    }
    if (command === "/forget") {
      setPromptText("");
      void forgetFromCommand(rawInput).catch((error) => setAgentError(error instanceof Error ? error.message : "Could not clear memory."));
      return;
    }
    if (command === "/retry") {
      setPromptText("");
      if (!lastFailedAgentInput) {
        addLocalAgentMessage("No failed agent turn is available to retry.", "inspect");
        return;
      }
      void submitAgentMessage(lastFailedAgentInput, { retry: true });
      return;
    }
    if (command === "/undo") {
      setPromptText("");
      void undoLastAppAction().catch((error) => setAgentError(error instanceof Error ? error.message : "Undo failed."));
      return;
    }
    if (command === "/actions") {
      setPromptText("");
      void showRecentAppActions().catch((error) => setAgentError(error instanceof Error ? error.message : "Could not read actions."));
      return;
    }
    if (command === "/approve") {
      setPromptText("");
      void approveActionProposal().catch((error) => setAgentError(error instanceof Error ? error.message : "Approval failed."));
      return;
    }
    if (command === "/reject") {
      setPromptText("");
      rejectActionProposal();
      return;
    }
    if (command === "/pending") {
      setPromptText("");
      showPendingActionProposals();
      return;
    }
    if (command === "/clear") {
      if (activeProjectId) {
        window.localStorage.setItem(agentRunClearedStorageKey(activeProjectId), new Date().toISOString());
        void DB.agentRuns.clearActive(activeProjectId).catch((error) => console.error("Failed to end agent run", error));
      }
      setAgentMessages([]);
      agentMessagesRef.current = [];
      setAgentPending(false);
      agentPendingRef.current = false;
      setAgentActivity(null);
      setQueuedAgentInputs([]);
      queuedAgentInputsRef.current = [];
      setLastFailedAgentInput("");
      agentAbortRef.current?.abort();
      agentAbortRef.current = null;
      agentRequestIdRef.current += 1;
      agentReviewRequestIdRef.current += 1;
      setAgentToolPending(false);
      agentToolPendingRef.current = false;
      setAgentDraft(null);
      setAgentRun(null);
      setAgentReviewTargets([]);
      setAgentReviewPending(false);
      setAgentReviewComplete(false);
      setAgentReviewEvaluation(null);
      setAgentRevisionPending(false);
      setAgentRevisionRequested(false);
      setAgentError("");
      setGenerationError("");
      setReferenceReadError("");
      setPromptText("");
      setAgentConsoleOpen(true);
      return;
    }
    addLocalAgentMessage([
      "/generate <prompt> creates an image.",
      "/undo reverses the last workspace change.",
      "/status shows what is currently running.",
      "/retry repeats the latest failed message.",
      "/stop cancels the current agent task.",
      "/clear starts a fresh chat.",
    ].join("\n"), "inspect");
    setPromptText("");
  };

  const submitAgentMessage = async (inputOverride?: string, options?: { retry?: boolean }) => {
    const trimmed = (inputOverride ?? promptText).trim();
    if (!trimmed) return;
    if (agentWorkspaceHydrating || agentPendingRef.current) {
      if (queuedAgentInputsRef.current.length >= MAX_AGENT_QUEUE_LENGTH) {
        setAgentError(`The agent queue is full (${MAX_AGENT_QUEUE_LENGTH} messages). Wait for a turn to finish or use /stop.`);
        return;
      }
      const nextQueue = [...queuedAgentInputsRef.current, trimmed];
      queuedAgentInputsRef.current = nextQueue;
      setQueuedAgentInputs(nextQueue);
      setPromptText("");
      setHistoryIndex(-1);
      setAgentConsoleOpen(true);
      return;
    }
    const currentReferenceFingerprint = fingerprintModuleFiles(moduleFilesRef.current);
    const currentActiveReferences = getGenerationModuleImages(moduleFilesRef.current);
    const referenceReadsAreCurrent = currentActiveReferences.every(hasCurrentReferenceRead);
    if (
      currentActiveReferences.length > 0
      && (
        !referenceReadsAreCurrent
        || referenceSnapshot.sourceFingerprint !== currentReferenceFingerprint
        || referenceReadInFlightRef.current.has(currentReferenceFingerprint)
      )
    ) {
      setAgentError("Current references are still being inspected. The agent will not use an older visual read; try again when the reference scan finishes.");
      setAgentConsoleOpen(true);
      return;
    }
    const createdAt = new Date().toISOString();
    const requestProjectId = activeProjectId;
    const continuingCurrentReferenceRun = agentRun?.referenceFingerprint === currentReferenceFingerprint;
    const previousSession = continuingCurrentReferenceRun ? agentDraft?.session || null : null;
    const retryMessage = options?.retry
      ? [...agentMessagesRef.current].reverse().find((message) => message.role === "user" && message.text.trim() === trimmed)
      : null;
    const userMessage: AgentMessage = retryMessage || {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
      createdAt,
    };
    const latestMessage = agentMessagesRef.current.at(-1);
    const messagesWithoutFailedTurn = options?.retry
      && latestMessage?.role === "system"
      && latestMessage.text.startsWith("AGENT ERROR:")
      ? agentMessagesRef.current.slice(0, -1)
      : agentMessagesRef.current;
    const nextUserMessages = (retryMessage
      ? messagesWithoutFailedTurn
      : [...messagesWithoutFailedTurn, userMessage]).map((message) => (
        message.promptArtifact?.sourceFingerprint
        && message.promptArtifact.sourceFingerprint !== currentReferenceFingerprint
          ? { ...message, promptArtifact: undefined }
          : message
      ));
    setAgentMessages(nextUserMessages);
    agentMessagesRef.current = nextUserMessages;
    agentPendingRef.current = true;
    setAgentPending(true);
    beginAgentActivity("thinking", "Understanding your request", "Reviewing the conversation and deciding what to do next");
    setAgentError("");
    if (trimmed && promptHistory[0] !== trimmed) {
      setPromptHistory([trimmed, ...promptHistory]);
    }
    setHistoryIndex(-1);
    setPromptText("");
    const requestId = ++agentRequestIdRef.current;
    const controller = new AbortController();
    agentAbortRef.current?.abort();
    agentAbortRef.current = controller;
    try {
      updateAgentActivity("reading", "Checking recent images", "Looking for visual context that can improve the response");
      const generations = await inspectGenerationsForMessage(trimmed, currentGenerationEvidence(), controller.signal);
      if (controller.signal.aborted || requestId !== agentRequestIdRef.current) return;
      updateAgentActivity("reading", "Reading the workspace", "Gathering the current project setup and active references");
      const workspace = await currentWorkspace();
      updateAgentActivity("thinking", "Recalling project context", "Loading relevant preferences and earlier decisions");
      const memories = requestProjectId
        ? await recallAgentMemories({
          projectId: requestProjectId,
          sessionId: continuingCurrentReferenceRun ? agentRun?.id : null,
          query: trimmed,
        })
        : [];
      updateAgentActivity("thinking", "Planning the response", "Choosing the clearest next step for your request");
      const response = await requestBriefAgent({
        referenceSnapshot,
        messages: nextUserMessages,
        session: previousSession,
        run: continuingCurrentReferenceRun ? agentRun : null,
        generations,
        workspace,
        memories,
      }, settings.geminiApiKey, controller.signal);
      if (controller.signal.aborted || requestId !== agentRequestIdRef.current) return;
      if (activeProjectIdRef.current !== requestProjectId) {
        throw new Error("Project changed while the agent was working. No app actions were applied.");
      }
      const proposedActions = response.appActions || [];
      const proposalMessage: AgentMessage | null = proposedActions.length && requestProjectId
        ? {
          id: crypto.randomUUID(),
          role: "system",
          text: `APPROVAL REQUIRED - ${proposedActions.length} app action${proposedActions.length === 1 ? "" : "s"}. Review before execution.`,
          action: "inspect",
          createdAt: new Date().toISOString(),
          context: currentReferenceContext(),
          toolProposal: createAgentActionProposal(proposedActions, response.run.id, requestProjectId),
        }
        : null;
      setAgentBrain(response.brain);
      setAgentModel(response.model);
      setAgentDraft(response.draft);
      setAgentRun(response.run);
      setAgentMessages((messages) => [
        ...messages,
        {
          ...response.message,
          context: currentReferenceContext(),
        },
        ...(proposalMessage ? [proposalMessage] : []),
      ]);
      if (requestProjectId) {
        void Promise.all([
          captureUserMessageMemories(trimmed, requestProjectId, response.run.id, userMessage.id),
          captureSessionStateMemory(response.draft.session, requestProjectId, response.run.id),
        ]).catch((error) => console.error("Failed to persist agent memory", error));
      }
      setLastFailedAgentInput("");
      if (response.message.promptArtifact) {
        void handleGenerate(response.message.promptArtifact, response.run, true);
      }
    } catch (error) {
      if (requestId !== agentRequestIdRef.current) return;
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setAgentMessages((messages) => [...messages, {
          id: crypto.randomUUID(),
          role: "system",
          text: "AGENT STOPPED - The current request was cancelled. Active image generation was not interrupted.",
          createdAt: new Date().toISOString(),
        }]);
        return;
      }
      const message = error instanceof Error ? error.message : "Brief agent failed.";
      setLastFailedAgentInput(trimmed);
      setAgentError(message);
      setAgentMessages((messages) => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "system",
          text: `AGENT ERROR: ${message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      if (requestId === agentRequestIdRef.current) {
        agentAbortRef.current = null;
        agentPendingRef.current = false;
        setAgentPending(false);
        setAgentActivity(null);
      }
    }
  };

  useEffect(() => {
    if (agentWorkspaceHydrating || agentPendingRef.current || queuedAgentInputs.length === 0) return;
    const [nextInput, ...remaining] = queuedAgentInputs;
    queuedAgentInputsRef.current = remaining;
    setQueuedAgentInputs(remaining);
    void submitAgentMessage(nextInput);
    // submitAgentMessage intentionally consumes the newest render state after each queued turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentPending, agentWorkspaceHydrating, queuedAgentInputs]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commandMenuOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((index) => (
          e.key === "ArrowDown"
            ? (index + 1) % filteredCommands.length
            : (index - 1 + filteredCommands.length) % filteredCommands.length
        ));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertCanvasCommand(filteredCommands[commandIndex]?.value || filteredCommands[0].value);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCommandMenuOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const localCommand = parseCanvasLocalCommand(promptText);
      if (localCommand) runCanvasLocalCommand(localCommand, promptText);
      else if (parseGenerateCommand(promptText) !== null) void handleGenerate();
      else if (agentConsoleOpen) void submitAgentMessage();
      else {
        setAgentConsoleOpen(true);
        void submitAgentMessage();
      }
    } else if (e.key === "Escape") {
      if (agentPendingRef.current && agentAbortRef.current) {
        setQueuedAgentInputs([]);
        queuedAgentInputsRef.current = [];
        agentAbortRef.current.abort();
        return;
      }
      setPromptText("");
      setCommandMenuOpen(false);
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

  const placeholderText = "Describe an image, ask the agent, or type /help";
  const newestMessages = [...agentMessages].reverse();
  const newestPrompt = newestMessages.find((message) => message.promptArtifact)?.promptArtifact?.prompt || "";
  const pinnedPrompt = agentRun?.currentPrompt && agentRun.currentPrompt !== newestPrompt
    ? agentRun.currentPrompt
    : "";
  const agentIdle = !newestMessages.length
    && !agentPending
    && !agentWorkspaceHydrating
    && !referenceReadPending
    && activeGenerationCount === 0
    && queuedAgentInputs.length === 0
    && !agentError
    && !referenceReadError;
  const agentErrorInTranscript = Boolean(agentError) && agentMessages.some((message) => (
    message.role === "system" && message.text.includes(agentError)
  ));
  const hasGenerateCommand = parseGenerateCommand(promptText) !== null;
  const submitButtonLabel = hasGenerateCommand
    ? activeGenerationCount > 0 ? "Image generation running" : "Generate image"
    : agentPending ? "Queue message" : "Send to agent";
  const consoleStatusLabel = agentWorkspaceHydrating
    ? "RESTORING"
    : agentActivity || activeGenerationCount > 0 || referenceReadPending
      ? "WORKING"
      : queuedAgentInputs.length > 0
        ? `${queuedAgentInputs.length} QUEUED`
        : "READY";

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
          <textarea
            className={`prompt-text-field ${promptText === "" ? "has-placeholder" : ""}`}
            id="promptText"
            value={promptText}
            aria-label="Image prompt"
            aria-controls="agentConsole"
            placeholder={placeholderText}
            rows={1}
            autoComplete="off"
            spellCheck="true"
            ref={inputRef}
            onFocus={() => setAgentConsoleOpen(true)}
            onClick={() => setAgentConsoleOpen(true)}
            onChange={(e) => setPromptText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="prompt-clear-input"
            type="button"
            aria-label="Clear input"
            title="Clear input"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPromptText("");
              setCommandMenuOpen(false);
              setHistoryIndex(-1);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <button
          className={`btn-frame ${activeGenerationCount > 0 ? 'cafe-loading' : ''}`}
          id="generateBtn"
          type="button"
          disabled={hasGenerateCommand && !activeProjectId}
          aria-label={submitButtonLabel}
          title={submitButtonLabel}
          onClick={() => {
            if (parseGenerateCommand(promptText) !== null) void handleGenerate();
            else void submitAgentMessage();
          }}
        >
          <span className="generate-icon" aria-hidden="true"></span>
        </button>
        {commandMenuOpen && filteredCommands.length > 0 && (
          <div className="canvas-command-menu" role="listbox" aria-label="Canvas commands">
            <div className="canvas-command-head">
              <span>COMMAND</span>
              <span>{filteredCommands.length}</span>
            </div>
            {filteredCommands.map((command, index) => (
              <button
                key={command.value}
                type="button"
                className={`canvas-command-option ${index === commandIndex ? "active" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertCanvasCommand(command.value);
                }}
              >
                <span className="canvas-command-label">{command.label}</span>
                <span className="canvas-command-description">{command.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div id="agentConsole" className={`agent-console ${agentConsoleOpen ? "open" : ""}`} aria-hidden={!agentConsoleOpen}>
        <div className="agent-console-header" aria-hidden="true">
          <span>CAFEHTML AGENT</span>
          <span className={consoleStatusLabel === "READY" ? "ready" : "busy"}>{consoleStatusLabel}</span>
        </div>
        <button
          className="agent-console-collapse"
          type="button"
          aria-label="Retract chat"
          title="Retract chat"
          onClick={() => {
            inputRef.current?.blur();
            setAgentConsoleOpen(false);
          }}
        ></button>
        <div className="agent-console-scroll" ref={agentConsoleScrollRef}>
          {(agentWorkspaceHydrating || agentActivity || referenceReadPending || activeGenerationCount > 0) && (
            <div className="agent-activity-list" role="status" aria-live="polite">
              {agentWorkspaceHydrating && (
                <div className="agent-activity restoring">
                  <span className="agent-activity-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span className="agent-activity-copy">
                    <strong>Restoring conversation</strong>
                    <small>Loading the latest project chat</small>
                  </span>
                </div>
              )}
              {agentActivity && (
                <div className={`agent-activity ${agentActivity.kind}`}>
                  <span className="agent-activity-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span className="agent-activity-copy">
                    <span className="agent-activity-title">
                      <strong>{agentActivity.label}</strong>
                      <time>{activityElapsedSeconds}s</time>
                    </span>
                    <small>{agentActivity.detail}</small>
                  </span>
                  {agentPending && (
                    <button
                      type="button"
                      className="agent-activity-stop"
                      onClick={() => agentAbortRef.current?.abort()}
                    >
                      STOP
                    </button>
                  )}
                </div>
              )}
              {referenceReadPending && (
                <div className="agent-activity reading">
                  <span className="agent-activity-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span className="agent-activity-copy">
                    <strong>Reading references</strong>
                    <small>Inspecting the active images for useful visual details</small>
                  </span>
                </div>
              )}
              {activeGenerationCount > 0 && (
                <div className="agent-activity generating">
                  <span className="agent-activity-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span className="agent-activity-copy">
                    <span className="agent-activity-title">
                      <strong>{generationActivity?.stage || "Generating images"}</strong>
                      {generationActivity && <time>{generationActivity.completed}/{generationActivity.total}</time>}
                    </span>
                    <small>{activeGenerationCount === 1 ? "Creating your image" : `${activeGenerationCount} image tasks are running`}</small>
                  </span>
                </div>
              )}
            </div>
          )}
          {agentIdle ? (
            <div className="agent-idle">
              {promptText.trim() && (
                <div className="agent-current-draft">&gt; {promptText}</div>
              )}
              <div className="agent-empty-copy">
                <strong>What should we make?</strong>
                <span>Describe an image or ask the agent to shape the idea with you.</span>
                <small>Press Enter to chat · use /generate to create immediately</small>
              </div>
            </div>
          ) : (
            <>
              {pinnedPrompt && (
                <div className="agent-section agent-current-prompt">
                  <div className="agent-speaker">CURRENT PROMPT</div>
                  <div className="agent-prompt-box">{pinnedPrompt}</div>
                </div>
              )}
              <div
                className="agent-section agent-transcript"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={agentPending || agentWorkspaceHydrating}
              >
                {newestMessages.map((message) => (
                  <div className={`agent-turn ${message.role}`} key={message.id}>
                    {message.role !== "user" && (
                      <div className="agent-speaker">CAFEHTML</div>
                    )}
                    {message.text.split("\n").map((line, index) => (
                      <div className="agent-line" key={`${message.id}-${index}`}>
                        {message.role === "user" ? `> ${line}` : line}
                      </div>
                    ))}
                    {message.id === newestMessages[0]?.id
                      && message.role === "system"
                      && message.text.startsWith("AGENT ERROR:")
                      && lastFailedAgentInput && (
                        <button
                          className="agent-retry-turn"
                          type="button"
                          disabled={agentPending}
                          onClick={() => void submitAgentMessage(lastFailedAgentInput, { retry: true })}
                        >
                          RETRY
                        </button>
                    )}
                    {message.promptArtifact && (
                      <div className="agent-prompt-draft agent-turn-artifact">
                        <div className="agent-artifact-head">
                          <span>&gt; <mark>{message.promptArtifact.title}</mark></span>
                          <button type="button" onClick={() => stagePromptArtifact(message.promptArtifact!)}>EDIT</button>
                          <span className="agent-auto-run-status">
                            {activeGenerationCount > 0 && flattenPromptArtifact(agentRun?.currentPrompt || "") === flattenPromptArtifact(message.promptArtifact.prompt)
                              ? "GENERATING"
                              : agentRun?.generationIds.length && flattenPromptArtifact(agentRun.currentPrompt) === flattenPromptArtifact(message.promptArtifact.prompt)
                                ? "GENERATED"
                                : canApprovePromptArtifact(message.promptArtifact!) ? "AUTO-RUN READY" : "DRAFT"}
                          </span>
                        </div>
                        <div className="agent-prompt-box">
                          {message.promptArtifact.prompt}
                        </div>
                        {message.promptArtifact.previousPrompt && (() => {
                          const changes = promptLexicalDiff(message.promptArtifact.previousPrompt!, message.promptArtifact!.prompt);
                          return (
                            <div className="agent-prompt-changes">
                              <div className="agent-line agent-muted">ADDED: {changes.added.join(" · ") || "No unique terms"}</div>
                              <div className="agent-line agent-muted">REMOVED: {changes.removed.join(" · ") || "No unique terms"}</div>
                            </div>
                          );
                        })()}
                        {message.promptArtifact.sourceFingerprint && message.promptArtifact.sourceFingerprint !== referenceFingerprint && (
                          <div className="agent-line agent-muted">&gt; REFS CHANGED SINCE THIS PROMPT.</div>
                        )}
                      </div>
                    )}
                    {message.toolProposal && (
                      <div className={`agent-tool-proposal status-${message.toolProposal.status}`}>
                        <div className="agent-artifact-head">
                          <span>&gt; <mark>APP ACTIONS</mark></span>
                          <span className="agent-tool-status">{message.toolProposal.status.replace("_", " ").toUpperCase()}</span>
                        </div>
                        <div className="agent-tool-actions">
                          {message.toolProposal.actions.map((action, index) => (
                            <div key={action.id}>{index + 1}. {describeAgentAppAction(action)}</div>
                          ))}
                        </div>
                        {message.toolProposal.error && (
                          <div className="agent-line agent-muted">{message.toolProposal.error}</div>
                        )}
                        {message.toolProposal.status === "pending" && (
                          <div className="agent-tool-controls">
                            <button
                              type="button"
                              disabled={agentPending || agentToolPending}
                              onClick={() => void approveActionProposal(message.id)}
                            >
                              APPROVE
                            </button>
                            <button
                              type="button"
                              disabled={agentPending || agentToolPending}
                              onClick={() => rejectActionProposal(message.id)}
                            >
                              REJECT
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {message.options && message.options.length > 0 && (
                      <div className="agent-direction-options" aria-label="Agent directions">
                        {message.options.map((option, index) => (
                          <button
                            type="button"
                            key={`${message.id}-${option.id}`}
                            disabled={agentPending}
                            onClick={() => void submitAgentMessage(option.submitText)}
                          >
                            <span>{index + 1}</span>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {queuedAgentInputs.length > 0 && (
                  <div className="agent-turn system agent-queue" aria-live="polite">
                    <div className="agent-speaker">UP NEXT</div>
                    <div className="agent-line agent-muted">{queuedAgentInputs.length} message{queuedAgentInputs.length === 1 ? "" : "s"} waiting</div>
                  </div>
                )}
                {agentError && !agentErrorInTranscript && (
                  <div className="agent-turn system">
                    <div className="agent-speaker">CAFEHTML</div>
                    <div className="agent-line agent-muted">Error: {agentError}</div>
                    {lastFailedAgentInput && (
                      <button
                        className="agent-retry-turn"
                        type="button"
                        disabled={agentPending}
                        onClick={() => void submitAgentMessage(lastFailedAgentInput, { retry: true })}
                      >
                        RETRY
                      </button>
                    )}
                  </div>
                )}
                {agentReviewTargets.length > 0 && !agentReviewComplete && (
                  <div className="agent-turn system">
                    <div className="agent-speaker">CAFEHTML</div>
                    <div className="agent-line agent-muted">Optional visual check of the first generated result.</div>
                    <button
                      type="button"
                      disabled={agentReviewPending}
                      onClick={() => void handleReviewAgentGeneration()}
                    >
                      {agentReviewPending ? "REVIEWING" : "REVIEW"}
                    </button>
                  </div>
                )}
                {agentReviewComplete && agentReviewEvaluation && !agentRevisionRequested && (
                  <div className="agent-turn system">
                    <div className="agent-speaker">CAFEHTML</div>
                    <div className="agent-line agent-muted">Create a revised prompt from the review evidence. A new generation will still require approval.</div>
                    <button
                      type="button"
                      disabled={agentRevisionPending}
                      onClick={() => void handleImprovePromptFromReview()}
                    >
                      {agentRevisionPending ? "REVISING" : "IMPROVE PROMPT"}
                    </button>
                  </div>
                )}
              </div>
              {referenceReadError && (
                <div className="agent-section agent-reference">
                  <div className="agent-line agent-muted">&gt; READER STATUS: <mark>{referenceReadError}</mark></div>
                </div>
              )}
              {promptText.trim() && (
                <div className="agent-current-draft">&gt; {promptText}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}





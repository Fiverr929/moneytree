"use client";

import React, { useEffect, useRef, useState } from "react";
import TitleBar from "@/components/TitleBar";
import ProjectsModal from "@/components/ProjectsModal";
import SettingsModal from "@/components/SettingsModal";
import { useApp } from "@/context/AppContext";
import { useGallery } from "@/context/GalleryContext";
import DB from "@/lib/db";
import { generateVeoVideo } from "@/lib/video/api";

const VIDEO_SETTINGS_KEY = "cafehtml-video-settings";
const VIDEO_PROMPT_DRAFT_KEY = "cafehtml-video-prompt";

type VideoModelKey = "veo-3.1" | "veo-3.1-fast" | "veo-3.1-lite";
type VideoRatio = "16:9" | "9:16";
type VideoDuration = 4 | 6 | 8;
type VideoResolution = "720p" | "1080p";
type VideoInputMode = "frames" | "references";

type VideoSettings = {
  model: VideoModelKey;
  inputMode: VideoInputMode;
  ratio: VideoRatio;
  duration: VideoDuration;
  resolution: VideoResolution;
  variations: number;
  seed: string;
};

type VideoMedia = {
  id: string;
  name: string;
  url: string;
  source: "gallery" | "upload";
};

type MediaFolder = "root" | "image" | "video" | "uploads";

type GeneratedVideoClip = {
  id: string;
  url?: string;
  blob?: Blob;
  poster?: string;
  duration: VideoDuration;
  status: "loading" | "ready" | "failed";
  error?: string;
  prompt?: string;
  modelId?: string;
  aspectRatio?: VideoRatio;
  createdAt?: string;
  sequenceOrder?: number;
};

type StoredVideoRecord = {
  id: string;
  project_id: number;
  blob: Blob;
  mimeType: string;
  duration: VideoDuration;
  prompt: string;
  modelId: string;
  aspectRatio?: VideoRatio;
  createdAt: string;
  sequenceOrder: number;
};

function readVideoAspectRatio(blob: Blob): Promise<VideoRatio> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    const finish = (ratio: VideoRatio) => {
      URL.revokeObjectURL(url);
      resolve(ratio);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.videoHeight > video.videoWidth ? "9:16" : "16:9");
    video.onerror = () => finish("16:9");
    video.src = url;
  });
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

const VIDEO_MODELS: Record<VideoModelKey, {
  id: string;
  label: string;
  resolutions: VideoResolution[];
  supportsReferences: boolean;
  maxReferences: number;
}> = {
  "veo-3.1": {
    id: "veo-3.1-generate-001",
    label: "VEO 3.1",
    resolutions: ["720p", "1080p"],
    supportsReferences: true,
    maxReferences: 3,
  },
  "veo-3.1-fast": {
    id: "veo-3.1-fast-generate-001",
    label: "VEO 3.1 FAST",
    resolutions: ["720p", "1080p"],
    supportsReferences: true,
    maxReferences: 3,
  },
  "veo-3.1-lite": {
    id: "veo-3.1-lite-generate-001",
    label: "VEO 3.1 LITE",
    resolutions: ["720p", "1080p"],
    supportsReferences: false,
    maxReferences: 0,
  },
};

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  model: "veo-3.1-fast",
  inputMode: "frames",
  ratio: "16:9",
  duration: 8,
  resolution: "720p",
  variations: 1,
  seed: "",
};

function normalizeVideoSettings(settings: VideoSettings): VideoSettings {
  const model = VIDEO_MODELS[settings.model] || VIDEO_MODELS[DEFAULT_VIDEO_SETTINGS.model];
  const inputMode = settings.inputMode === "references" && model.supportsReferences
    ? "references"
    : "frames";
  const resolution = model.resolutions.includes(settings.resolution)
    ? settings.resolution
    : model.resolutions[0];
  const duration = resolution === "720p" && inputMode !== "references" ? settings.duration : 8;

  return {
    ...settings,
    model: settings.model in VIDEO_MODELS ? settings.model : DEFAULT_VIDEO_SETTINGS.model,
    inputMode,
    ratio: settings.ratio === "9:16" ? "9:16" : "16:9",
    duration: [4, 6, 8].includes(duration) ? duration : 8,
    resolution,
    variations: Math.min(4, Math.max(1, settings.variations || 1)),
    seed: settings.seed.replace(/\D/g, "").slice(0, 10),
  };
}

export default function VideoPage() {
  const { activeProjectId } = useApp();
  const { cells: galleryCells } = useGallery();
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [media, setMedia] = useState<VideoMedia[]>([]);
  const [mediaFolder, setMediaFolder] = useState<MediaFolder>("root");
  const [startFrameId, setStartFrameId] = useState<string | null>(null);
  const [endFrameId, setEndFrameId] = useState<string | null>(null);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [activeInputSlot, setActiveInputSlot] = useState("start");
  const [generatedClips, setGeneratedClips] = useState<GeneratedVideoClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [generationError, setGenerationError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [draftProjectId, setDraftProjectId] = useState<number | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const generatedClipsRef = useRef<GeneratedVideoClip[]>([]);
  const activeProjectIdRef = useRef<number | null>(activeProjectId);
  const discardedClipIdsRef = useRef(new Set<string>());

  const modelConfig = VIDEO_MODELS[videoSettings.model];
  const durationLocked = videoSettings.resolution !== "720p" || videoSettings.inputMode === "references";
  const sequenceClips = generatedClips.filter((clip) => (clip.sequenceOrder ?? -1) >= 0);
  const selectedClip = generatedClips.find((clip) => clip.id === selectedClipId);
  const hasSelectedVideo = !!selectedClip?.url;
  const galleryMedia: VideoMedia[] = galleryCells
    .filter((cell) => cell.kind === "image" && !!cell.imgUrl && !cell.loadingId && !cell.blocked && !cell.error)
    .map((cell) => ({
      id: `gallery:${cell.uuid || cell.id}`,
      name: cell.type || "Gallery image",
      url: cell.imgUrl!,
      source: "gallery",
    }));
  const allMedia = [...galleryMedia, ...media];
  const mediaById = new Map(allMedia.map((item) => [item.id, item]));
  const visibleMedia = mediaFolder === "image"
    ? galleryMedia
    : mediaFolder === "uploads"
      ? media
      : [];
  const mediaIdsKey = allMedia.map((item) => item.id).join("|");

  useEffect(() => {
    if (videoSettings.inputMode === "frames") {
      setActiveInputSlot((current) => current === "end" ? "end" : "start");
      return;
    }
    setReferenceIds((current) => current.slice(0, modelConfig.maxReferences));
    setActiveInputSlot((current) => current.startsWith("ref-") ? current : "ref-0");
  }, [modelConfig.maxReferences, videoSettings.inputMode]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIDEO_SETTINGS_KEY);
      if (saved) {
        setVideoSettings(normalizeVideoSettings({
          ...DEFAULT_VIDEO_SETTINGS,
          ...JSON.parse(saved),
        }));
      }
    } catch {
      // Keep defaults when local storage is unavailable or invalid.
    }
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    setDraftProjectId(null);
    try {
      setPrompt(window.localStorage.getItem(`${VIDEO_PROMPT_DRAFT_KEY}:${activeProjectId || "none"}`) || "");
    } catch {
      setPrompt("");
    }
    setDraftProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || draftProjectId !== activeProjectId) return;
    try {
      window.localStorage.setItem(`${VIDEO_PROMPT_DRAFT_KEY}:${activeProjectId}`, prompt);
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [activeProjectId, draftProjectId, prompt]);

  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => false);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(VIDEO_SETTINGS_KEY, JSON.stringify(videoSettings));
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [settingsLoaded, videoSettings]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const availableIds = new Set(mediaIdsKey ? mediaIdsKey.split("|") : []);
    setStartFrameId((current) => current && availableIds.has(current) ? current : null);
    setEndFrameId((current) => current && availableIds.has(current) ? current : null);
    setReferenceIds((current) => current.map((id) => id && availableIds.has(id) ? id : ""));
  }, [mediaIdsKey]);

  useEffect(() => {
    generatedClipsRef.current = generatedClips;
  }, [generatedClips]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setPlaybackDuration(0);
  }, [selectedClipId]);

  useEffect(() => {
    let cancelled = false;

    setMedia([]);
    setMediaFolder("root");
    setStartFrameId(null);
    setEndFrameId(null);
    setReferenceIds([]);
    setActiveInputSlot("start");
    generatedClipsRef.current.forEach((clip) => {
      if (clip.url?.startsWith("blob:")) URL.revokeObjectURL(clip.url);
    });
    setGeneratedClips([]);
    setSelectedClipId(null);
    setGenerationError("");

    if (!activeProjectId) return () => {
      cancelled = true;
    };

    DB.videos.getByProject(activeProjectId)
      .then((records) => {
        if (cancelled) return;
        return Promise.all(
          (records as StoredVideoRecord[])
            .sort((a, b) => a.sequenceOrder - b.sequenceOrder || a.createdAt.localeCompare(b.createdAt))
            .map(async (record) => {
              const aspectRatio = record.aspectRatio || await readVideoAspectRatio(record.blob);
              if (!record.aspectRatio) {
                void DB.videos.put({ ...record, aspectRatio }).catch(console.error);
              }
              return {
                id: record.id,
                url: URL.createObjectURL(record.blob),
                blob: record.blob,
                duration: record.duration,
                status: "ready" as const,
                prompt: record.prompt,
                modelId: record.modelId,
                aspectRatio,
                createdAt: record.createdAt,
                sequenceOrder: record.sequenceOrder,
              };
            }),
        );
      })
      .then((clips) => {
        if (!clips) return;
        if (cancelled) {
          clips.forEach((clip) => URL.revokeObjectURL(clip.url));
          return;
        }
        setGeneratedClips(clips);
        setSelectedClipId(clips.find((clip) => clip.sequenceOrder >= 0)?.id || clips[0]?.id || null);
      })
      .catch((error) => {
        if (!cancelled) setGenerationError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => () => {
    generatedClipsRef.current.forEach((clip) => {
      if (clip.url?.startsWith("blob:")) URL.revokeObjectURL(clip.url);
    });
  }, []);

  const updateVideoSettings = (patch: Partial<VideoSettings>) => {
    setVideoSettings((current) => normalizeVideoSettings({ ...current, ...patch }));
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) {
      void player.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotAllowedError") return;
        console.error("[Video player] Playback failed:", error);
      });
    } else {
      player.pause();
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (!playerRef.current || !Number.isFinite(nextTime)) return;
    playerRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMute = () => {
    const player = playerRef.current;
    if (!player) return;
    player.muted = !player.muted;
    setIsMuted(player.muted);
  };

  const toggleFullscreen = async () => {
    if (!previewRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await previewRef.current.requestFullscreen();
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Fullscreen is unavailable.");
    }
  };

  const handleMediaUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const files = selectedFiles.filter((file) => (
      ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024
    ));
    if (files.length !== selectedFiles.length) {
      setGenerationError("Some uploads were skipped. Use JPEG, PNG, or WebP files up to 10 MB.");
    }
    if (!files.length) {
      event.target.value = "";
      return;
    }

    try {
      const additions = await Promise.all(files.map((file) => new Promise<VideoMedia>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: `upload:${crypto.randomUUID()}`,
          name: file.name,
          url: String(reader.result),
          source: "upload",
        });
        reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      })));

      setMedia((current) => [...current, ...additions]);
      setMediaFolder("uploads");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Could not load the selected images.");
    } finally {
      event.target.value = "";
    }
  };

  const handleMediaAssignment = (id: string) => {
    if (videoSettings.inputMode === "references") {
      const slotIndex = Number(activeInputSlot.replace("ref-", ""));
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= modelConfig.maxReferences) return;
      setReferenceIds((current) => {
        const next = Array.from({ length: modelConfig.maxReferences }, (_, index) => current[index] || "");
        const previousIndex = next.indexOf(id);
        if (previousIndex >= 0) next[previousIndex] = "";
        next[slotIndex] = id;
        return next;
      });
      return;
    }

    if (activeInputSlot === "start") {
      if (endFrameId === id) setEndFrameId(null);
      setStartFrameId(id);
    } else {
      if (startFrameId === id) setStartFrameId(null);
      setEndFrameId(id);
    }
  };

  const removeMedia = (id: string) => {
    if (!id.startsWith("upload:")) return;
    setMedia((current) => current.filter((entry) => entry.id !== id));
    setStartFrameId((current) => current === id ? null : current);
    setEndFrameId((current) => current === id ? null : current);
    setReferenceIds((current) => current.map((entry) => entry === id ? "" : entry));
  };

  const removeGeneratedClip = (id: string) => {
    const clip = generatedClips.find((entry) => entry.id === id);
    const clipIndex = generatedClips.findIndex((entry) => entry.id === id);
    const nextSelectedId = generatedClips[clipIndex + 1]?.id || generatedClips[clipIndex - 1]?.id || null;
    if (clip?.status === "loading") discardedClipIdsRef.current.add(id);
    if (clip?.url?.startsWith("blob:")) URL.revokeObjectURL(clip.url);
    setGeneratedClips((current) => current.filter((entry) => entry.id !== id));
    setSelectedClipId((selectedId) => selectedId === id ? nextSelectedId : selectedId);
    void DB.videos.delete(id).catch((error) => {
      setGenerationError(error instanceof Error ? error.message : String(error));
    });
  };

  const removeClipFromSequence = (id: string) => {
    const remaining = sequenceClips.filter((clip) => clip.id !== id);
    const nextSelectedId = remaining[0]?.id || null;
    setGeneratedClips((current) => current.map((clip) => {
      if (clip.id === id) return { ...clip, sequenceOrder: -1 };
      const nextIndex = remaining.findIndex((entry) => entry.id === clip.id);
      return nextIndex >= 0 ? { ...clip, sequenceOrder: nextIndex } : clip;
    }));
    setSelectedClipId((selectedId) => selectedId === id ? nextSelectedId : selectedId);

    if (!activeProjectId) return;
    const records = generatedClips
      .filter((clip): clip is GeneratedVideoClip & { blob: Blob } => clip.status === "ready" && !!clip.blob)
      .map((clip) => {
        const nextIndex = remaining.findIndex((entry) => entry.id === clip.id);
        return {
          id: clip.id,
          project_id: activeProjectId,
          blob: clip.blob,
          mimeType: clip.blob.type || "video/mp4",
          duration: clip.duration,
          prompt: clip.prompt || "",
          modelId: clip.modelId || "",
          aspectRatio: clip.aspectRatio,
          createdAt: clip.createdAt || new Date().toISOString(),
          sequenceOrder: nextIndex,
        };
      });
    void DB.videos.putMany(records).catch((error) => {
      setGenerationError(error instanceof Error ? error.message : String(error));
    });
  };
  const placeDraggedClipInSequence = (targetId: string | null) => {
    if (activeGenerationCount > 0 || !draggedClipId) return;
    const draggedClip = generatedClips.find((clip) => clip.id === draggedClipId);
    if (!draggedClip || draggedClip.status !== "ready") return;
    if (targetId === draggedClipId && sequenceClips.some((clip) => clip.id === draggedClipId)) {
      setDraggedClipId(null);
      return;
    }

    const reordered = sequenceClips.filter((clip) => clip.id !== draggedClipId);
    const targetIndex = targetId ? reordered.findIndex((clip) => clip.id === targetId) : -1;
    reordered.splice(targetIndex >= 0 ? targetIndex : reordered.length, 0, draggedClip);
    setGeneratedClips((current) => current.map((clip) => {
      const nextIndex = reordered.findIndex((entry) => entry.id === clip.id);
      return nextIndex >= 0 ? { ...clip, sequenceOrder: nextIndex } : clip;
    }));
    setSelectedClipId(draggedClipId);

    if (activeProjectId) {
      const records = generatedClips
        .filter((clip): clip is GeneratedVideoClip & { blob: Blob } => clip.status === "ready" && !!clip.blob)
        .map((clip) => {
          const nextIndex = reordered.findIndex((entry) => entry.id === clip.id);
          return {
            id: clip.id,
            project_id: activeProjectId,
            blob: clip.blob,
            mimeType: clip.blob.type || "video/mp4",
            duration: clip.duration,
            prompt: clip.prompt || "",
            modelId: clip.modelId || "",
            aspectRatio: clip.aspectRatio,
            createdAt: clip.createdAt || new Date().toISOString(),
            sequenceOrder: nextIndex,
          };
        });
      void DB.videos.putMany(records).catch((error) => {
        setGenerationError(error instanceof Error ? error.message : String(error));
      });
    }
    setDraggedClipId(null);
  };
  const handleGenerate = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || activeGenerationCount > 0 || !activeProjectId) return;
    const launchProjectId = activeProjectId;
    const startFrame = startFrameId ? mediaById.get(startFrameId)?.url : undefined;
    const endFrame = endFrameId ? mediaById.get(endFrameId)?.url : undefined;
    const references = referenceIds
      .map((id) => id ? mediaById.get(id)?.url : undefined)
      .filter((url): url is string => !!url);

    if (videoSettings.inputMode === "frames" && endFrame && !startFrame) {
      setGenerationError("Select a START frame before using an END frame.");
      return;
    }
    if (videoSettings.inputMode === "references" && !references.length) {
      setGenerationError("Select at least one reference image.");
      return;
    }

    const baseSequenceOrder = generatedClips.reduce(
      (highest, clip) => Math.max(highest, clip.sequenceOrder ?? -1),
      -1,
    ) + 1;
    const loadingClips = Array.from({ length: videoSettings.variations }, (_, variationIndex) => ({
      id: crypto.randomUUID(),
      duration: videoSettings.duration,
      status: "loading" as const,
      sequenceOrder: baseSequenceOrder + variationIndex,
    }));
    setGeneratedClips((current) => [...current, ...loadingClips]);
    setSelectedClipId(loadingClips[0]?.id || null);
    setActiveGenerationCount((count) => count + loadingClips.length);
    setGenerationError("");

    loadingClips.forEach((loadingClip, variationIndex) => {
      const seed = videoSettings.seed
        ? Number(videoSettings.seed) + variationIndex
        : undefined;

      generateVeoVideo({
        modelId: modelConfig.id,
        prompt: trimmedPrompt,
        aspectRatio: videoSettings.ratio,
        durationSeconds: videoSettings.duration,
        resolution: videoSettings.resolution,
        seed,
        startFrame: videoSettings.inputMode === "frames" ? startFrame : undefined,
        endFrame: videoSettings.inputMode === "frames" ? endFrame : undefined,
        referenceImages: videoSettings.inputMode === "references" ? references : undefined,
      })
        .then(async ({ blob }) => {
          if (discardedClipIdsRef.current.has(loadingClip.id)) return;
          const createdAt = new Date().toISOString();
          await DB.videos.put({
            id: loadingClip.id,
            project_id: launchProjectId,
            blob,
            mimeType: blob.type || "video/mp4",
            duration: videoSettings.duration,
            prompt: trimmedPrompt,
            modelId: modelConfig.id,
            aspectRatio: videoSettings.ratio,
            createdAt,
            sequenceOrder: baseSequenceOrder + variationIndex,
          } satisfies StoredVideoRecord);
          if (activeProjectIdRef.current !== launchProjectId) return;
          const readyClip: GeneratedVideoClip = {
            ...loadingClip,
            url: URL.createObjectURL(blob),
            blob,
            status: "ready",
            prompt: trimmedPrompt,
            modelId: modelConfig.id,
            aspectRatio: videoSettings.ratio,
            createdAt,
            sequenceOrder: baseSequenceOrder + variationIndex,
          };
          setGeneratedClips((current) => (
            current.some((clip) => clip.id === loadingClip.id)
              ? current.map((clip) => clip.id === loadingClip.id ? readyClip : clip)
              : [...current, readyClip].sort(
                (a, b) => (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER),
              )
          ));
          setSelectedClipId(loadingClip.id);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (activeProjectIdRef.current === launchProjectId) {
            setGenerationError(message);
            setGeneratedClips((current) => current.map((clip) => (
              clip.id === loadingClip.id
                ? { ...clip, status: "failed", error: message }
                : clip
            )));
          }
          console.error("[Veo] Generation failed:", error);
        })
        .finally(() => {
          discardedClipIdsRef.current.delete(loadingClip.id);
          setActiveGenerationCount((count) => Math.max(0, count - 1));
        });
    });
  };

  return (
    <>
      <TitleBar />
      <main className="video-page">
        <section className="video-stage">
          <div className="video-workspace">
            <aside className="video-media-panel">
              <div className="video-media-header">
                {mediaFolder === "root" ? (
                  <span className="video-media-root-title">MEDIA</span>
                ) : (
                  <>
                    <button
                      className="video-media-back"
                      type="button"
                      title="Back to media folders"
                      aria-label="Back to media folders"
                      onClick={() => setMediaFolder("root")}
                    >
                      &lsaquo;
                    </button>
                    <span className="video-media-breadcrumb">
                      <span>ROOT</span>
                      <span aria-hidden="true">&rsaquo;</span>
                      <b>{mediaFolder === "image" ? "IMAGE" : mediaFolder === "video" ? "VIDEO" : "UPLOADS"}</b>
                    </span>
                  </>
                )}
                {mediaFolder !== "video" && (
                  <button className="video-media-add" type="button" title="Add images" onClick={() => mediaInputRef.current?.click()}>+</button>
                )}
              </div>
              <div className={`video-media-grid ${mediaFolder === "root" ? "folders" : "thumbnails"}`}>
                {mediaFolder === "root" ? (
                  <>
                    <button className="video-media-folder" type="button" onClick={() => setMediaFolder("image")}>
                      <span className="video-media-folder-icon"></span>
                      <span className="video-media-folder-name">IMAGE</span>
                      <span className="video-media-folder-count">{galleryMedia.length}</span>
                    </button>
                    <button className="video-media-folder" type="button" onClick={() => setMediaFolder("video")}>
                      <span className="video-media-folder-icon"></span>
                      <span className="video-media-folder-name">VIDEO</span>
                      <span className="video-media-folder-count">{generatedClips.filter((clip) => clip.status === "ready").length}</span>
                    </button>
                    <button className="video-media-folder" type="button" onClick={() => setMediaFolder("uploads")}>
                      <span className="video-media-folder-icon"></span>
                      <span className="video-media-folder-name">UPLOADS</span>
                      <span className="video-media-folder-count">{media.length}</span>
                    </button>
                  </>
                ) : mediaFolder === "video" ? (
                  generatedClips
                    .filter((clip) => clip.status === "ready" && !!clip.url)
                    .map((clip) => (
                      <div
                        className={`video-media-item video ${selectedClipId === clip.id ? "assigned" : ""}`}
                        key={clip.id}
                        draggable={activeGenerationCount === 0}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", clip.id);
                          setDraggedClipId(clip.id);
                        }}
                        onDragEnd={() => setDraggedClipId(null)}
                        onClick={() => setSelectedClipId(clip.id)}
                      >
                        <video src={clip.url} muted preload="metadata" />
                        <button
                          type="button"
                          title="Delete video"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeGeneratedClip(clip.id);
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    ))
                ) : (
                  visibleMedia.map((item) => (
                    <div
                      className="video-media-item"
                      key={item.id}
                      onClick={() => handleMediaAssignment(item.id)}
                    >
                      <img src={item.url} alt={item.name} loading="lazy" decoding="async" />
                      {item.source === "upload" && (
                        <button
                          type="button"
                          title="Remove image"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeMedia(item.id);
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              <input
                ref={mediaInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleMediaUpload}
              />
            </aside>

            <div
              ref={previewRef}
              className={`video-preview ${hasSelectedVideo ? "has-video" : "empty"}`}
            >
              <div className="video-player-surface">
                <div className="video-monitor-frame">
                  {selectedClip?.url ? (
                      <video
                        ref={playerRef}
                        key={selectedClip.id}
                        src={selectedClip.url}
                        poster={selectedClip.poster}
                        muted={isMuted}
                        playsInline
                        tabIndex={0}
                        aria-label={isPlaying ? "Pause video" : "Play video"}
                        onClick={togglePlayback}
                        onDoubleClick={() => void toggleFullscreen()}
                        onKeyDown={(event) => {
                          if (event.key === " " || event.key === "Enter") {
                            event.preventDefault();
                            togglePlayback();
                          }
                        }}
                        onLoadedMetadata={(event) => {
                          setPlaybackDuration(event.currentTarget.duration || 0);
                          event.currentTarget.volume = 1;
                          event.currentTarget.muted = isMuted;
                        }}
                        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                        onDurationChange={(event) => setPlaybackDuration(event.currentTarget.duration || 0)}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                      />
                  ) : (
                    <>
                    <div className="video-frame-grid">
                      <div className="video-frame-line vertical"></div>
                      <div className="video-frame-line horizontal"></div>
                    </div>
                    <div className="video-playhead">
                      <span></span>
                    </div>
                    </>
                  )}
                </div>
              </div>
              <div className="video-player-footer">
                <button
                  className="video-control-button"
                  type="button"
                  title={isPlaying ? "Pause" : "Play"}
                  aria-label={isPlaying ? "Pause video" : "Play video"}
                  disabled={!hasSelectedVideo}
                  onClick={togglePlayback}
                >
                  {isPlaying ? "II" : "\u25B6"}
                </button>
                <span className="video-player-time">
                  {formatVideoTime(currentTime)} / {formatVideoTime(playbackDuration)}
                </span>
                <input
                  className="video-player-progress"
                  type="range"
                  min="0"
                  max={playbackDuration || 0}
                  step="0.01"
                  value={Math.min(currentTime, playbackDuration || 0)}
                  aria-label="Video position"
                  disabled={!hasSelectedVideo}
                  style={{ "--video-progress": `${playbackDuration ? (currentTime / playbackDuration) * 100 : 0}%` } as React.CSSProperties}
                  onChange={handleSeek}
                />
                <button
                  className={`video-control-button video-volume-toggle ${isMuted ? "muted" : ""}`}
                  type="button"
                  title={isMuted ? "Unmute" : "Mute"}
                  aria-label={isMuted ? "Unmute video" : "Mute video"}
                  disabled={!hasSelectedVideo}
                  onClick={toggleMute}
                >
                  {isMuted ? "MUTE" : "VOL"}
                </button>
              </div>
            </div>
          </div>

          <section className="video-sequence-panel">
            <div className="video-sequence-header">
              <span>SEQUENCE</span>
              {generationError ? (
                <button type="button" title={generationError} onClick={() => setGenerationError("")}>
                  {generationError}
                </button>
              ) : (
                <span>{sequenceClips.length} CLIP{sequenceClips.length === 1 ? "" : "S"}</span>
              )}
            </div>
            <div
              className="video-sequence-track"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                placeDraggedClipInSequence(null);
              }}
            >
              {sequenceClips.map((clip, index) => (
                <div
                  key={clip.id}
                  className={`video-sequence-clip ${selectedClipId === clip.id ? "active" : ""} ${clip.status}`}
                  title={clip.error || `Clip ${index + 1}`}
                  draggable={clip.status === "ready" && activeGenerationCount === 0}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", clip.id);
                    setDraggedClipId(clip.id);
                  }}
                  onDragEnd={() => setDraggedClipId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    placeDraggedClipInSequence(clip.id);
                  }}
                  onClick={() => setSelectedClipId(clip.id)}
                >
                  {clip.poster ? (
                    <img src={clip.poster} alt={`Generated clip ${index + 1}`} />
                  ) : clip.url ? (
                    <video src={clip.url} muted preload="metadata" />
                  ) : (
                    <div className="video-sequence-loading"></div>
                  )}
                  {clip.status === "failed" && <span className="video-sequence-error">FAILED</span>}
                  <span className="video-sequence-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="video-sequence-duration">{clip.duration}S</span>
                  <button
                    type="button"
                    title="Remove clip"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeClipFromSequence(clip.id);
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="video-prompt-bar" data-state="SCENE">
            <div className={`video-prompt-slots ${videoSettings.inputMode}`}>
              {videoSettings.inputMode === "frames" ? (
                [
                  { key: "start", label: "START", mediaId: startFrameId },
                  { key: "end", label: "END", mediaId: endFrameId },
                ].map((slot) => {
                  const item = slot.mediaId ? mediaById.get(slot.mediaId) : undefined;
                  return (
                    <div
                      key={slot.key}
                      className={`video-prompt-slot ${activeInputSlot === slot.key ? "active" : ""} ${item ? "filled" : ""}`}
                    >
                      <button
                        className="video-prompt-slot-select"
                        type="button"
                        title={item ? `${slot.label} frame` : `Select ${slot.label.toLowerCase()} frame`}
                        onClick={() => {
                          setActiveInputSlot(slot.key);
                          if (!item) setMediaFolder("image");
                        }}
                      >
                        {item ? <img src={item.url} alt={slot.label} /> : <span className="video-prompt-slot-plus"></span>}
                      </button>
                      {item && (
                        <button
                          className="video-prompt-slot-remove"
                          type="button"
                          title={`Remove ${slot.label.toLowerCase()} frame`}
                          onClick={() => {
                            if (slot.key === "start") setStartFrameId(null);
                            else setEndFrameId(null);
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                Array.from({ length: modelConfig.maxReferences }, (_, index) => {
                  const item = referenceIds[index] ? mediaById.get(referenceIds[index]) : undefined;
                  const slotKey = `ref-${index}`;
                  return (
                    <div
                      key={slotKey}
                      className={`video-prompt-slot ${activeInputSlot === slotKey ? "active" : ""} ${item ? "filled" : ""}`}
                    >
                      <button
                        className="video-prompt-slot-select"
                        type="button"
                        title={item ? `Reference ${index + 1}` : `Select reference ${index + 1}`}
                        onClick={() => {
                          setActiveInputSlot(slotKey);
                          if (!item) setMediaFolder("image");
                        }}
                      >
                        {item ? <img src={item.url} alt={`Reference ${index + 1}`} /> : <span className="video-prompt-slot-plus"></span>}
                      </button>
                      {item && (
                        <button
                          className="video-prompt-slot-remove"
                          type="button"
                          title={`Remove reference ${index + 1}`}
                          onClick={() => {
                            setReferenceIds((current) => current.map((entry, entryIndex) => entryIndex === index ? "" : entry));
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="video-settings-anchor" ref={settingsRef}>
              <button
                className={`video-settings-btn ${settingsOpen ? "open" : ""}`}
                type="button"
                title="Video settings"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <img src="/assets/icon-settings.svg" alt="settings" />
              </button>

              <div className="cmp-menu video-settings-dropdown" hidden={!settingsOpen}>
                <div className="cmp-menu-title">MODEL</div>
                {(Object.keys(VIDEO_MODELS) as VideoModelKey[]).map((modelKey) => (
                  <button
                    key={modelKey}
                    className={videoSettings.model === modelKey ? "primary" : ""}
                    type="button"
                    onClick={() => updateVideoSettings({ model: modelKey })}
                  >
                    <span>{VIDEO_MODELS[modelKey].label}</span>
                  </button>
                ))}

                <div className="cmp-menu-title">INPUT MODE</div>
                <div className="video-settings-options video-mode-options">
                  <button
                    className={videoSettings.inputMode === "frames" ? "primary" : ""}
                    type="button"
                    onClick={() => updateVideoSettings({ inputMode: "frames" })}
                  >
                    FRAMES
                  </button>
                  <button
                    className={videoSettings.inputMode === "references" ? "primary" : ""}
                    type="button"
                    disabled={!modelConfig.supportsReferences}
                    onClick={() => updateVideoSettings({ inputMode: "references" })}
                  >
                    REFERENCES
                  </button>
                </div>

                <div className="cmp-menu-title">ASPECT RATIO</div>
                {(["16:9", "9:16"] as VideoRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    className={videoSettings.ratio === ratio ? "primary" : ""}
                    type="button"
                    onClick={() => updateVideoSettings({ ratio })}
                  >
                    <span>{ratio}</span>
                    <span>{ratio === "16:9" ? "LANDSCAPE" : "PORTRAIT"}</span>
                  </button>
                ))}

                <div className="cmp-menu-title">DURATION</div>
                <div className="video-settings-options">
                  {([4, 6, 8] as VideoDuration[]).map((duration) => (
                    <button
                      key={duration}
                      className={videoSettings.duration === duration ? "primary" : ""}
                      type="button"
                      disabled={durationLocked && duration !== 8}
                      onClick={() => updateVideoSettings({ duration })}
                    >
                      {duration}S
                    </button>
                  ))}
                </div>

                <div className="cmp-menu-title">RESOLUTION</div>
                <div className="video-settings-options">
                  {modelConfig.resolutions.map((resolution) => (
                    <button
                      key={resolution}
                      className={videoSettings.resolution === resolution ? "primary" : ""}
                      type="button"
                      onClick={() => updateVideoSettings({ resolution })}
                    >
                      {resolution}
                    </button>
                  ))}
                </div>

                <div className="cmp-menu-title">VARIATIONS</div>
                <div className="video-settings-stepper">
                  <button
                    type="button"
                    title="Decrease variations"
                    disabled={videoSettings.variations <= 1}
                    onClick={() => updateVideoSettings({ variations: videoSettings.variations - 1 })}
                  >
                    -
                  </button>
                  <span>{videoSettings.variations} VIDEO{videoSettings.variations === 1 ? "" : "S"}</span>
                  <button
                    type="button"
                    title="Increase variations"
                    disabled={videoSettings.variations >= 4}
                    onClick={() => updateVideoSettings({ variations: videoSettings.variations + 1 })}
                  >
                    +
                  </button>
                </div>

                <div className="cmp-menu-title">SEED</div>
                <input
                  className="video-seed-input"
                  inputMode="numeric"
                  value={videoSettings.seed}
                  onChange={(event) => updateVideoSettings({ seed: event.target.value })}
                  placeholder="RANDOM"
                  aria-label="Video seed"
                />
              </div>
            </div>

            <div className="video-prompt-input-area">
              <input
                className="video-prompt-text-field"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What are we making today?"
              />
              <button
                className={`video-frame-btn ${activeGenerationCount > 0 ? "cafe-loading" : ""}`}
                type="button"
                disabled={!prompt.trim() || activeGenerationCount > 0 || !activeProjectId}
                onClick={handleGenerate}
                title={`${modelConfig.label} | ${videoSettings.ratio} | ${videoSettings.duration}s | ${videoSettings.resolution}`}
              >
                VIDEO
              </button>
            </div>
          </div>
        </section>
      </main>
      <ProjectsModal />
      <SettingsModal />
    </>
  );
}

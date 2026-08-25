"use client";

import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useGallery, type GalleryCell } from "@/context/GalleryContext";
import { useStudio } from "@/context/StudioContext";
import { galleryStudioWorkspaceKey } from "@/lib/studioState";
import { useModule } from "@/context/ModuleContext";
import { useApp } from "@/context/AppContext";
import DB from "@/lib/db";
import { dimensionsToRatio, loadImageMetadata } from "@/lib/imageMeta";
import { galleryCellForStorage, isHudImageCell } from "@/lib/galleryCells";

type HudZoomState = {
  scale: number;
  x: number;
  y: number;
};

const HUD_MIN_ZOOM = 1;
const HUD_MAX_ZOOM = 4;

export default function HUD() {
  const { 
    cells, setCells,
    hudOpen, setHudOpen,
    hudIndex, setHudIndex,
    infoPanelOpen, setInfoPanelOpen,
    ratioFilter, sortOrder,
    openEvaluation
  } = useGallery();

  const { openStudio } = useStudio();
  const { setFiles } = useModule();
  const { activeProjectId } = useApp();

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateVisibleViewportHeight = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--visible-viewport-height", `${height}px`);
    };

    updateVisibleViewportHeight();
    window.addEventListener("resize", updateVisibleViewportHeight);
    visualViewport?.addEventListener("resize", updateVisibleViewportHeight);

    return () => {
      window.removeEventListener("resize", updateVisibleViewportHeight);
      visualViewport?.removeEventListener("resize", updateVisibleViewportHeight);
      document.documentElement.style.removeProperty("--visible-viewport-height");
    };
  }, []);

  const [threeDotOpen, setThreeDotOpen] = useState(false);
  const [setupPopupOpen, setSetupPopupOpen] = useState(false);
  const [copyPromptTitle, setCopyPromptTitle] = useState("Copy prompt");
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState<HudZoomState>({ scale: 1, x: 0, y: 0 });
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const [zoomHintVisible, setZoomHintVisible] = useState(false);
  
  const threeDotRef = useRef<HTMLDivElement>(null);
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HudZoomState>({ scale: 1, x: 0, y: 0 });
  const zoomIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasShownZoomHintRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    pointerIds: [number, number];
    startDistance: number;
    startScale: number;
    startX: number;
    startY: number;
    midpointX: number;
    midpointY: number;
  } | null>(null);
  const lastTouchTapRef = useRef({ time: 0, x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    startedAt: number;
    axis: "horizontal" | "vertical" | null;
  }>({ pointerId: -1, startX: 0, startY: 0, lastX: 0, startedAt: 0, axis: null });
  type ActiveHudCell = GalleryCell | undefined;

  // Derive visible cells before callbacks so selected cell state is initialized
  // before any closure setup that may reference it.
  const visibleCells = useMemo(() => {
    const filteredCells = cells.filter(cell => {
      if (ratioFilter === 'landscape') return ['16:9', '21:9', '4:3'].includes(cell.ratio);
      if (ratioFilter === 'portrait')  return ['9:16', '3:4'].includes(cell.ratio);
      if (ratioFilter === 'square')    return cell.ratio === '1:1';
      return true;
    });
    const sortedCells = sortOrder === "oldest" ? [...filteredCells].reverse() : filteredCells;
    return sortedCells.filter(isHudImageCell);
  }, [cells, ratioFilter, sortOrder]);
  const activeCell = visibleCells[hudIndex];
  const renderedSlides = useMemo(() => {
    if (!hudOpen || !visibleCells.length) return [];
    return visibleCells
      .map((cell, i) => ({ cell, i }))
      .filter(({ i }) => {
        const distance = Math.abs(i - hudIndex);
        const wrapDistance = visibleCells.length - distance;
        return Math.min(distance, wrapDistance) <= 1;
      });
  }, [hudIndex, hudOpen, visibleCells]);

  const persistGalleryCell = useCallback(async (cell: ActiveHudCell) => {
    if (!activeProjectId || !cell?.uuid || !cell.imgUrl) return;
    await DB.images.put(cell.uuid, cell.imgUrl, activeProjectId);
    await DB.gallery.put(galleryCellForStorage({ ...cell, project_id: activeProjectId }));
  }, [activeProjectId]);

  const formatInfoDate = useCallback((value?: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }, []);

  const formatInfoType = useCallback((cell: ActiveHudCell) => {
    if (!cell) return "-";
    if (cell.type) return cell.type;
    if (cell.origin === "studio-edit") return "Studio Edit";
    if (cell.origin === "duplicate") return "Duplicate";
    if (cell.origin === "generation") return "Generation";
    return "-";
  }, []);

  const provenanceText = useCallback((cell: ActiveHudCell) => {
    if (!cell) return null;
    if (cell.origin === "studio-edit") return "Updated from an earlier gallery image.";
    if (cell.origin === "duplicate") return "Copied from another gallery image.";
    return null;
  }, []);

  const promptTextForCell = useCallback((cell: ActiveHudCell) => (
    cell?.effectivePrompt || cell?.prompt || cell?.userPrompt || ""
  ), []);

  const promptCommandForCell = useCallback((cell: ActiveHudCell) => {
    const prompt = promptTextForCell(cell).trim();
    if (!prompt) return "";
    return /^\/generate(?:\s+|$)/i.test(prompt) ? prompt : `/Generate ${prompt}`;
  }, [promptTextForCell]);

  const promptSourceText = useCallback((cell: ActiveHudCell) => {
    if (!cell) return null;
    if (cell.executionSource === "agent-final-prompt") return "Agent draft";
    if (cell.executionSource === "generate-command") return "/Generate";
    return null;
  }, []);

  const applyGalleryStudioResult = useCallback((cell: ActiveHudCell, url: string) => {
    if (!cell) return;
    const updatedAt = new Date().toISOString();
    loadImageMetadata(url)
      .then((meta) => {
        const updatedCell: GalleryCell = {
          ...cell,
          imgUrl: url,
          dims: meta.dims,
          ratio: meta.ratio,
          date: updatedAt,
          type: "Studio Edit",
          kind: "image" as const,
          origin: "studio-edit" as const,
          updatedAt,
          sourceUuid: cell?.sourceUuid || cell?.uuid,
        };
        setCells((prev) => prev.map((entry) => entry.id === cell?.id ? updatedCell : entry));
        void persistGalleryCell(updatedCell).catch((error) => console.error("Failed to persist Studio result", error));
      })
      .catch(() => {
        const updatedCell: GalleryCell = {
          ...cell,
          imgUrl: url,
          date: updatedAt,
          type: "Studio Edit",
          kind: "image" as const,
          origin: "studio-edit" as const,
          updatedAt,
          sourceUuid: cell?.sourceUuid || cell?.uuid,
        };
        setCells((prev) => prev.map((entry) => entry.id === cell?.id ? updatedCell : entry));
        void persistGalleryCell(updatedCell).catch((error) => console.error("Failed to persist Studio result", error));
      });
  }, [persistGalleryCell, setCells]);

  const syncGalleryImageMeta = useCallback((cell: ActiveHudCell, img: HTMLImageElement) => {
    if (!cell) return;
    const dims = `${img.naturalWidth}x${img.naturalHeight}`;
    const ratio = dimensionsToRatio(img.naturalWidth, img.naturalHeight);
    if (cell.dims === dims && cell.ratio === ratio) return;

    const updatedCell: GalleryCell = {
      ...cell,
      dims,
      ratio,
      type: cell.type || "Generation",
    };
    setCells((prev) => prev.map((entry) => entry.id === cell.id ? updatedCell : entry));
    void persistGalleryCell(updatedCell).catch((error) => console.error("Failed to persist image metadata", error));
  }, [persistGalleryCell, setCells]);

  const clampZoomPan = useCallback((scale: number, x: number, y: number): HudZoomState => {
    const image = imageAreaRef.current?.querySelector<HTMLImageElement>('.hud-slide[data-active="true"] .hud-slide-img');
    if (!image || scale <= HUD_MIN_ZOOM) return { scale: HUD_MIN_ZOOM, x: 0, y: 0 };

    const maxX = Math.max(0, (image.offsetWidth * (scale - 1)) / 2);
    const maxY = Math.max(0, (image.offsetHeight * (scale - 1)) / 2);
    return {
      scale,
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const commitZoom = useCallback((next: HudZoomState, showIndicator = true) => {
    const clamped = clampZoomPan(next.scale, next.x, next.y);
    zoomRef.current = clamped;
    setZoom(clamped);

    if (!showIndicator) return;
    setZoomIndicatorVisible(true);
    if (zoomIndicatorTimerRef.current) clearTimeout(zoomIndicatorTimerRef.current);
    zoomIndicatorTimerRef.current = setTimeout(() => setZoomIndicatorVisible(false), 700);
  }, [clampZoomPan]);

  const resetZoom = useCallback((showIndicator = false) => {
    commitZoom({ scale: HUD_MIN_ZOOM, x: 0, y: 0 }, showIndicator);
    setIsPanning(false);
    panRef.current = null;
    pinchRef.current = null;
    pointersRef.current.clear();
  }, [commitZoom]);

  const zoomAt = useCallback((clientX: number, clientY: number, requestedScale: number) => {
    const area = imageAreaRef.current;
    if (!area) return;
    const current = zoomRef.current;
    const scale = Math.max(HUD_MIN_ZOOM, Math.min(HUD_MAX_ZOOM, requestedScale));
    if (scale === HUD_MIN_ZOOM) {
      resetZoom(true);
      return;
    }

    const areaRect = area.getBoundingClientRect();
    const focalX = clientX - (areaRect.left + areaRect.width / 2);
    const focalY = clientY - (areaRect.top + areaRect.height / 2);
    const ratio = scale / current.scale;
    commitZoom({
      scale,
      x: focalX - (focalX - current.x) * ratio,
      y: focalY - (focalY - current.y) * ratio,
    });
  }, [commitZoom, resetZoom]);

  const toggleZoomAt = useCallback((clientX: number, clientY: number) => {
    if (zoomRef.current.scale > HUD_MIN_ZOOM) resetZoom(true);
    else zoomAt(clientX, clientY, 2);
  }, [resetZoom, zoomAt]);

  const handleNext = useCallback(() => {
    if (!visibleCells.length) return;
    resetZoom(false);
    setHudIndex((hudIndex + 1) % visibleCells.length);
  }, [hudIndex, resetZoom, setHudIndex, visibleCells.length]);

  const handlePrev = useCallback(() => {
    if (!visibleCells.length) return;
    resetZoom(false);
    setHudIndex((hudIndex - 1 + visibleCells.length) % visibleCells.length);
  }, [hudIndex, resetZoom, setHudIndex, visibleCells.length]);

  const slidePosition = useCallback((index: number) => {
    if (visibleCells.length < 2) return 0;
    let position = index - hudIndex;
    const midpoint = visibleCells.length / 2;
    if (position > midpoint) position -= visibleCells.length;
    if (position < -midpoint) position += visibleCells.length;
    return position;
  }, [hudIndex, visibleCells.length]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);

    const pointers = [...pointersRef.current.entries()];
    if (pointers.length >= 2) {
      const [[firstId, first], [secondId, second]] = pointers;
      const areaRect = imageAreaRef.current?.getBoundingClientRect();
      const areaCenterX = areaRect ? areaRect.left + areaRect.width / 2 : 0;
      const areaCenterY = areaRect ? areaRect.top + areaRect.height / 2 : 0;
      pinchRef.current = {
        pointerIds: [firstId, secondId],
        startDistance: Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1),
        startScale: zoomRef.current.scale,
        startX: zoomRef.current.x,
        startY: zoomRef.current.y,
        midpointX: (first.x + second.x) / 2 - areaCenterX,
        midpointY: (first.y + second.y) / 2 - areaCenterY,
      };
      panRef.current = null;
      dragRef.current.pointerId = -1;
      setIsDragging(false);
      setDragOffset(0);
      setIsPanning(true);
      return;
    }

    if (zoomRef.current.scale > HUD_MIN_ZOOM) {
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: zoomRef.current.x,
        originY: zoomRef.current.y,
        moved: false,
      };
      setIsPanning(true);
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      startedAt: performance.now(),
      axis: null,
    };
    setIsDragging(false);
    setDragOffset(0);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = pinchRef.current;
    if (pinch) {
      const first = pointersRef.current.get(pinch.pointerIds[0]);
      const second = pointersRef.current.get(pinch.pointerIds[1]);
      if (!first || !second) return;
      event.preventDefault();
      const distance = Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1);
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const areaRect = imageAreaRef.current?.getBoundingClientRect();
      const focalX = midpointX - (areaRect ? areaRect.left + areaRect.width / 2 : 0);
      const focalY = midpointY - (areaRect ? areaRect.top + areaRect.height / 2 : 0);
      const scale = Math.max(HUD_MIN_ZOOM, Math.min(HUD_MAX_ZOOM, pinch.startScale * (distance / pinch.startDistance)));
      const ratio = scale / pinch.startScale;
      commitZoom({
        scale,
        x: focalX - (pinch.midpointX - pinch.startX) * ratio,
        y: focalY - (pinch.midpointY - pinch.startY) * ratio,
      });
      return;
    }

    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault();
      const deltaX = event.clientX - pan.startX;
      const deltaY = event.clientY - pan.startY;
      if (Math.hypot(deltaX, deltaY) > 4) pan.moved = true;
      commitZoom({
        scale: zoomRef.current.scale,
        x: pan.originX + deltaX,
        y: pan.originY + deltaY,
      }, false);
      return;
    }

    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.axis) {
      if (Math.hypot(deltaX, deltaY) < 7) return;
      drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      if (drag.axis === "horizontal") setIsDragging(true);
    }

    if (drag.axis !== "horizontal") return;
    event.preventDefault();
    drag.lastX = event.clientX;
    setDragOffset(deltaX);
  }, [commitZoom]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const drag = dragRef.current;
    const distance = drag.lastX - drag.startX;
    const elapsed = Math.max(performance.now() - drag.startedAt, 1);
    const velocity = distance / elapsed;
    const threshold = Math.min(64, event.currentTarget.clientWidth * 0.16);

    setIsDragging(false);
    setDragOffset(0);
    dragRef.current.pointerId = -1;

    if (cancelled || drag.axis !== "horizontal" || visibleCells.length < 2) return;
    if (distance <= -threshold || velocity < -0.45) handleNext();
    else if (distance >= threshold || velocity > 0.45) handlePrev();
  }, [handleNext, handlePrev, visibleCells.length]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const pan = panRef.current;
    const drag = dragRef.current;
    const wasTouchTap = !cancelled && event.pointerType === "touch" && (
      (pan?.pointerId === event.pointerId && !pan.moved) ||
      (drag.pointerId === event.pointerId && !drag.axis && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8)
    );

    pointersRef.current.delete(event.pointerId);
    if (pinchRef.current) {
      const remaining = [...pointersRef.current.entries()];
      pinchRef.current = null;
      if (remaining.length === 1 && zoomRef.current.scale > HUD_MIN_ZOOM) {
        const [pointerId, point] = remaining[0];
        panRef.current = {
          pointerId,
          startX: point.x,
          startY: point.y,
          originX: zoomRef.current.x,
          originY: zoomRef.current.y,
          moved: true,
        };
      } else {
        panRef.current = null;
        setIsPanning(false);
      }
      return;
    }

    if (pan?.pointerId === event.pointerId) {
      panRef.current = null;
      setIsPanning(false);
    } else {
      finishDrag(event, cancelled);
    }

    if (!wasTouchTap) return;
    const now = performance.now();
    const lastTap = lastTouchTapRef.current;
    if (now - lastTap.time < 320 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 28) {
      lastTouchTapRef.current.time = 0;
      toggleZoomAt(event.clientX, event.clientY);
    } else {
      lastTouchTapRef.current = { time: now, x: event.clientX, y: event.clientY };
    }
  }, [finishDrag, toggleZoomAt]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, #hud-info-panel")) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    zoomAt(event.clientX, event.clientY, zoomRef.current.scale * factor);
  }, [zoomAt]);

  // Keyboard navigation
  useEffect(() => {
    if (!hudOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "+" || e.key === "=") {
        const area = imageAreaRef.current?.getBoundingClientRect();
        if (area) zoomAt(area.left + area.width / 2, area.top + area.height / 2, zoomRef.current.scale * 1.25);
      }
      if (e.key === "-" || e.key === "_") {
        const area = imageAreaRef.current?.getBoundingClientRect();
        if (area) zoomAt(area.left + area.width / 2, area.top + area.height / 2, zoomRef.current.scale / 1.25);
      }
      if (e.key === "0") resetZoom(true);
      if (e.key === "Escape") {
        if (infoPanelOpen) setInfoPanelOpen(false);
        else setHudOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev, hudOpen, infoPanelOpen, resetZoom, setHudOpen, setInfoPanelOpen, zoomAt]);

  useEffect(() => {
    if (!hudOpen) {
      resetZoom(false);
      setZoomHintVisible(false);
      return;
    }
    if (hasShownZoomHintRef.current) return;
    hasShownZoomHintRef.current = true;
    setZoomHintVisible(true);
    zoomHintTimerRef.current = setTimeout(() => setZoomHintVisible(false), 2200);
  }, [hudOpen, resetZoom]);

  useEffect(() => () => {
    if (zoomIndicatorTimerRef.current) clearTimeout(zoomIndicatorTimerRef.current);
    if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
  }, []);

  // Click outside dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (threeDotRef.current && !threeDotRef.current.contains(e.target as Node)) {
        setThreeDotOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!hudOpen && infoPanelOpen) {
      setInfoPanelOpen(false);
    }
  }, [hudOpen, infoPanelOpen, setInfoPanelOpen]);

  useEffect(() => {
    if (!visibleCells.length) {
      if (hudOpen) setHudOpen(false);
      return;
    }
    if (hudIndex >= visibleCells.length) {
      setHudIndex(visibleCells.length - 1);
    }
  }, [hudIndex, hudOpen, setHudIndex, setHudOpen, visibleCells.length]);

  if (!activeCell) return null; // Wait until active cell is available

  const handleDelete = () => {
    if (activeCell?.id) {
      void DB.gallery.delete(activeCell.id).catch((error) => console.error("Failed to delete gallery record", error));
    }
    if (activeCell?.uuid) {
      void DB.images.delete(activeCell.uuid).catch((error) => console.error("Failed to delete gallery image", error));
    }
    setCells(prev => prev.filter(c => c.id !== activeCell.id));
    setHudOpen(false);
  };

  const handleDuplicate = () => {
    const newCell = {
      ...activeCell,
      id: crypto.getRandomValues(new Uint32Array(1))[0],
      uuid: crypto.randomUUID(),
      type: "Duplicate",
      kind: "image" as const,
      origin: "duplicate" as const,
      sourceUuid: activeCell.uuid,
      updatedAt: new Date().toISOString(),
      date: new Date().toISOString(),
      _imgUuid: undefined,
      _dbId: undefined,
      loadingId: undefined,
      blocked: undefined,
      error: undefined,
      retryFn: undefined,
    };
    setCells(prev => [newCell, ...prev]);
    void persistGalleryCell(newCell).catch((error) => console.error("Failed to persist duplicate", error));
    setThreeDotOpen(false);
  };

  const handleDownload = async () => {
    if (!activeCell.imgUrl) return;
    try {
      const response = await fetch(activeCell.imgUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `cafe-${activeCell.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (e) {
      console.error("Download fetch failed, falling back to direct navigation:", e);
      const a = document.createElement("a");
      a.href = activeCell.imgUrl;
      a.download = `cafe-${activeCell.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleUpscale = () => {
    alert("Native upscaling is not yet supported in this version. (Imagen 3 handles upscaling natively via the imageSize parameter which is set in Settings).");
  };

  const handleReusePrompt = () => {
    const promptToReuse = promptCommandForCell(activeCell);
    if (!promptToReuse) return;
    window.dispatchEvent(new CustomEvent("set-prompt", { detail: promptToReuse }));
    setThreeDotOpen(false);
    setHudOpen(false);
  };

  const handleCopyPrompt = async () => {
    const promptToCopy = promptTextForCell(activeCell);
    if (!promptToCopy) return;

    const markCopyResult = (title: string) => {
      setCopyPromptTitle(title);
      window.setTimeout(() => setCopyPromptTitle("Copy prompt"), 1200);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptToCopy);
        markCopyResult("Copied");
        return;
      }
    } catch {
      // Fall through to legacy copy path for embedded browsers.
    }

    const textarea = document.createElement("textarea");
    textarea.value = promptToCopy;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      if (document.execCommand("copy")) {
        markCopyResult("Copied");
      } else {
        markCopyResult("Copy failed");
      }
    } catch {
      markCopyResult("Copy failed");
    } finally {
      textarea.remove();
    }
  };

  const handleLoadSetup = async () => {
    if (activeCell.moduleSnapshot?.files) {
      const files = await Promise.all(activeCell.moduleSnapshot.files.map(async (file) => {
        const storedAsset = file.uuid
          ? await DB.images.get(file.uuid) as { dataUrl?: string } | undefined
          : undefined;
        return {
          ...file,
          url: storedAsset?.dataUrl || file.url || "",
          visualRead: "",
          visualReadSource: "local" as const,
          visualReadFingerprint: undefined,
          visualReadVersion: undefined,
        };
      }));
      setFiles(files);
    }
    const promptToLoad = promptCommandForCell(activeCell);
    if (promptToLoad) {
      window.dispatchEvent(new CustomEvent("set-prompt", { detail: promptToLoad }));
    }
    setSetupPopupOpen(false);
  };

  return (
    <div className={`hud ${hudOpen ? "open" : ""}`} id="hud" onClick={(e) => { if (e.target === e.currentTarget) setHudOpen(false); }}>
      
      {/* Top bar */}
      <div id="hud-topbar">
        <button id="hud-close" onClick={() => setHudOpen(false)}>
          <svg viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          CLOSE
        </button>
        <div className="hud-divider"></div>
        <span
          id="hud-counter"
          aria-label={`${hudIndex + 1} of ${visibleCells.length}`}
        >
          {`${hudIndex + 1} OF ${visibleCells.length}`}
        </span>

        <div className="hud-spacer"></div>

        <button className="hud-icon-btn" id="hud-edit" title="Refine Area" onClick={(e) => { 
          e.stopPropagation(); 
          if (activeCell) {
            openStudio({
              uuid: activeCell.uuid,
              workspaceKey: galleryStudioWorkspaceKey(activeCell.id),
              imgUrl: activeCell.imgUrl,
              caller: 'gallery',
              onDone: (url) => {
                if (!url) return;
                applyGalleryStudioResult(activeCell, url);
              }
            });
          }
        }}>
          <svg width="14" height="14" viewBox="0 0 14.7989 14.7272" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 13.1289V11.5305L1.16648 10.3707C4.97904 6.57996 8.40899 3.18909 8.44436 3.17571C8.46326 3.16815 9.72577 4.40376 11.0113 5.68169L11.6502 6.31671L7.45474 10.5219L3.25927 14.7272H1.62965H0V13.1289ZM11.1262 3.66073L9.55907 2.09352L10.6058 1.04673L11.6526 0L13.2258 1.57315L14.7989 3.14624L13.7582 4.18715C13.1859 4.75963 12.7121 5.22799 12.7054 5.22799C12.6979 5.22799 11.9881 4.52272 11.1262 3.66073Z" fill="currentColor" />
          </svg>
        </button>
        <button
          className={`hud-icon-btn hud-evaluate ${activeCell.evaluation?.userFeedback ? "rated" : ""}`}
          id="hud-evaluate"
          title="Give generation feedback"
          aria-label="Give generation feedback"
          onClick={() => openEvaluation(activeCell.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.8l2.83 5.73 6.32.92-4.57 4.45 1.08 6.29L12 17.22l-5.66 2.97 1.08-6.29-4.57-4.45 6.32-.92L12 2.8z" />
          </svg>
        </button>
        <button className={`hud-icon-btn ${infoPanelOpen ? "active" : ""}`} id="hud-info" title="Image Info" onClick={() => setInfoPanelOpen(!infoPanelOpen)}>i</button>

        <div id="hud-threedot-wrap" ref={threeDotRef}>
          <button className={`hud-icon-btn ${threeDotOpen ? "active open" : ""}`} id="hud-threedot" title="More" onClick={() => setThreeDotOpen(!threeDotOpen)}>&#8943;</button>
          <div className="cmp-menu hud-image-menu" id="hud-threedot-dropdown" hidden={!threeDotOpen}>
            <div className="cmp-menu-title">IMAGE</div>
            <button className="primary" id="hud-drop-reuse" type="button" onClick={handleReusePrompt}>REUSE</button>
            <button id="hud-drop-duplicate" type="button" onClick={handleDuplicate}>DUPLICATE</button>
          </div>
        </div>
      </div>

      {/* Image viewport */}
      <div
        id="hud-image-area"
        ref={imageAreaRef}
        className={[isDragging ? "dragging" : "", zoom.scale > HUD_MIN_ZOOM ? "zoomed" : "", isPanning ? "panning" : ""].filter(Boolean).join(" ")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => handlePointerEnd(event)}
        onPointerCancel={(event) => handlePointerEnd(event, true)}
        onWheel={handleWheel}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button, #hud-info-panel")) return;
          toggleZoomAt(event.clientX, event.clientY);
        }}
      >
        <div id="hud-slide-track">
          {renderedSlides.map(({ cell, i }) => (
            <div 
              key={cell.id} 
              className="hud-slide" 
              data-slide-id={i}
              data-active={i === hudIndex ? "true" : "false"}
              style={{ transform: `translateX(calc(${slidePosition(i) * 100}% + ${dragOffset}px))` }}
            >
              {cell.imgUrl ? (
                <img
                  className="hud-slide-img"
                  src={cell.imgUrl}
                  alt="Generated"
                  draggable={false}
                  style={i === hudIndex ? { transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` } : undefined}
                  onLoad={(e) => syncGalleryImageMeta(cell, e.currentTarget)}
                />
              ) : (
                <div 
                  className={`hud-slide-placeholder ${cell.phClass || ""}`} 
                  style={{
                    width: cell.ratio === "16:9" ? "86%" : (cell.ratio === "9:16" ? "48%" : "80vh"),
                    height: cell.ratio === "16:9" ? "48vw" : (cell.ratio === "9:16" ? "86%" : "80vh"),
                    maxWidth: "100%", maxHeight: "100%"
                  }}
                ></div>
              )}
            </div>
          ))}
        </div>

        <div className={`hud-zoom-indicator ${zoomIndicatorVisible ? "visible" : ""}`} aria-live="polite">
          {Math.round(zoom.scale * 100)}%
        </div>
        <div className={`hud-zoom-hint ${zoomHintVisible ? "visible" : ""}`}>
          SCROLL OR PINCH TO ZOOM
        </div>

        <button className="hud-nav-arrow" id="hud-prev" title="Previous" onClick={(e) => { e.stopPropagation(); handlePrev(); }}>
          <svg viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button className="hud-nav-arrow" id="hud-next" title="Next" onClick={(e) => { e.stopPropagation(); handleNext(); }}>
          <svg viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>

        {/* Info panel */}
        <div id="hud-info-panel" className={infoPanelOpen ? 'open' : ''} style={{ display: infoPanelOpen ? 'flex' : 'none' }}>
          <button className="info-close" id="hud-info-close" onClick={() => setInfoPanelOpen(false)}>&times;</button>

          <div className="info-section-header">
            <span className="info-section-title">USED IN THIS FRAME</span>
            {activeCell.moduleSnapshot && (
              <button className="info-icon-btn" id="info-load-setup" title="Load this setup" onClick={() => setSetupPopupOpen(!setupPopupOpen)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>
              </button>
            )}
          </div>
          
          <div id="info-ref-strip" style={{display: (activeCell.usedImages && activeCell.usedImages.length) ? 'flex' : 'none'}}>
            {activeCell.usedImages?.map((img, i) => (
              <div key={i} className="info-ref-thumb" style={{ backgroundImage: `url('${img.imgUrl}')` }}></div>
            ))}
          </div>

          <div className="info-section-title">Image Details</div>
          <div className="info-row">
            <div className="info-item">
              <span className="info-item-label">Date</span>
                <span className="info-item-value" id="info-date">{formatInfoDate(activeCell.updatedAt || activeCell.createdAt || activeCell.date)}</span>
            </div>
            <div className="info-item">
              <span className="info-item-label">Type</span>
                <span className="info-item-value" id="info-type">{formatInfoType(activeCell)}</span>
            </div>
            <div className="info-item">
              <span className="info-item-label">Dimensions</span>
              <span className="info-item-value" id="info-dims">{activeCell.dims || '-'}</span>
            </div>
          </div>

          {provenanceText(activeCell) && (
            <div className="info-provenance">
              <span className="info-provenance-label">Source</span>
              <span className="info-provenance-value">{provenanceText(activeCell)}</span>
            </div>
          )}

          <div className="info-section-header">
            <span className="info-section-title">Prompt{promptSourceText(activeCell) ? ` / ${promptSourceText(activeCell)}` : ""}</span>
            <button className="info-icon-btn" id="btn-copy-prompt" title={copyPromptTitle} onClick={handleCopyPrompt}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <div className="prompt-text" id="info-prompt">{promptTextForCell(activeCell) || '-'}</div>

        </div>
      </div>

      {/* Bottom strip */}
      <div id="hud-bottom" onClick={(e) => e.stopPropagation()}>
        <button className="hud-action" id="hud-btn-upscale" onClick={handleUpscale}>UPSCALE</button>
        <div className="hud-action-divider"></div>
        <button className="hud-action" id="hud-btn-download" onClick={handleDownload}>DOWNLOAD</button>
        <div className="hud-action-divider"></div>
        <button className="hud-action danger" id="hud-btn-delete" onClick={handleDelete}>DELETE</button>
      </div>
      
      {/* Setup confirmation popup */}
      <div id="info-setup-popup" className={setupPopupOpen ? "open" : ""}>
        <div className="info-popup-panel">
          <div className="info-popup-header">
            <h3 className="info-popup-label">LOAD THIS SETUP?</h3>
          </div>
          <div className="info-popup-body">
            <p>This will overwrite your current Canvas layout, Brief slots, and prompt text.</p>
          </div>
          <div className="info-popup-actions">
            <button id="info-popup-yes" onClick={handleLoadSetup}>YES, LOAD</button>
            <button id="info-popup-no" onClick={() => setSetupPopupOpen(false)}>CANCEL</button>
          </div>
        </div>
      </div>

    </div>
  );
}



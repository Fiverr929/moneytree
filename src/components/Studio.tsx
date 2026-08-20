"use client";

import React, { useCallback, useRef, useEffect, useState } from "react";
import { useStudio } from "@/context/StudioContext";
import { useSettings } from "@/context/SettingsContext";
import { useGallery, type GalleryImageUse } from "@/context/GalleryContext";
import { studioGenerate } from "@/lib/pipeline/api";
import StudioModule from "./StudioModule";

type Point = { x: number, y: number };
type Stroke = { color: string, size: number, points: Point[] };
type CropBox = { l: number, t: number, w: number, h: number };
type CropHandlePos = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";
type StudioFlavor = "normal" | "creative";
type StudioPromptCommand =
  | { kind: "refine"; prompt: string; flavor: StudioFlavor }
  | { kind: "upscale"; prompt: string; imageSize: "2K" | "4K" }
  | { kind: "invalid-command"; message: string };

const MAX_STUDIO_HISTORY = 20;
const limitStudioHistory = (items: string[]) => items.slice(0, MAX_STUDIO_HISTORY);
const MIN_CROP_SIZE = 40;

const STUDIO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

const aspectRatioFromImage = (img: HTMLImageElement | null | undefined) => {
  const width = Math.round(img?.naturalWidth || 0);
  const height = Math.round(img?.naturalHeight || 0);
  if (width <= 0 || height <= 0) return undefined;
  const imageRatio = width / height;

  return STUDIO_ASPECT_RATIOS.reduce((best, ratio) => {
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    const [bestWidth, bestHeight] = best.split(":").map(Number);
    const distance = Math.abs(imageRatio - ratioWidth / ratioHeight);
    const bestDistance = Math.abs(imageRatio - bestWidth / bestHeight);
    return distance < bestDistance ? ratio : best;
  }, STUDIO_ASPECT_RATIOS[0]);
};

const createInitialCropBox = (cw: number, ch: number, cropRatio: number | "free"): CropBox => {
  let w: number;
  let h: number;
  if (cropRatio === "free") {
    w = cw * 0.72;
    h = ch * 0.72;
  } else {
    w = Math.min(cw * 0.82, ch * 0.82 * cropRatio);
    h = w / cropRatio;
    if (h > ch * 0.82) {
      h = ch * 0.82;
      w = h * cropRatio;
    }
  }
  return { l: (cw - w) / 2, t: (ch - h) / 2, w, h };
};

const clampCropBox = (box: CropBox, cw: number, ch: number, cropRatio: number | "free"): CropBox => {
  const minSize = Math.min(MIN_CROP_SIZE, cw, ch);
  let { l, t, w, h } = box;

  if (cropRatio === "free") {
    w = Math.min(Math.max(w, minSize), cw);
    h = Math.min(Math.max(h, minSize), ch);
  } else {
    const maxW = Math.min(cw, ch * cropRatio);
    w = Math.min(Math.max(w, minSize), maxW);
    h = w / cropRatio;
    if (h > ch) {
      h = ch;
      w = h * cropRatio;
    }
  }

  l = Math.min(Math.max(l, 0), Math.max(0, cw - w));
  t = Math.min(Math.max(t, 0), Math.max(0, ch - h));
  return { l, t, w, h };
};

const FREE_CROP_HANDLES: Array<{ pos: CropHandlePos; cursor: string; className: string }> = [
  { pos: "tl", cursor: "nw-resize", className: "corner tl" },
  { pos: "t", cursor: "n-resize", className: "edge t" },
  { pos: "tr", cursor: "ne-resize", className: "corner tr" },
  { pos: "r", cursor: "e-resize", className: "edge r" },
  { pos: "br", cursor: "se-resize", className: "corner br" },
  { pos: "b", cursor: "s-resize", className: "edge b" },
  { pos: "bl", cursor: "sw-resize", className: "corner bl" },
  { pos: "l", cursor: "w-resize", className: "edge l" },
];

const LOCKED_CROP_HANDLES = FREE_CROP_HANDLES.filter(({ pos }) => ["tl", "tr", "br", "bl"].includes(pos));

const STUDIO_COMMANDS = [
  { value: "/creative", label: "/creative", description: "Creative reinterpretation" },
  { value: "/upscale 2k", label: "/upscale 2k", description: "Upscale to 2K" },
  { value: "/upscale 4k", label: "/upscale 4k", description: "Upscale to 4K" },
];

const parseStudioPromptCommand = (rawPrompt: string): StudioPromptCommand => {
  const trimmed = rawPrompt.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "refine", prompt: rawPrompt, flavor: "normal" };
  }

  const creativeMatch = trimmed.match(/^\/creative(?:\s+([\s\S]*))?$/i);
  if (creativeMatch) {
    return { kind: "refine", prompt: creativeMatch[1]?.trim() || "", flavor: "creative" };
  }

  const match = trimmed.match(/^\/upscale(?:\s+(2k|4k))?(?:\s+([\s\S]*))?$/i);
  if (trimmed.toLowerCase().startsWith("/upscale")) {
    if (!match || !match[1]) {
      return { kind: "invalid-command", message: "Use /upscale 2k or /upscale 4k, optionally followed by a prompt." };
    }

    return {
      kind: "upscale",
      imageSize: match[1].toUpperCase() as "2K" | "4K",
      prompt: match[2]?.trim() || ""
    };
  }

  return { kind: "invalid-command", message: "Unknown Studio command. Use /creative, /upscale 2k, or /upscale 4k." };
};

export default function Studio() {
  const { 
    isOpen, closeStudio, 
    history, setHistory, 
    activeUrl, setActiveUrl,
    activeTool, setActiveTool,
    strokeSize, setStrokeSize,
    strokeColor, setStrokeColor,
    cropRatio, setCropRatio,
    groups
  } = useStudio();
  
  const { addCell } = useGallery();
  const { activeModel, geminiApiKey } = useSettings();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drawLayerRef = useRef<HTMLCanvasElement>(null);
  const cropOverlayRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState("");
  const [loadingCount, setLoadingCount] = useState(0);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const [desktopReferenceVisible, setDesktopReferenceVisible] = useState(true);
  const [compactStudio, setCompactStudio] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const inputRef = useRef<HTMLDivElement>(null);

  // Drawing state
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const [undoStack, setUndoStack] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const undoStackRef = useRef<Stroke[]>([]);

  // Crop state
  const cropDrag = useRef<{startX: number, startY: number, origLeft: number, origTop: number} | null>(null);
  const cropResize = useRef<{pos: CropHandlePos, startX: number, startY: number, origLeft: number, origTop: number, origW: number, origH: number} | null>(null);
  const previousCanvasSize = useRef<{ width: number; height: number } | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);

  useEffect(() => {
    if (isOpen && history.length > 0 && !activeUrl) {
      // Just loaded
      setActiveUrl(history[0]);
      setUndoStack([]);
      setRedoStack([]);
      setPrompt("");
      setCropBox(null);
    }
  }, [isOpen, history, activeUrl, setActiveUrl]);

  useEffect(() => {
    if (!isOpen) {
      setReferenceDrawerOpen(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReferenceDrawerOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const syncCompactStudio = () => {
      setCompactStudio(query.matches);
      if (!query.matches) setReferenceDrawerOpen(false);
    };

    syncCompactStudio();
    query.addEventListener("change", syncCompactStudio);
    return () => query.removeEventListener("change", syncCompactStudio);
  }, []);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  const redrawStrokeList = useCallback((strokes: Stroke[]) => {
    const layer = drawLayerRef.current;
    if (!layer) return;
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, layer.width, layer.height);
    strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        const p = stroke.points[i];
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    });
  }, []);

  const redrawStrokes = useCallback(() => {
    redrawStrokeList(undoStackRef.current);
  }, [redrawStrokeList]);

  const syncDrawLayer = useCallback(() => {
    const layer = drawLayerRef.current;
    const container = canvasRef.current;
    if (!layer || !container) return;
    layer.width = container.offsetWidth;
    layer.height = container.offsetHeight;
    redrawStrokes();
  }, [redrawStrokes]);

  const fitStudioCanvas = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || !imageAspect) return;

    const refineToolbar = wrap.querySelector<HTMLElement>(".refine-toolbar");
    const openSubmenu = wrap.querySelector<HTMLElement>(".tool-submenu.open");
    const toolWidth = (refineToolbar?.offsetWidth || 0) + (openSubmenu?.offsetWidth || 0);
    const availableWidth = Math.max(0, wrap.clientWidth - toolWidth);
    const availableHeight = wrap.clientHeight;
    if (availableWidth <= 0 || availableHeight <= 0) return;

    let width = Math.min(availableWidth, availableHeight * imageAspect);
    let height = width / imageAspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * imageAspect;
    }

    setCanvasSize({
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    });
  }, [imageAspect]);

  useEffect(() => {
    if (isOpen && activeUrl) {
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          canvasRef.current.style.setProperty(
            "--studio-image-aspect",
            `${img.naturalWidth} / ${img.naturalHeight}`,
          );
          canvasRef.current.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        }
        setImageAspect(img.naturalWidth / img.naturalHeight);
      };
      img.src = activeUrl;
    }
  }, [activeUrl, isOpen]);

  useEffect(() => {
    if (!isOpen || !canvasWrapRef.current) return;
    fitStudioCanvas();
    const resizeObserver = new ResizeObserver(fitStudioCanvas);
    resizeObserver.observe(canvasWrapRef.current);
    return () => resizeObserver.disconnect();
  }, [activeTool, fitStudioCanvas, isOpen]);

  useEffect(() => {
    syncDrawLayer();
  }, [canvasSize, syncDrawLayer]);

  useEffect(() => { redrawStrokes(); }, [redrawStrokes]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'pencil' || !drawLayerRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = drawLayerRef.current.getBoundingClientRect();
    const sx = drawLayerRef.current.width / drawLayerRef.current.offsetWidth;
    const sy = drawLayerRef.current.height / drawLayerRef.current.offsetHeight;
    
    isDrawing.current = true;
    currentStroke.current = {
      color: strokeColor,
      size: strokeSize,
      points: [{ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }]
    };
    setRedoStack([]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current || !currentStroke.current || !drawLayerRef.current) return;
    e.preventDefault();
    const r = drawLayerRef.current.getBoundingClientRect();
    const sx = drawLayerRef.current.width / drawLayerRef.current.offsetWidth;
    const sy = drawLayerRef.current.height / drawLayerRef.current.offsetHeight;
    
    const pt = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    currentStroke.current.points.push(pt);
    
    const ctx = drawLayerRef.current.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.strokeStyle = currentStroke.current.color;
      ctx.lineWidth = currentStroke.current.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pts = currentStroke.current.points;
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  };

  const handlePointerUp = (e?: React.PointerEvent) => {
    if (!isDrawing.current || !currentStroke.current) return;
    isDrawing.current = false;
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setUndoStack(prev => [...prev, currentStroke.current!]);
    currentStroke.current = null;
  };

  const handleUndo = () => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    const nextUndoStack = undoStack.slice(0, -1);
    setUndoStack(nextUndoStack);
    setRedoStack(prev => [...prev, last]);
    redrawStrokeList(nextUndoStack);
  };

  const handleRedo = () => {
    if (!redoStack.length) return;
    const last = redoStack[redoStack.length - 1];
    const nextUndoStack = [...undoStack, last];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(nextUndoStack);
    redrawStrokeList(nextUndoStack);
  };

  // Crop Build
  useEffect(() => {
    if (activeTool === 'crop' && canvasRef.current) {
      const cw = canvasRef.current.offsetWidth;
      const ch = canvasRef.current.offsetHeight;
      previousCanvasSize.current = { width: cw, height: ch };
      setCropBox(createInitialCropBox(cw, ch, cropRatio));
    } else {
      setCropBox(null);
    }
  }, [activeTool, cropRatio, activeUrl]);

  useEffect(() => {
    if (activeTool !== "crop" || !canvasSize) return;
    const previous = previousCanvasSize.current;
    previousCanvasSize.current = canvasSize;
    setCropBox((prev) => {
      if (!prev) return createInitialCropBox(canvasSize.width, canvasSize.height, cropRatio);
      if (!previous) return clampCropBox(prev, canvasSize.width, canvasSize.height, cropRatio);
      return clampCropBox({
        l: prev.l * (canvasSize.width / previous.width),
        t: prev.t * (canvasSize.height / previous.height),
        w: prev.w * (canvasSize.width / previous.width),
        h: prev.h * (canvasSize.height / previous.height),
      }, canvasSize.width, canvasSize.height, cropRatio);
    });
  }, [activeTool, canvasSize, cropRatio]);

  // Crop Drag/Resize handlers
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!canvasRef.current || !cropBox) return;
      const cw = canvasRef.current.offsetWidth;
      const ch = canvasRef.current.offsetHeight;
      
      if (cropDrag.current) {
        e.preventDefault();
        const d = cropDrag.current;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        setCropBox(prev => prev ? clampCropBox({
          ...prev,
          l: d.origLeft + dx,
          t: d.origTop + dy,
        }, cw, ch, "free") : prev);
      }
      
      if (cropResize.current) {
        e.preventDefault();
        const r = cropResize.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        let left = r.origLeft;
        let top = r.origTop;
        let right = r.origLeft + r.origW;
        let bottom = r.origTop + r.origH;

        if (r.pos.includes("l")) left += dx;
        if (r.pos.includes("r")) right += dx;
        if (r.pos.includes("t")) top += dy;
        if (r.pos.includes("b")) bottom += dy;

        if (cropRatio !== "free") {
          const cr = cropRatio as number;
          let nextW = Math.abs(right - left);
          let nextH = nextW / cr;
          if (r.pos.includes("t")) top = bottom - nextH;
          else bottom = top + nextH;
          if (nextH > ch) {
            nextH = ch;
            nextW = nextH * cr;
            if (r.pos.includes("l")) left = right - nextW;
            else right = left + nextW;
            if (r.pos.includes("t")) top = bottom - nextH;
            else bottom = top + nextH;
          }
        }

        const nextBox = {
          l: Math.min(left, right),
          t: Math.min(top, bottom),
          w: Math.abs(right - left),
          h: Math.abs(bottom - top),
        };
        setCropBox(clampCropBox(nextBox, cw, ch, cropRatio));
      }
    };
    const onPointerUp = () => { cropDrag.current = null; cropResize.current = null; };
    
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
  }, [cropBox, cropRatio]);

  const applyCrop = () => {
    if (!canvasRef.current || !cropBox || !activeUrl) return;
    const img = canvasRef.current.querySelector('img');
    if (!img) return;

    const scaleX = img.naturalWidth / canvasRef.current.offsetWidth;
    const scaleY = img.naturalHeight / canvasRef.current.offsetHeight;
    const bx = cropBox.l * scaleX;
    const by = cropBox.t * scaleY;
    const bw = cropBox.w * scaleX;
    const bh = cropBox.h * scaleY;

    const offscreen = document.createElement('canvas');
    offscreen.width = bw;
    offscreen.height = bh;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
      const url = offscreen.toDataURL('image/png');
      setHistory(prev => limitStudioHistory([url, ...prev]));
      setActiveUrl(url);
      setActiveTool(null);
    }
  };

  const promptRef = useRef(prompt);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);
  const undoLengthRef = useRef(undoStack.length);
  useEffect(() => { undoLengthRef.current = undoStack.length; }, [undoStack]);
  useEffect(() => {
    if (inputRef.current && inputRef.current.textContent !== prompt) {
      inputRef.current.textContent = prompt;
    }
  }, [prompt]);

  const commandQuery = prompt.startsWith("/") ? prompt.split(/\s/, 1)[0].toLowerCase() : "";
  const filteredCommands = commandQuery
    ? STUDIO_COMMANDS.filter((command) => command.value.startsWith(commandQuery))
    : STUDIO_COMMANDS;

  useEffect(() => {
    const isLeadingCommand = prompt.startsWith("/") && !prompt.includes(" ");
    setCommandMenuOpen(isLeadingCommand && filteredCommands.length > 0);
    setCommandIndex((index) => Math.min(index, Math.max(0, filteredCommands.length - 1)));
  }, [filteredCommands.length, prompt]);

  const setPromptText = (nextPrompt: string) => {
    setPrompt(nextPrompt);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.textContent = nextPrompt;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      input.focus();
    });
  };

  const insertStudioCommand = (command: string) => {
    setPromptText(`${command} `);
    setCommandMenuOpen(false);
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
        insertStudioCommand(filteredCommands[commandIndex]?.value || filteredCommands[0].value);
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
      handleRefine();
    } else if (e.key === "Escape") {
      setPrompt("");
      e.currentTarget.blur();
    }
  };

  const handleRefine = () => {
    if (!activeUrl || !activeModel) return;
    
    const parsedCommand = parseStudioPromptCommand(prompt);
    if (parsedCommand.kind === "invalid-command") {
      alert(parsedCommand.message);
      return;
    }
    if (
      parsedCommand.kind === "upscale" &&
      !activeModel.resolutions.includes(parsedCommand.imageSize)
    ) {
      alert(`${activeModel.label} does not support ${parsedCommand.imageSize} output.`);
      return;
    }

    // Capture state
    const currentPrompt = parsedCommand.prompt;
    const isUpscale = parsedCommand.kind === "upscale";
    const studioFlavor = parsedCommand.kind === "refine" ? parsedCommand.flavor : "normal";
    const currentActiveUrl = activeUrl;
    const currentAspectRatio = aspectRatioFromImage(canvasRef.current?.querySelector('img'));
    const currentGroups = groups.map(g => ({
       action: g.action,
       name: g.name,
       images: [...g.images]
    }));

    let annotationImageUrl: string | undefined = undefined;
    if (undoStack.length > 0 && drawLayerRef.current) {
      annotationImageUrl = drawLayerRef.current.toDataURL('image/png');
    }

    // Clear UI immediately for continuous flow
    setPrompt("");
    setUndoStack([]);
    setRedoStack([]);
    setLoadingCount(c => c + 1);

    (async () => {
      try {
        const references = currentGroups.flatMap(g => 
          g.images.filter(img => img.visible !== false).map(img => ({
            action: g.action,
            name: g.name,
            url: img.url
          }))
        );

        const generatedUrl = await studioGenerate({
          modelId: activeModel.id,
          prompt: currentPrompt,
          baseImageUrl: currentActiveUrl,
          annotationImageUrl: isUpscale ? undefined : annotationImageUrl,
          references: isUpscale ? [] : references,
          imageSize: isUpscale ? parsedCommand.imageSize : undefined,
          apiKey: geminiApiKey,
          flavor: studioFlavor,
          aspectRatio: currentAspectRatio,
        });

        setHistory(prev => limitStudioHistory([generatedUrl, ...prev]));
        
        const newUuid = crypto.randomUUID();
        const usedImages: GalleryImageUse[] = [{ imgUrl: currentActiveUrl, role: "BASE" }];
        currentGroups.forEach(g => {
          g.images
            .filter((img) => img.visible !== false)
            .forEach(img => usedImages.push({ imgUrl: img.url, uuid: img.uuid, role: g.action, label: g.name }));
        });

        const createdAt = new Date().toISOString();
        addCell({
          id: Date.now(),
          uuid: newUuid,
          ratio: currentAspectRatio || "1:1",
          mode: isUpscale ? "STUDIO UPSCALE" : "STUDIO REFINE",
          type: isUpscale ? "Studio Upscale" : "Studio Edit",
          kind: "image",
          origin: "studio-edit",
          createdAt,
          updatedAt: createdAt,
          sourceUuid: undefined,
          generated: true,
          imgUrl: generatedUrl,
          prompt: currentPrompt,
          effectivePrompt: currentPrompt,
          date: createdAt,
          usedImages,
          generationSettings: {
            aspectRatio: currentAspectRatio || "1:1",
            studioFlavor
          }
        });

        // Switch to the generated image only if the user hasn't started new work
        if (promptRef.current === "" && undoLengthRef.current === 0) {
          setActiveUrl(generatedUrl);
        }

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        alert(`Generation failed: ${message}`);
      } finally {
        setLoadingCount(c => c - 1);
      }
    })();
  };

  if (!isOpen) return null;

  const renderHistoryFrames = () => (
    <div className="studio-history-frames" id="studioHistoryFrames">
      {Array.from({ length: loadingCount }).map((_, i) => (
        <div key={`loading-${i}`} className="history-thumb loading" />
      ))}
      {history.map((url, i) => (
        <div
          key={i}
          className={`history-thumb ${activeUrl === url ? 'active' : ''}`}
          onClick={() => setActiveUrl(url)}
        >
          <img src={url} alt={`History ${i}`} />
        </div>
      ))}
    </div>
  );

  return (
    <div id="studio-overlay" className="open" ref={containerRef}>
      <div className="studio-header">
        <button id="studio-close" onClick={() => closeStudio(activeUrl)}>&#8592; BACK</button>
      </div>

      <div className="studio-body">
        {!compactStudio && (
          <div className="studio-history studio-history-desktop">
            {renderHistoryFrames()}
          </div>
        )}

        {/* Center: canvas + tools + prompt */}
        <div className="studio-center">
          {compactStudio && (
            <div className="studio-history studio-history-top">
              {renderHistoryFrames()}
            </div>
          )}

          <div className="studio-canvas-wrap" ref={canvasWrapRef}>
            <div
              className="canvas-group"
              style={canvasSize ? { height: `${canvasSize.height}px` } : undefined}
            >
              <div
                className="studio-canvas"
                id="studioCanvas"
                ref={canvasRef}
                style={canvasSize ? {
                  width: `${canvasSize.width}px`,
                  height: `${canvasSize.height}px`,
                  aspectRatio: imageAspect ? `${imageAspect}` : undefined,
                } : undefined}
              >
                {activeUrl && <img src={activeUrl} alt="Active" />}
                <canvas 
                  id="studioDrawLayer" 
                  ref={drawLayerRef}
                  style={{ 
                    pointerEvents: activeTool === 'pencil' ? 'all' : 'none',
                    cursor: activeTool === 'pencil' ? 'crosshair' : 'default' 
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                ></canvas>
                
                <div id="studioCropOverlay" className={activeTool === 'crop' ? 'active' : ''} ref={cropOverlayRef}>
                  {cropBox && activeTool === 'crop' && (
                    <div 
                      className={`crop-box ${cropRatio === "free" ? "free" : "locked"}`}
                      style={{ left: cropBox.l, top: cropBox.t, width: cropBox.w, height: cropBox.h }}
                      onPointerDown={(e) => {
                        if (e.target === e.currentTarget) {
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          cropDrag.current = { startX: e.clientX, startY: e.clientY, origLeft: cropBox.l, origTop: cropBox.t };
                        }
                      }}
                    >
                      {(cropRatio === "free" ? FREE_CROP_HANDLES : LOCKED_CROP_HANDLES).map(h => (
                        <div 
                          key={h.pos}
                          className={`crop-handle ${h.className}`}
                          style={{ cursor: h.cursor }}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.setPointerCapture(e.pointerId);
                            cropResize.current = { pos: h.pos, startX: e.clientX, startY: e.clientY, origLeft: cropBox.l, origTop: cropBox.t, origW: cropBox.w, origH: cropBox.h };
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={`tool-submenu ${activeTool ? 'open' : ''}`} id="studioToolSubmenu">
                {activeTool === 'pencil' && (
                  <div className="submenu-panel visible" data-tool="pencil">
                    <div className="size-options">
                      {[3, 8, 16].map(s => (
                        <button key={s} className={`size-dot ${strokeSize === s ? 'active' : ''}`} data-size={s} onClick={() => setStrokeSize(s)}></button>
                      ))}
                    </div>
                    <div className="sub-divider"></div>
                    <div className="color-options">
                      {['#ea5823', '#c7c7c7', '#22c55e'].map(c => (
                        <button key={c} className={`color-swatch ${strokeColor === c ? 'active' : ''}`} data-color={c} style={{background: c}} onClick={() => setStrokeColor(c)}></button>
                      ))}
                    </div>
                    <div className="sub-divider"></div>
                    <div className="edit-options">
                      <button className="edit-btn" id="studioUndoBtn" onClick={handleUndo}>
                        <svg viewBox="0 0 18 18" fill="none"><path d="M3 7H11C13.2 7 15 8.8 15 11C15 13.2 13.2 15 11 15H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M6 4L3 7L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button className="edit-btn" id="studioRedoBtn" onClick={handleRedo}>
                        <svg viewBox="0 0 18 18" fill="none"><path d="M15 7H7C4.8 7 3 8.8 3 11C3 13.2 4.8 15 7 15H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M12 4L15 7L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </div>
                  </div>
                )}
                {activeTool === 'crop' && (
                  <div className="submenu-panel visible" data-tool="crop">
                    <div className="crop-options">
                      <button className={`crop-btn ${cropRatio === 16/9 ? 'active' : ''}`} data-ratio="16/9" onClick={() => setCropRatio(16/9)}>
                        <svg viewBox="0 0 36 28" fill="none"><rect x="2" y="7" width="32" height="14" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                      <button className={`crop-btn ${cropRatio === 9/16 ? 'active' : ''}`} data-ratio="9/16" onClick={() => setCropRatio(9/16)}>
                        <svg viewBox="0 0 36 28" fill="none"><rect x="12" y="1" width="12" height="26" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                      <button className={`crop-btn ${cropRatio === 1 ? 'active' : ''}`} data-ratio="1/1" onClick={() => setCropRatio(1)}>
                        <svg viewBox="0 0 36 28" fill="none"><rect x="8" y="2" width="20" height="24" stroke="currentColor" strokeWidth="1.5"/></svg>
                      </button>
                      <button className={`crop-btn ${cropRatio === 'free' ? 'active' : ''}`} data-ratio="free" onClick={() => setCropRatio('free')}>
                        <svg viewBox="0 0 36 28" fill="none"><rect x="3" y="3" width="30" height="22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"/><rect x="1" y="1" width="5" height="5" fill="currentColor"/><rect x="30" y="1" width="5" height="5" fill="currentColor"/><rect x="1" y="22" width="5" height="5" fill="currentColor"/><rect x="30" y="22" width="5" height="5" fill="currentColor"/></svg>
                      </button>
                    </div>
                    <div className="sub-divider"></div>
                    <button className="apply-btn" id="studioApplyCropBtn" onClick={applyCrop}>APPLY</button>
                  </div>
                )}
              </div>

              <div className="refine-toolbar">
                <button className={`tool-btn ${activeTool === 'pencil' ? 'active' : ''}`} data-tool="pencil" onClick={() => setActiveTool(activeTool === 'pencil' ? null : 'pencil')}>
                  <svg viewBox="0 0 40 40" fill="none"><path d="M7 33L10.5 22L28 7L35 14L16.5 30.5L7 33Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M25.5 9.5L32 16" stroke="currentColor" strokeWidth="2"/><path d="M7 33L11 29.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
                <button className={`tool-btn ${activeTool === 'crop' ? 'active' : ''}`} data-tool="crop" onClick={() => setActiveTool(activeTool === 'crop' ? null : 'crop')}>
                  <svg viewBox="0 0 40 40" fill="none"><line x1="8" y1="4" x2="8" y2="32" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="8" y1="32" x2="36" y2="32" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="14" y1="8" x2="32" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="32" y1="8" x2="32" y2="26" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><rect x="14" y="8" width="18" height="18" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div className="prompt-wrap">
            {commandMenuOpen && filteredCommands.length > 0 && (
              <div className="studio-command-menu" role="listbox" aria-label="Studio commands">
                <div className="studio-command-head">
                  <span>COMMAND</span>
                  <span>{filteredCommands.length}</span>
                </div>
                {filteredCommands.map((command, index) => (
                  <button
                    key={command.value}
                    type="button"
                    className={`studio-command-option ${index === commandIndex ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertStudioCommand(command.value);
                    }}
                  >
                    <span className="studio-command-label">{command.label}</span>
                    <span className="studio-command-description">{command.description}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="studio-prompt-bar" id="studioPromptBar" data-state="FRAME">
              <div className="prompt-input-area">
                <button
                  type="button"
                  className={`studio-reference-toggle ${(compactStudio ? referenceDrawerOpen : desktopReferenceVisible) ? "active" : ""}`}
                  onClick={() => {
                    if (compactStudio) {
                      setReferenceDrawerOpen((open) => !open);
                    } else {
                      setDesktopReferenceVisible((visible) => !visible);
                    }
                  }}
                  aria-label={(compactStudio ? referenceDrawerOpen : desktopReferenceVisible) ? "Close reference" : "Open reference"}
                  title={(compactStudio ? referenceDrawerOpen : desktopReferenceVisible) ? "Close reference" : "Open reference"}
                >
                  <span></span>
                </button>
                <div
                  className={`prompt-text-field ${prompt === "" ? "has-placeholder" : ""}`}
                  id="studioPromptInput"
                  contentEditable="true"
                  data-placeholder={undoStack.length > 0 ? "Describe what to do in the marked area..." : "What do you want me to do now?"}
                  ref={inputRef}
                  onInput={(e) => setPrompt(e.currentTarget.textContent || "")}
                  onKeyDown={handlePromptKeyDown}
                  suppressContentEditableWarning={true}
                ></div>
                <div className={`btn-frame ${loadingCount > 0 ? 'cafe-loading' : ''}`} id="studioRefineBtn" onClick={handleRefine}>
                  REFINE
                </div>
              </div>
            </div>
          </div>
        </div>

        {!compactStudio && desktopReferenceVisible && (
          <div className="studio-reference-desktop">
            <StudioModule />
          </div>
        )}
      </div>

      {compactStudio && (
        <div className={`studio-reference-drawer-shell ${referenceDrawerOpen ? "open" : ""}`}>
          <button
            type="button"
            className="studio-reference-scrim"
            onClick={() => setReferenceDrawerOpen(false)}
            aria-label="Close reference drawer"
          ></button>
          <div className="studio-reference-drawer">
            {referenceDrawerOpen && <StudioModule />}
          </div>
        </div>
      )}
    </div>
  );
}

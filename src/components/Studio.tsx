"use client";

import React, { useRef, useEffect, useState } from "react";
import { StudioGroup, StudioConfig, useStudio } from "@/context/StudioContext";
import { useSettings } from "@/context/SettingsContext";
import { useGallery } from "@/context/GalleryContext";
import { studioGenerate } from "@/lib/pipeline/api";
import StudioModule from "./StudioModule";

type Point = { x: number, y: number };
type Stroke = { color: string, size: number, points: Point[] };

export default function Studio() {
  const { 
    isOpen, activeImage, closeStudio, 
    history, setHistory, 
    activeTool, setActiveTool,
    strokeSize, setStrokeSize,
    strokeColor, setStrokeColor,
    cropRatio, setCropRatio,
    groups
  } = useStudio();
  
  const { addCell } = useGallery();
  const { googleApiKey, activeModel } = useSettings();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drawLayerRef = useRef<HTMLCanvasElement>(null);
  const cropOverlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loadingCount, setLoadingCount] = useState(0);

  // Drawing state
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const [undoStack, setUndoStack] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);

  // Crop state
  const cropDrag = useRef<{startX: number, startY: number, origLeft: number, origTop: number} | null>(null);
  const cropResize = useRef<{pos: string, startX: number, startY: number, origLeft: number, origTop: number, origW: number, origH: number} | null>(null);
  const [cropBox, setCropBox] = useState<{l: number, t: number, w: number, h: number} | null>(null);

  useEffect(() => {
    if (isOpen && history.length > 0) {
      // Just loaded
      setActiveUrl(history[0]);
      setUndoStack([]);
      setRedoStack([]);
      setPrompt("");
      setCropBox(null);
    }
  }, [isOpen, history]);

  const syncDrawLayer = () => {
    const layer = drawLayerRef.current;
    const container = canvasRef.current;
    if (!layer || !container) return;
    layer.width = container.offsetWidth;
    layer.height = container.offsetHeight;
    redrawStrokes();
  };

  useEffect(() => {
    if (isOpen && activeUrl) {
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current) {
          canvasRef.current.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        }
        syncDrawLayer();
      };
      img.src = activeUrl;
    }
  }, [activeUrl, isOpen]);

  const redrawStrokes = () => {
    const layer = drawLayerRef.current;
    if (!layer) return;
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, layer.width, layer.height);
    undoStack.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  };

  useEffect(() => { redrawStrokes(); }, [undoStack]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'pencil' || !drawLayerRef.current) return;
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

  const handlePointerUp = () => {
    if (!isDrawing.current || !currentStroke.current) return;
    isDrawing.current = false;
    setUndoStack(prev => [...prev, currentStroke.current!]);
    currentStroke.current = null;
  };

  const handleUndo = () => {
    if (!undoStack.length) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, last]);
  };

  const handleRedo = () => {
    if (!redoStack.length) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, last]);
  };

  // Crop Build
  useEffect(() => {
    if (activeTool === 'crop' && canvasRef.current) {
      const cw = canvasRef.current.offsetWidth;
      const ch = canvasRef.current.offsetHeight;
      let bw, bh;
      if (cropRatio === 'free') {
        bw = cw * 0.7; bh = ch * 0.7;
      } else {
        const cr = cropRatio as number;
        bw = Math.min(cw * 0.8, ch * 0.8 * cr);
        bh = bw / cr;
        if (bh > ch * 0.8) { bh = ch * 0.8; bw = bh * cr; }
      }
      setCropBox({ l: (cw - bw)/2, t: (ch - bh)/2, w: bw, h: bh });
    } else {
      setCropBox(null);
    }
  }, [activeTool, cropRatio, activeUrl]);

  // Crop Drag/Resize handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current || !cropBox) return;
      const cw = canvasRef.current.offsetWidth;
      const ch = canvasRef.current.offsetHeight;
      
      if (cropDrag.current) {
        const d = cropDrag.current;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        setCropBox(prev => ({
          ...prev!,
          l: Math.max(0, Math.min(d.origLeft + dx, cw - prev!.w)),
          t: Math.max(0, Math.min(d.origTop + dy, ch - prev!.h))
        }));
      }
      
      if (cropResize.current) {
        const r = cropResize.current;
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        let nl = r.origLeft, nt = r.origTop, nw = r.origW, nh = r.origH;
        
        if (r.pos === 'br') { nw = Math.max(40, r.origW + dx); nh = cropRatio === 'free' ? Math.max(40, r.origH + dy) : nw / (cropRatio as number); }
        if (r.pos === 'bl') { nw = Math.max(40, r.origW - dx); nl = r.origLeft + r.origW - nw; nh = cropRatio === 'free' ? Math.max(40, r.origH + dy) : nw / (cropRatio as number); }
        if (r.pos === 'tr') { nw = Math.max(40, r.origW + dx); nh = cropRatio === 'free' ? Math.max(40, r.origH - dy) : nw / (cropRatio as number); nt = cropRatio === 'free' ? r.origTop + r.origH - nh : r.origTop + r.origH - nw / (cropRatio as number); }
        if (r.pos === 'tl') { nw = Math.max(40, r.origW - dx); nl = r.origLeft + r.origW - nw; nh = cropRatio === 'free' ? Math.max(40, r.origH - dy) : nw / (cropRatio as number); nt = r.origTop + r.origH - nh; }
        
        nl = Math.max(0, nl); nt = Math.max(0, nt);
        nw = Math.min(nw, cw - nl); nh = Math.min(nh, ch - nt);
        setCropBox({ l: nl, t: nt, w: nw, h: nh });
      }
    };
    const onMouseUp = () => { cropDrag.current = null; cropResize.current = null; };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
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
      setHistory([url, ...history]);
      setActiveUrl(url);
      setActiveTool(null);
    }
  };

  const promptRef = useRef(prompt);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);
  const undoLengthRef = useRef(undoStack.length);
  useEffect(() => { undoLengthRef.current = undoStack.length; }, [undoStack]);

  const handleRefine = () => {
    if (!activeUrl || !googleApiKey || !activeModel) return;
    
    // Capture state
    const currentPrompt = prompt;
    const currentActiveUrl = activeUrl;
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
          g.images.map(img => ({
            action: g.action,
            name: g.name,
            url: img.url
          }))
        );

        const generatedUrl = await studioGenerate({
          modelId: activeModel.id,
          apiKey: googleApiKey,
          prompt: currentPrompt,
          baseImageUrl: currentActiveUrl,
          annotationImageUrl,
          references,
        });

        setHistory(prev => [generatedUrl, ...prev]);
        
        const newUuid = crypto.randomUUID();
        const usedImages = [{ imgUrl: currentActiveUrl }];
        currentGroups.forEach(g => {
          g.images.forEach(img => usedImages.push({ imgUrl: img.url }));
        });

        addCell({
          id: Date.now(),
          uuid: newUuid,
          ratio: "1:1",
          mode: "STUDIO REFINE",
          type: "Image",
          generated: true,
          imgUrl: generatedUrl,
          prompt: currentPrompt,
          date: new Date().toLocaleTimeString(),
          usedImages
        });

        // Switch to the generated image only if the user hasn't started new work
        if (promptRef.current === "" && undoLengthRef.current === 0) {
          setActiveUrl(generatedUrl);
        }

      } catch (err: any) {
        alert(`Generation failed: ${err.message || 'Unknown error'}`);
      } finally {
        setLoadingCount(c => c - 1);
      }
    })();
  };

  if (!isOpen) return null;

  return (
    <div id="studio-overlay" className="open" ref={containerRef}>
      <div className="studio-header">
        <button id="studio-close" onClick={() => closeStudio(activeUrl)}>&#8592; BACK</button>
      </div>

      <div className="studio-body">
        
        {/* History column */}
        <div className="studio-history">
          <div className="studio-history-label">HISTORY</div>
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
        </div>

        {/* Center: canvas + tools + prompt */}
        <div className="studio-center">
          <div className="studio-canvas-wrap">
            <div className="canvas-group">
              <div className="studio-canvas" id="studioCanvas" ref={canvasRef}>
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
                  onPointerLeave={handlePointerUp}
                ></canvas>
                
                <div id="studioCropOverlay" className={activeTool === 'crop' ? 'active' : ''} ref={cropOverlayRef}>
                  {cropBox && activeTool === 'crop' && (
                    <div 
                      className="crop-box" 
                      style={{ left: cropBox.l, top: cropBox.t, width: cropBox.w, height: cropBox.h }}
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                          e.preventDefault();
                          cropDrag.current = { startX: e.clientX, startY: e.clientY, origLeft: cropBox.l, origTop: cropBox.t };
                        }
                      }}
                    >
                      {[
                        { pos: 'tl', cursor: 'nw-resize', t: '-5px', l: '-5px' },
                        { pos: 'tr', cursor: 'ne-resize', t: '-5px', r: '-5px' },
                        { pos: 'bl', cursor: 'sw-resize', b: '-5px', l: '-5px' },
                        { pos: 'br', cursor: 'se-resize', b: '-5px', r: '-5px' }
                      ].map(h => (
                        <div 
                          key={h.pos} className="crop-handle" 
                          style={{ cursor: h.cursor, top: h.t, bottom: h.b, left: h.l, right: h.r }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
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
            <div className="refine-prompt">
              <input 
                className="prompt-input" 
                id="studioPromptInput" 
                type="text" 
                placeholder={undoStack.length > 0 ? "Describe what to do in the marked area..." : "What do you want me to do now?"}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRefine(); }}
              />
              <button className={`prompt-refine-btn ${loadingCount > 0 ? 'loading' : ''}`} id="studioRefineBtn" onClick={handleRefine}>REFINE</button>
            </div>
          </div>
        </div>

        {/* Right: reference module panel */}
        <StudioModule />
      </div>
    </div>
  );
}

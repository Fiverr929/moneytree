"use client";

import React, { useState, useEffect, useRef } from "react";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useStudio } from "@/context/StudioContext";
import { useModule } from "@/context/ModuleContext";
import DB from "@/lib/db";

export default function HUD() {
  const { 
    cells, setCells,
    hudOpen, setHudOpen,
    hudIndex, setHudIndex,
    infoPanelOpen, setInfoPanelOpen,
    ratioFilter, sortOrder
  } = useGallery();

  const { openStudio } = useStudio();
  const { setFiles } = useModule();

  const [threeDotOpen, setThreeDotOpen] = useState(false);
  const [setupPopupOpen, setSetupPopupOpen] = useState(false);
  
  const hudRef = useRef<HTMLDivElement>(null);
  const threeDotRef = useRef<HTMLDivElement>(null);

  // Derive visible cells same as Gallery
  let visibleCells = cells.filter(cell => {
    if (ratioFilter === 'landscape') return ['16:9', '21:9', '4:3'].includes(cell.ratio);
    if (ratioFilter === 'portrait')  return ['9:16', '3:4'].includes(cell.ratio);
    if (ratioFilter === 'square')    return cell.ratio === '1:1';
    return true;
  });
  if (sortOrder === "oldest") visibleCells.reverse();

  const activeCell = visibleCells[hudIndex];

  // Keyboard navigation
  useEffect(() => {
    if (!hudOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "Escape") {
        if (infoPanelOpen) setInfoPanelOpen(false);
        else setHudOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hudOpen, hudIndex, visibleCells.length, infoPanelOpen]);

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

  if (!activeCell) return null; // Wait until active cell is available

  const handleNext = () => {
    if (!visibleCells.length) return;
    setHudIndex((hudIndex + 1) % visibleCells.length);
  };

  const handlePrev = () => {
    if (!visibleCells.length) return;
    setHudIndex((hudIndex - 1 + visibleCells.length) % visibleCells.length);
  };

  const handleDelete = () => {
    if (activeCell?.id) DB.gallery.delete(activeCell.id);
    setCells(prev => prev.filter(c => c.id !== activeCell.id));
    setHudOpen(false);
  };

  const handleDuplicate = () => {
    const newCell = { ...activeCell, id: Date.now() + Math.random(), uuid: crypto.randomUUID(), _imgUuid: undefined, _dbId: undefined };
    setCells(prev => [newCell, ...prev]);
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
    if (!activeCell.prompt) return;
    window.dispatchEvent(new CustomEvent("set-prompt", { detail: activeCell.prompt }));
    setThreeDotOpen(false);
    setHudOpen(false);
  };

  const handleCopyPrompt = () => {
    if (!activeCell.prompt || !navigator.clipboard) return;
    navigator.clipboard.writeText(activeCell.prompt);
  };

  const handleLoadSetup = () => {
    if (activeCell.moduleSnapshot?.files) {
      setFiles(activeCell.moduleSnapshot.files);
    }
    if (activeCell.prompt) {
      window.dispatchEvent(new CustomEvent("set-prompt", { detail: activeCell.prompt }));
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
        <span id="hud-counter">{hudIndex + 1} OF {visibleCells.length}</span>

        <div className="hud-spacer"></div>

        <button className="hud-icon-btn" id="hud-edit" title="Refine Area" onClick={(e) => { 
          e.stopPropagation(); 
          if (activeCell) openStudio({ uuid: activeCell.uuid, imgUrl: activeCell.imgUrl, caller: 'gallery' });
        }}>
          <svg width="14" height="14" viewBox="0 0 14.7989 14.7272" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 13.1289V11.5305L1.16648 10.3707C4.97904 6.57996 8.40899 3.18909 8.44436 3.17571C8.46326 3.16815 9.72577 4.40376 11.0113 5.68169L11.6502 6.31671L7.45474 10.5219L3.25927 14.7272H1.62965H0V13.1289ZM11.1262 3.66073L9.55907 2.09352L10.6058 1.04673L11.6526 0L13.2258 1.57315L14.7989 3.14624L13.7582 4.18715C13.1859 4.75963 12.7121 5.22799 12.7054 5.22799C12.6979 5.22799 11.9881 4.52272 11.1262 3.66073Z" fill="currentColor" />
          </svg>
        </button>
        <button className={`hud-icon-btn ${infoPanelOpen ? "active" : ""}`} id="hud-info" title="Image Info" onClick={() => setInfoPanelOpen(!infoPanelOpen)}>ℹ</button>

        <div id="hud-threedot-wrap" style={{position:'relative'}} ref={threeDotRef}>
          <button className={`hud-icon-btn ${threeDotOpen ? "active open" : ""}`} id="hud-threedot" title="More" onClick={() => setThreeDotOpen(!threeDotOpen)}>⋯</button>
          <div className="cmp-menu hud-image-menu" id="hud-threedot-dropdown" hidden={!threeDotOpen}>
            <div className="cmp-menu-title">IMAGE</div>
            <button className="primary" id="hud-drop-reuse" type="button" onClick={handleReusePrompt}>REUSE</button>
            <button id="hud-drop-duplicate" type="button" onClick={handleDuplicate}>DUPLICATE</button>
          </div>
        </div>
      </div>

      {/* Image viewport */}
      <div id="hud-image-area">
        <div id="hud-slide-track" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
          {visibleCells.map((cell, i) => (
            <div 
              key={cell.id} 
              className="hud-slide" 
              data-slide-id={i}
              style={{ transform: `translateX(${(i - hudIndex) * 100}%)` }}
            >
              {cell.imgUrl ? (
                <img className="hud-slide-img" src={cell.imgUrl} alt="Generated" />
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
          <button className="info-close" id="hud-info-close" onClick={() => setInfoPanelOpen(false)}>×</button>

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
              <span className="info-item-value" id="info-date">{activeCell.date || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-item-label">Type</span>
              <span className="info-item-value" id="info-type">{activeCell.type || '—'}</span>
            </div>
            <div className="info-item">
              <span className="info-item-label">Dimensions</span>
              <span className="info-item-value" id="info-dims">{activeCell.dims || '—'}</span>
            </div>
          </div>

          <div className="info-section-header">
            <span className="info-section-title">Prompt</span>
            <button className="info-icon-btn" id="btn-copy-prompt" title="Copy prompt" onClick={handleCopyPrompt}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <div className="prompt-text" id="info-prompt">{activeCell.prompt || '—'}</div>
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



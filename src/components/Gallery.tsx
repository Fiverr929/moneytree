"use client";

import React, { useState, useEffect, useRef } from "react";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useApp } from "@/context/AppContext";
import DB from "@/lib/db";
import { isHudImageCell } from "@/lib/galleryCells";

export default function Gallery() {
  const { 
    cells, setCells,
    selectMode, setSelectMode,
    selectedIds, setSelectedIds,
    currentView, setCurrentView,
    sortOrder, setSortOrder,
    ratioFilter, setRatioFilter,
    setHudOpen, setHudIndex
  } = useGallery();
  const { activeProjectId } = useApp();

  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [threeDotDropdownOpen, setThreeDotDropdownOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const threeDotRef = useRef<HTMLDivElement>(null);

  const persistCell = async (cell: GalleryCell) => {
    if (!cell.uuid || !cell.imgUrl) return;
    if (!activeProjectId) return;
    await DB.images.put(cell.uuid, cell.imgUrl, activeProjectId);
    await DB.gallery.put({ ...cell, project_id: activeProjectId, loadingId: undefined, retryFn: undefined });
  };

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false);
      }
      if (threeDotRef.current && !threeDotRef.current.contains(e.target as Node)) {
        setThreeDotDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  // Filter and Sort Cells
  const filteredCells = cells.filter(cell => {
    if (ratioFilter === 'landscape') return ['16:9', '21:9', '4:3'].includes(cell.ratio);
    if (ratioFilter === 'portrait')  return ['9:16', '3:4'].includes(cell.ratio);
    if (ratioFilter === 'square')    return cell.ratio === '1:1';
    return true;
  });

  const visibleCells = sortOrder === "oldest" ? [...filteredCells].reverse() : filteredCells;
  const hudCells = visibleCells.filter(isHudImageCell);

  const handleCellClick = (cellId: number) => {
    if (selectMode) {
      const next = new Set(selectedIds);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      setSelectedIds(next);
    } else {
      const idx = hudCells.findIndex(c => c.id === cellId);
      if (idx !== -1) {
        setHudIndex(idx);
        setHudOpen(true);
      }
    }
  };

  const handleDuplicateSelected = () => {
    const newCells: GalleryCell[] = [];
    selectedIds.forEach(id => {
      const cell = cells.find(c => c.id === id);
      if (cell) {
        const newCell = {
          ...cell,
          id: crypto.getRandomValues(new Uint32Array(1))[0],
          uuid: crypto.randomUUID(),
          type: "Duplicate",
          kind: "image" as const,
          origin: "duplicate" as const,
          sourceUuid: cell.uuid,
          updatedAt: new Date().toISOString(),
          date: new Date().toISOString(),
          _imgUuid: undefined,
          _dbId: undefined,
          loadingId: undefined,
          blocked: undefined,
          error: undefined,
          retryFn: undefined,
        };
        newCells.push(newCell);
        if (activeProjectId) {
          void persistCell(newCell).catch((error) => console.error("Failed to persist duplicate", error));
        }
      }
    });
    setCells(prev => [...newCells, ...prev]);
    setSelectedIds(new Set());
    setSelectMode(false);
    setThreeDotDropdownOpen(false);
  };

  const handleDeleteSelected = () => {
    selectedIds.forEach(id => {
      const cell = cells.find(c => c.id === id);
      void DB.gallery.delete(id).catch((error) => console.error("Failed to delete gallery record", error));
      if (cell?.uuid) {
        void DB.images.delete(cell.uuid).catch((error) => console.error("Failed to delete gallery image", error));
      }
    });
    setCells(prev => prev.filter(c => !selectedIds.has(c.id)));
    setSelectedIds(new Set());
    setSelectMode(false);
    setThreeDotDropdownOpen(false);
  };

  const hasSelected = selectedIds.size > 0;
  const isFilterActive = sortOrder === "oldest" || ratioFilter !== "all";

  return (
    <div id="gallery-panel">
      <div id="gallery-controls">
        <div id="threedot-wrap" className={selectMode ? "visible" : ""} ref={threeDotRef}>
          <button 
            id="btn-threedot" 
            className={`${!hasSelected ? "btn-disabled" : ""} ${threeDotDropdownOpen ? "active" : ""}`}
            onClick={() => { if (hasSelected) setThreeDotDropdownOpen(!threeDotDropdownOpen); }}
            title="More actions"
          >
            <span></span><span></span><span></span>
          </button>
          <div className={`cmp-menu gallery-action-menu ${threeDotDropdownOpen ? "open" : ""}`} id="threedot-dropdown" hidden={!threeDotDropdownOpen}>
            <div className="cmp-menu-title">SELECTED</div>
            <button id="ddrop-download" disabled={!hasSelected}>DOWNLOAD</button>
            <div className="cafe-menu-divider"></div>
            <button id="ddrop-duplicate" disabled={!hasSelected} onClick={handleDuplicateSelected}>DUPLICATE</button>
            <button className="danger" id="ddrop-delete" disabled={!hasSelected} onClick={handleDeleteSelected}>DELETE</button>
          </div>
        </div>

        <button 
          id="btn-select" 
          className={selectMode ? "active" : ""}
          onClick={() => {
            if (selectMode) {
              setSelectedIds(new Set());
              setThreeDotDropdownOpen(false);
            }
            setSelectMode(!selectMode);
          }}
        >
          {selectMode ? "DONE" : "SELECT"}
        </button>

        <div className="ctrl-spacer"></div>

        <div className="view-toggles">
          <button className={`btn-view ${currentView === "small" ? "active" : ""}`} data-view-target="small" onClick={() => setCurrentView("small")}>
            <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="3" height="3" fill="currentColor"/><rect x="4" y="0" width="3" height="3" fill="currentColor"/><rect x="8" y="0" width="3" height="3" fill="currentColor"/><rect x="12" y="0" width="3" height="3" fill="currentColor"/><rect x="0" y="4" width="3" height="3" fill="currentColor"/><rect x="4" y="4" width="3" height="3" fill="currentColor"/><rect x="8" y="4" width="3" height="3" fill="currentColor"/><rect x="12" y="4" width="3" height="3" fill="currentColor"/><rect x="0" y="8" width="3" height="3" fill="currentColor"/><rect x="4" y="8" width="3" height="3" fill="currentColor"/><rect x="8" y="8" width="3" height="3" fill="currentColor"/><rect x="12" y="8" width="3" height="3" fill="currentColor"/><rect x="0" y="12" width="3" height="3" fill="currentColor"/><rect x="4" y="12" width="3" height="3" fill="currentColor"/><rect x="8" y="12" width="3" height="3" fill="currentColor"/><rect x="12" y="12" width="3" height="3" fill="currentColor"/></svg>
          </button>
          <button className={`btn-view ${currentView === "medium" ? "active" : ""}`} data-view-target="medium" onClick={() => setCurrentView("medium")}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="6" height="6" fill="currentColor"/><rect x="7" y="0" width="6" height="6" fill="currentColor"/><rect x="14" y="0" width="6" height="6" fill="currentColor"/><rect x="0" y="7" width="6" height="6" fill="currentColor"/><rect x="7" y="7" width="6" height="6" fill="currentColor"/><rect x="14" y="7" width="6" height="6" fill="currentColor"/><rect x="0" y="14" width="6" height="6" fill="currentColor"/><rect x="7" y="14" width="6" height="6" fill="currentColor"/><rect x="14" y="14" width="6" height="6" fill="currentColor"/></svg>
          </button>
          <button className={`btn-view ${currentView === "large" ? "active" : ""}`} data-view-target="large" onClick={() => setCurrentView("large")}>
            <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="7" height="7" fill="currentColor"/><rect x="8" y="0" width="7" height="7" fill="currentColor"/><rect x="0" y="8" width="7" height="7" fill="currentColor"/><rect x="8" y="8" width="7" height="7" fill="currentColor"/></svg>
          </button>
        </div>

        <div className="ctrl-spacer"></div>

        <div id="filter-wrap" ref={filterRef}>
          <button 
            id="btn-filter"
            className={`${isFilterActive ? "has-filter" : ""} ${filterDropdownOpen ? "active" : ""}`} 
            onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
          >
            <svg width="21" height="12" viewBox="0 0 21 12" fill="none">
              <rect x="0" y="0" width="21" height="2" fill="#c7c7c7" />
              <rect x="3" y="5" width="15" height="2" fill="#c7c7c7" />
              <rect x="6" y="10" width="9" height="2" fill="#c7c7c7" />
            </svg>
          </button>
          <div className={`cmp-menu gallery-filter-menu ${filterDropdownOpen ? "open" : ""}`} id="filter-dropdown" hidden={!filterDropdownOpen}>
            <div className="cmp-menu-title">SORT</div>
            <button className={`filter-chip ${sortOrder === "newest" ? "active" : ""}`} onClick={() => setSortOrder("newest")}>NEWEST</button>
            <button className={`filter-chip ${sortOrder === "oldest" ? "active" : ""}`} onClick={() => setSortOrder("oldest")}>OLDEST</button>
            
            <div className="cmp-menu-title">ASPECT</div>
            <button className={`filter-chip ${ratioFilter === "all" ? "active" : ""}`} onClick={() => setRatioFilter("all")}>ALL</button>
            <button className={`filter-chip ${ratioFilter === "landscape" ? "active" : ""}`} onClick={() => setRatioFilter("landscape")}>LANDSCAPE</button>
            <button className={`filter-chip ${ratioFilter === "portrait" ? "active" : ""}`} onClick={() => setRatioFilter("portrait")}>PORTRAIT</button>
            <button className={`filter-chip ${ratioFilter === "square" ? "active" : ""}`} onClick={() => setRatioFilter("square")}>SQUARE</button>
          </div>
        </div>
      </div>
      
      <div id="gallery-scroll" data-view={currentView} data-select={selectMode ? "on" : "off"}>
        <div id="gallery-grid">
          {visibleCells.map(cell => (
            <div 
              key={cell.loadingId || cell.id} 
              className={`gallery-cell ${selectedIds.has(cell.id) ? "selected" : ""}`}
              data-id={cell.id}
              data-ratio={cell.ratio}
              data-loading-id={cell.loadingId}
              onClick={() => !cell.loadingId && handleCellClick(cell.id)}
            >
              <div 
                className={`cell-inner ${cell.phClass || ""} ${cell.loadingId && !cell.blocked && !cell.error ? "cafe-loading" : ""} ${cell.blocked ? "cell-blocked" : ""} ${cell.error ? "cell-error" : ""}`}
                style={{
                  backgroundColor: cell.loadingId ? "#ea5823" : undefined,
                  backgroundImage: cell.imgUrl ? `url('${cell.imgUrl}')` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {cell.blocked && <span className="cell-blocked-label">{cell.statusLabel || "BLOCKED"}</span>}
                {cell.error && (
                  <span className="cell-error-label" onClick={(e) => {
                    e.stopPropagation();
                    if (cell.retryFn && cell.loadingId) {
                      setCells((current) => current.map((entry) =>
                        entry.loadingId === cell.loadingId
                          ? { ...entry, error: false, blocked: false, statusLabel: undefined, phClass: "loading" }
                          : entry
                      ));
                      cell.retryFn(cell.loadingId);
                    }
                  }} style={{ cursor: cell.retryFn ? 'pointer' : 'default' }}>
                    {cell.retryFn ? "RETRY" : (cell.statusLabel || "FAILED")}
                  </span>
                )}
              </div>
              <div className="cell-check"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


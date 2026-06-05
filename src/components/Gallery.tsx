"use client";

import React, { useState, useEffect, useRef } from "react";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import DB from "@/lib/db";

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

  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [threeDotDropdownOpen, setThreeDotDropdownOpen] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);
  const threeDotRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false);
      }
      if (threeDotRef.current && !threeDotRef.current.contains(e.target as Node)) {
        setThreeDotDropdownOpen(false);
      }
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) {
        setViewDropdownOpen(false);
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

  const handleCellClick = (cellId: number) => {
    if (selectMode) {
      const next = new Set(selectedIds);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      setSelectedIds(next);
    } else {
      const idx = visibleCells.findIndex(c => c.id === cellId);
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
        newCells.push({ ...cell, id: crypto.getRandomValues(new Uint32Array(1))[0], uuid: crypto.randomUUID(), _imgUuid: undefined, _dbId: undefined });
      }
    });
    setCells(prev => [...newCells, ...prev]);
    setSelectedIds(new Set());
    setSelectMode(false);
    setThreeDotDropdownOpen(false);
  };

  const handleDeleteSelected = () => {
    selectedIds.forEach(id => DB.gallery.delete(id));
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

        <div id="view-wrap" ref={viewRef}>
          <button 
            id="btn-grid-view"
            className={viewDropdownOpen ? "active" : ""} 
            onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
            title="Grid size"
          >
            GRID
          </button>
          <div className={`cmp-menu gallery-view-menu ${viewDropdownOpen ? "open" : ""}`} id="view-dropdown" hidden={!viewDropdownOpen}>
            <div className="cmp-menu-title">GRID SIZE</div>
            <button className={`filter-chip ${currentView === "small" ? "active" : ""}`} onClick={() => { setCurrentView("small"); setViewDropdownOpen(false); }}>
              <span>4X4 GRID</span>
            </button>
            <button className={`filter-chip ${currentView === "medium" ? "active" : ""}`} onClick={() => { setCurrentView("medium"); setViewDropdownOpen(false); }}>
              <span>3X3 GRID</span>
            </button>
            <button className={`filter-chip ${currentView === "large" ? "active" : ""}`} onClick={() => { setCurrentView("large"); setViewDropdownOpen(false); }}>
              <span>2X2 GRID</span>
            </button>
          </div>
        </div>

        <div id="filter-wrap" ref={filterRef}>
          <button 
            id="btn-filter"
            className={`${isFilterActive ? "has-filter" : ""} ${filterDropdownOpen ? "active" : ""}`} 
            onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
          >
            SORT
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

        <div className="ctrl-spacer"></div>
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
                className={`cell-inner ${cell.phClass || ""} ${cell.loadingId ? "cafe-loading" : ""} ${cell.blocked ? "cell-blocked" : ""} ${cell.error ? "cell-error" : ""}`}
                style={{
                  backgroundColor: cell.loadingId ? (cell.mode === "SCENE" ? "#5271ff" : "#ea5823") : undefined,
                  backgroundImage: cell.imgUrl ? `url('${cell.imgUrl}')` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                {cell.blocked && <span className="cell-blocked-label">BLOCKED</span>}
                {cell.error && (
                  <span className="cell-error-label" onClick={(e) => {
                    e.stopPropagation();
                    if (cell.retryFn && cell.loadingId) {
                      cell.retryFn(cell.loadingId);
                    }
                  }}>
                    RETRY
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


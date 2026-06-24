"use client";

import React, { useRef, useState, useEffect } from "react";
import { useStudio, StudioGroup } from "@/context/StudioContext";
import DB from "@/lib/db";
import { useApp } from "@/context/AppContext";

const ACTIONS = ['INSERT', 'SWAP', 'TRANSFER', 'REMOVE', 'PRESERVE'];
const MAX_IMAGES = 3;
type PendingUpload =
  | { type: 'create'; action: string }
  | { type: 'insert'; index: number }
  | { type: 'replace'; index: number; imageIndex: number };

export default function StudioModule() {
  const { groups, setGroups, isOpen } = useStudio();
  const { activeProjectId } = useApp();
  
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [actionDrawerId, setActionDrawerId] = useState<number | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.studio-module-panel')) {
        setHeaderMenuOpen(false);
        setActionDrawerId(null);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUpload) {
      setPendingUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const url = evt.target?.result as string;
      const uuid = crypto.randomUUID();

      if (pendingUpload.type === 'create') {
        if (activeProjectId) {
          await DB.images.put(uuid, url, activeProjectId);
        }
        const newGroup: StudioGroup = {
          action: pendingUpload.action,
          name: 'REFERENCE',
          images: [{ uuid, url, visible: true }]
        };
        setGroups([newGroup, ...groups]);
      } else if (pendingUpload.type === 'insert') {
        if (activeProjectId) {
          await DB.images.put(uuid, url, activeProjectId);
        }
        const next = [...groups];
        next[pendingUpload.index].images.push({ uuid, url, visible: true });
        setGroups(next);
      } else if (pendingUpload.type === 'replace') {
        const next = [...groups];
        const current = next[pendingUpload.index]?.images[pendingUpload.imageIndex];
        if (current && activeProjectId) {
          await DB.images.put(current.uuid, url, activeProjectId);
        }
        if (current) {
          next[pendingUpload.index].images[pendingUpload.imageIndex] = { ...current, url };
          setGroups(next);
        }
      }
      
      setPendingUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const removeGroup = async (idx: number) => {
    const group = groups[idx];
    if (activeProjectId) {
      for (const img of group.images) await DB.images.delete(img.uuid);
    }
    setGroups(groups.filter((_, i) => i !== idx));
  };

  const removeImage = async (groupIdx: number, imgIdx: number) => {
    const next = [...groups];
    const group = next[groupIdx];
    const img = group.images[imgIdx];
    
    if (activeProjectId) await DB.images.delete(img.uuid);
    
    group.images.splice(imgIdx, 1);
    if (group.images.length === 0) {
      setGroups(next.filter((_, i) => i !== groupIdx));
    } else {
      setGroups(next);
    }
  };

  const toggleImageVisibility = (groupIdx: number, imgIdx: number) => {
    const next = groups.map((group, gIdx) => {
      if (gIdx !== groupIdx) return group;
      return {
        ...group,
        images: group.images.map((img, iIdx) => (
          iIdx === imgIdx ? { ...img, visible: img.visible === false } : img
        ))
      };
    });
    setGroups(next);
  };

  return (
    <div className="studio-module-panel">
      <div className="studio-module-header">
        REFERENCE
        <div 
          className={`sm-header-add ${headerMenuOpen ? 'active' : ''}`}
          id="sm-header-add"
          onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen(!headerMenuOpen); setActionDrawerId(null); setEditingGroupId(null); }}
        ></div>
      </div>

      <div className="studio-module-scroll">
        {headerMenuOpen && (
          <div className="sm-header-action-menu">
            {ACTIONS.map(a => (
              <button key={a} type="button" className="sm-create-option" onClick={(e) => {
                e.stopPropagation();
                setHeaderMenuOpen(false);
                setPendingUpload({ type: 'create', action: a });
                fileInputRef.current?.click();
              }}>{a}</button>
            ))}
          </div>
        )}

        <div className="mod-layers">
          {groups.map((g, gIdx) => {
            const isEditingName = editingGroupId === gIdx;
            const isActionOpen = actionDrawerId === gIdx;

            return (
              <div key={gIdx} className={`layer-group ${isEditingName ? 'drawer-open' : ''} ${isActionOpen ? 'action-drawer-open' : ''}`}>
                <div className="plr">
                  {g.images.length === 1 && (
                    <div className="plr-x blue" onClick={() => removeGroup(gIdx)}>
                      <img src="assets/icon-x-inactive.svg" alt="x" />
                    </div>
                  )}
                  <button 
                    type="button" 
                    className="sm-action-btn"
                    onClick={(e) => { e.stopPropagation(); setActionDrawerId(isActionOpen ? null : gIdx); setEditingGroupId(null); setHeaderMenuOpen(false); }}
                  >
                    {g.action}
                  </button>
                  <div 
                    className="plr-name blue" 
                    onClick={(e) => { e.stopPropagation(); setEditingGroupId(gIdx); setEditingGroupName(g.name); setActionDrawerId(null); setHeaderMenuOpen(false); }}
                  >
                    {g.name}
                  </div>
                </div>

                {isActionOpen && (
                  <div className="sm-action-drawer">
                    {ACTIONS.map(a => (
                      <button 
                        key={a} 
                        type="button" 
                        className={`sm-action-option ${a === g.action ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = [...groups];
                          next[gIdx].action = a;
                          setGroups(next);
                          setActionDrawerId(null);
                        }}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}

                {isEditingName && (
                  <div className="sm-name-editor">
                    <input 
                      autoFocus
                      className="sm-name-input" 
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onBlur={() => {
                        const next = [...groups];
                        next[gIdx].name = editingGroupName.trim().toUpperCase() || 'REFERENCE';
                        setGroups(next);
                        setEditingGroupId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditingGroupId(null);
                      }}
                    />
                  </div>
                )}

                <div className="layer-children">
                  {g.images.map((img, iIdx) => {
                    const hidden = img.visible === false;
                    return (
                    <div key={img.uuid} className={`clr ${hidden ? 'reference-hidden' : ''}`}>
                      <button
                        type="button"
                        className={`clr-toggle ${hidden ? 'off' : ''}`}
                        title={hidden ? "Include reference" : "Hide reference"}
                        aria-label={hidden ? "Include reference" : "Hide reference"}
                        onClick={() => toggleImageVisibility(gIdx, iIdx)}
                      >
                        <img
                          src={hidden ? "assets/icon-eye-off.svg" : "assets/icon-eye-on.svg"}
                          alt={hidden ? "hidden" : "visible"}
                        />
                      </button>
                      {g.images.length > 1 && (
                        <div className="clr-x" onClick={() => removeImage(gIdx, iIdx)}>
                          <img src="assets/icon-trash.svg" alt="remove" />
                        </div>
                      )}
                      <button
                        type="button"
                        className="clr-replace"
                        title="Replace reference"
                        aria-label="Replace reference"
                        onClick={() => {
                          setPendingUpload({ type: 'replace', index: gIdx, imageIndex: iIdx });
                          fileInputRef.current?.click();
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3l-3.35 3.35Z" />
                        </svg>
                      </button>
                      <div className="clr-main img-a">
                        <img src={img.url} style={{width: '100%', height: '100%', objectFit: 'cover'}} alt="image" />
                      </div>
                    </div>
                  )})}
                  <div className={`add-child-row ${g.images.length >= MAX_IMAGES ? 'disabled' : ''}`}>
                    <div className="btn-add-child" onClick={() => {
                      if (g.images.length >= MAX_IMAGES) return;
                      setPendingUpload({ type: 'insert', index: gIdx });
                      fileInputRef.current?.click();
                    }}>
                      <img src="assets/icon-add-child.svg" alt="+" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      <input type="file" style={{display: 'none'}} accept="image/*" ref={fileInputRef} onChange={handleFileUpload} />
    </div>
  );
}

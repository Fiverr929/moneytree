"use client";

import React, { useState, useEffect, useRef, KeyboardEvent } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings } from "@/context/SettingsContext";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useModule } from "@/context/ModuleContext";
import { generate, storeGenerationDebug } from "@/lib/pipeline/api";
import { collectPayload } from "@/lib/pipeline/prompt-builder";

const PROMPT_DRAFT_STORAGE_KEY = "cafehtml-prompt-draft";

export default function PromptBar() {
  const { setSettingsOpen, activeProjectId } = useApp();
  const settings = useSettings();
  const gallery = useGallery();
  const moduleContext = useModule();
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  
  // Prompt settings state
  const [frameRatio, setFrameRatio] = useState("1:1");
  const [frameVar, setFrameVar] = useState<string | number>("1");
  
  // Prompt Input state
  const [promptText, setPromptText] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

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
    try {
      const savedDraft = window.localStorage.getItem(PROMPT_DRAFT_STORAGE_KEY);
      if (savedDraft !== null) {
        setPromptText(savedDraft);
      }
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROMPT_DRAFT_STORAGE_KEY, promptText);
    } catch {
      // Ignore storage access issues in embedded browsers.
    }
  }, [promptText]);

  const handleGenerate = async () => {
    if (!settings.googleApiKey.trim()) {
      setSettingsOpen(true);
      setDropdownOpen(false);
      return;
    }

    const trimmed = promptText.trim();
    if (trimmed && promptHistory[0] !== trimmed) {
      setPromptHistory([trimmed, ...promptHistory]);
    }
    setHistoryIndex(-1);

    const fullSettings = {
      ...settings,
      aspectRatio: frameRatio,
      variation: parseInt(frameVar.toString(), 10)
    };

    const payload = collectPayload(
      trimmed,
      moduleContext.files,
      fullSettings
    );

    const debugStartedAt = new Date().toISOString();
    const promptBarDebug = {
      status: 'promptbar-started',
      startedAt: debugStartedAt,
      updatedAt: debugStartedAt,
      source: 'PromptBar.handleGenerate',
      userPrompt: trimmed,
      rawPrompt: trimmed,
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
      await generate(payload, fullSettings, settings.googleApiKey, {
        onStart: (count) => console.log('Starting generation of', count, 'images...'),
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
          alert(`Generation Failed: ${err.message}`);
        }
      }, moduleContext.files);
    } finally {
      setActiveGenerationCount((count) => Math.max(0, count - 1));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
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

  return (
    <div className="prompt-bar" id="promptBar" data-state="FRAME">
      <div 
        className="btn-upload-ref" 
        id="moduleQuickUpload" 
        title="Add module image"
        onClick={() => document.getElementById("mp-file-input")?.click()}
      ></div>
      
      <div className="settings-anchor" ref={dropdownRef}>
        <div 
          className={`btn-settings ${dropdownOpen ? "open" : ""}`} 
          id="settingsBtn"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <img src="assets/icon-settings.svg" alt="settings" />
        </div>
        
        <div className="cmp-menu settings-dropdown" id="settingsDropdown" hidden={!dropdownOpen}>
          
          <div className="cmp-menu-title">ASPECT RATIO</div>
          <>
            {["1:1", "16:9", "9:16", "3:4"].map((r) => {
              const labels: Record<string, string> = { "1:1": "SQUARE", "16:9": "LANDSCAPE", "9:16": "PORTRAIT", "3:4": "PORTRAIT" };
              return (
                <button
                  key={r}
                  className={frameRatio === r ? "active primary" : ""}
                  onClick={() => setFrameRatio(r)}
                >
                  {r} {labels[r]}
                </button>
              );
            })}
          </>

          <div className="cmp-menu-title" style={{ marginTop: 2, borderTop: '0.756px solid rgba(234,88,35,0.45)' }}>
            VARIATIONS
          </div>
          
          <div className="cmp-menu-counter" style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', justifyContent: 'space-between', color: '#c7c7c7', fontSize: '9px', letterSpacing: '0.12em' }}>
            <button 
              style={{ width: '24px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: '#c7c7c7' }}
              onClick={(e) => {
                e.stopPropagation();
                const v = parseInt(frameVar.toString(), 10);
                if (v > 1) setFrameVar(v - 1);
              }}
            >-</button>
            <span>{frameVar} IMAGE{parseInt(frameVar.toString(), 10) !== 1 ? "S" : ""}</span>
            <button 
              style={{ width: '24px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: '#c7c7c7' }}
              onClick={(e) => {
                e.stopPropagation();
                const v = parseInt(frameVar.toString(), 10);
                if (v < 10) setFrameVar(v + 1);
              }}
            >+</button>
          </div>
        </div>
      </div>

      <div className="prompt-input-area">
        <div 
          className={`prompt-text-field ${promptText === "" ? "has-placeholder" : ""}`} 
          id="promptText" 
          contentEditable="true"
          data-placeholder={placeholderText}
          ref={inputRef}
          onInput={(e) => setPromptText(e.currentTarget.textContent || "")}
          onKeyDown={handleKeyDown}
          suppressContentEditableWarning={true}
        ></div>
        <div className={`btn-frame ${activeGenerationCount > 0 ? 'cafe-loading' : ''}`} id="generateBtn" onClick={handleGenerate}>
          FRAME
        </div>
      </div>
    </div>
  );
}





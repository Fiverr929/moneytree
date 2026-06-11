"use client";

import React, { useState, useEffect, useRef, KeyboardEvent } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings } from "@/context/SettingsContext";
import { useGallery, GalleryCell } from "@/context/GalleryContext";
import { useModule } from "@/context/ModuleContext";
import { generate, storeGenerationDebug } from "@/lib/pipeline/api";
import { collectPayload } from "@/lib/pipeline/prompt-builder";

export default function PromptBar() {
  const { generationState, setGenerationState, setSettingsOpen } = useApp();
  const settings = useSettings();
  const gallery = useGallery();
  const moduleContext = useModule();
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Prompt settings state
  const [frameRatio, setFrameRatio] = useState("1:1");
  const [frameVar, setFrameVar] = useState<string | number>("1");
  const [sceneRatio, setSceneRatio] = useState("9:16");
  const [frameCount, setFrameCount] = useState<string | number>("2");
  
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

  const toggleState = () => {
    setGenerationState(generationState === "FRAME" ? "STAGE" : "FRAME");
    setDropdownOpen(false);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
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
      aspectRatio: generationState === "FRAME" ? frameRatio : sceneRatio,
      variation: generationState === "FRAME" ? parseInt(frameVar.toString(), 10) : parseInt(frameCount.toString(), 10)
    };

    const payload = collectPayload(
      generationState,
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
      rawPrompt: trimmed,
      payload,
      settings: {
        mode: generationState,
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

    setIsGenerating(true);
    await generate(payload, fullSettings, settings.googleApiKey, {
      onStart: (count) => console.log('Starting generation of', count, 'images...'),
      onLoadingIds: (ids) => {
        ids.forEach(id => gallery.addLoading(id, (payload.settings.aspectRatio || '1:1'), generationState));
      },
      onVariationReady: (dataUrl, lid, cellData) => {
        gallery.resolveLoading(lid, cellData as GalleryCell);
      },
      onVariationBlocked: (lid) => {
        gallery.blockLoading(lid);
      },
      onVariationFailed: (lid, retryFn) => {
        gallery.failLoading(lid, retryFn);
      },
      onGenerationError: (ids) => {
        ids.forEach((id) => gallery.removeLoading(id));
      },
      onComplete: () => {
        setIsGenerating(false);
      },
      onError: (err) => {
        console.error('Generation Error:', err);
        alert(`Generation Failed: ${err.message}`);
        setIsGenerating(false);
      }
    }, moduleContext.files);
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

  const placeholderText = generationState === "STAGE" ? "Are we making a movie?" : "What are we making today?";

  return (
    <div className="prompt-bar" id="promptBar" data-state={generationState}>
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
          {generationState === "FRAME" ? (
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
          ) : (
            <>
              {["16:9", "9:16"].map((r) => {
                const labels: Record<string, string> = { "16:9": "LANDSCAPE", "9:16": "PORTRAIT" };
                return (
                  <button 
                    key={r} 
                    className={sceneRatio === r ? "active primary" : ""} 
                    onClick={() => setSceneRatio(r)}
                  >
                    {r} {labels[r]}
                  </button>
                );
              })}
            </>
          )}

          <div className="cmp-menu-title" style={{ marginTop: 2, borderTop: '0.756px solid rgba(234,88,35,0.45)' }}>
            {generationState === "FRAME" ? "VARIATIONS" : "FRAME COUNT"}
          </div>
          
          <div className="cmp-menu-counter" style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', justifyContent: 'space-between', color: '#c7c7c7', fontSize: '9px', letterSpacing: '0.12em' }}>
            <button 
              style={{ width: '24px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: '#c7c7c7' }}
              onClick={(e) => {
                e.stopPropagation();
                if (generationState === "FRAME") {
                  const v = parseInt(frameVar.toString(), 10);
                  if (v > 1) setFrameVar(v - 1);
                } else {
                  const v = parseInt(frameCount.toString(), 10);
                  if (v > 1) setFrameCount(v - 1);
                }
              }}
            >-</button>
            <span>{generationState === "FRAME" ? frameVar : frameCount} {generationState === "FRAME" ? "IMAGE" : "FRAME"}{(generationState === "FRAME" && parseInt(frameVar.toString(), 10) !== 1) || (generationState === "STAGE" && parseInt(frameCount.toString(), 10) !== 1) ? "S" : ""}</span>
            <button 
              style={{ width: '24px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: '#c7c7c7' }}
              onClick={(e) => {
                e.stopPropagation();
                if (generationState === "FRAME") {
                  const v = parseInt(frameVar.toString(), 10);
                  if (v < 10) setFrameVar(v + 1);
                } else {
                  const v = parseInt(frameCount.toString(), 10);
                  if (v < 99) setFrameCount(v + 1);
                }
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
        <div className={`btn-frame ${isGenerating ? 'cafe-loading' : ''}`} id="generateBtn" onClick={handleGenerate}>
          {generationState}
        </div>
      </div>
      
      <div className="btn-prompt-switch" data-state={generationState} id="promptSwitch" onClick={toggleState}>
        <div className="ps-track">
          <div className="ps-active"></div>
          <div className="ps-inactive"></div>
        </div>
      </div>
    </div>
  );
}





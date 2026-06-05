"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings, MODELS } from "@/context/SettingsContext";

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useApp();
  const { 
    googleApiKey, setGoogleApiKey,
    activeModelKey, setActiveModelKey,
    activeResolution, setActiveResolution,
    setThinkingLevel,
    scanTiming, setScanTiming,
    keepDescriptions, setKeepDescriptions,
    scanTimeout, setScanTimeout,
    activeModel, activeThinkingLevel, costPerImage
  } = useSettings();

  const [activePage, setActivePage] = useState<"api" | "image">("api");
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    if (settingsOpen && !googleApiKey) {
      setActivePage("api");
    }
  }, [googleApiKey, settingsOpen]);

  const handleSaveKey = () => {
    setGoogleApiKey(apiKeyInput.trim());
    setApiKeyInput("");
    const btn = document.querySelector('.csm-google-save');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Saved';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    }
  };

  if (!settingsOpen) return null;

  return (
    <div id="cafe-settings-modal" className={settingsOpen ? "open" : ""} onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className="csm-panel">
        
        <div className="csm-header">
          <span className="csm-title">Settings</span>
          <button className="csm-close" onClick={() => setSettingsOpen(false)}>&#215;</button>
        </div>

        <div className="csm-inner">
          <div className="csm-nav">
            <button className={`csm-nav-btn ${activePage === 'api' ? 'active' : ''}`} onClick={() => setActivePage('api')}>API</button>
            <button className={`csm-nav-btn ${activePage === 'image' ? 'active' : ''}`} onClick={() => setActivePage('image')}>Image</button>
          </div>

          <div className="csm-body">
            
            {/* API Page */}
            <div className={`csm-page ${activePage === 'api' ? 'active' : ''}`}>
              <div className="csm-section">
                <div className="csm-section-label">Vertex AI API Key</div>
                <div className="csm-key-row">
                  <input 
                    type="password" 
                    className="csm-google-input" 
                    placeholder={googleApiKey ? '****************' : 'Enter Vertex AI API key...'} 
                    autoComplete="new-password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                  <button type="button" className="csm-google-save" onClick={handleSaveKey}>Save</button>
                </div>
              </div>

              <div className="csm-section">
                <div className="csm-section-label">Model</div>
                <div className="csm-model-list">
                  {Object.keys(MODELS).map(key => {
                    const m = MODELS[key];
                    const isActive = key === activeModelKey;
                    const baseCost = m.costByResolution[m.defaultResolution || ''] || m.costByResolution['default'] || 0;
                    return (
                      <div key={key} className={`csm-model-row ${isActive ? 'active' : ''}`} onClick={() => setActiveModelKey(key)}>
                        <span className="csm-model-label">{m.label}</span>
                        <span className="csm-model-cost">from ${baseCost.toFixed(3)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="csm-section">
                <div className="csm-section-label">Resolution</div>
                <div className="csm-resolution-list">
                  {activeModel.resolutions.map(res => (
                    <div key={res} className={`csm-resolution-row ${res === activeResolution ? 'active' : ''}`} onClick={() => setActiveResolution(res)}>
                      {res === activeResolution && <span className="csm-resolution-check">&#10003;</span>}
                      {res}
                    </div>
                  ))}
                </div>
              </div>

              {activeModel.thinkingLevels && activeModel.thinkingLevels.length > 0 && (
                <div className="csm-section csm-thinking-section">
                  <div className="csm-section-label">Thinking</div>
                  <div className="csm-thinking-list">
                    {activeModel.thinkingLevels.map(level => (
                      <div key={level} className={`csm-resolution-row ${level === activeThinkingLevel ? 'active' : ''}`} onClick={() => setThinkingLevel(level)}>
                        {level === activeThinkingLevel && <span className="csm-resolution-check">&#10003;</span>}
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="csm-cost-display">
                <span className="csm-cost-label">Estimated Cost</span>
                <span className="csm-cost-value">${costPerImage.toFixed(3)} per image</span>
              </div>
            </div>

            {/* Image Page */}
            <div className={`csm-page ${activePage === 'image' ? 'active' : ''}`}>
              <div className="csm-section">
                <div className="csm-section-label">Vision Scan</div>

                <div className="csm-setting-row">
                  <div className="csm-setting-info">
                    <span className="csm-setting-label">Scan Timing</span>
                    <span className="csm-setting-hint">When to scan reference images</span>
                  </div>
                  <div className="csm-opts">
                    <button className={`csm-opt ${scanTiming === 'load' ? 'active' : ''}`} onClick={() => setScanTiming('load')}>On Load</button>
                    <button className={`csm-opt ${scanTiming === 'generate' ? 'active' : ''}`} onClick={() => setScanTiming('generate')}>On Generate</button>
                  </div>
                </div>

                <div className="csm-setting-row">
                  <div className="csm-setting-info">
                    <span className="csm-setting-label">Keep Descriptions</span>
                    <span className="csm-setting-hint">Reuse cached descriptions between generations</span>
                  </div>
                  <div className="csm-opts">
                    <button className={`csm-opt ${keepDescriptions ? 'active' : ''}`} onClick={() => setKeepDescriptions(true)}>On</button>
                    <button className={`csm-opt ${!keepDescriptions ? 'active' : ''}`} onClick={() => setKeepDescriptions(false)}>Off</button>
                  </div>
                </div>

                <div className="csm-setting-row">
                  <div className="csm-setting-info">
                    <span className="csm-setting-label">Scan Timeout</span>
                    <span className="csm-setting-hint">Seconds before a scan is aborted</span>
                  </div>
                  <div className="csm-timeout-row">
                    <input type="number" className="csm-timeout-input" value={scanTimeout} min="5" max="120" onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (v >= 5 && v <= 120) setScanTimeout(v);
                    }} />
                    <span className="csm-timeout-unit">s</span>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useSettings, MODELS } from "@/context/SettingsContext";

export default function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useApp();
  const { 
    googleApiKey, setGoogleApiKey,
    activeModelKey, setActiveModelKey,
    activeResolution, setActiveResolution,
    setThinkingLevel,
    activeModel, activeThinkingLevel, costPerImage
  } = useSettings();

  const [apiKeyInput, setApiKeyInput] = useState("");

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
            <button className="csm-nav-btn active">API</button>
          </div>

          <div className="csm-body">
            
            {/* API Page */}
            <div className="csm-page active">
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

          </div>
        </div>
      </div>
    </div>
  );
}

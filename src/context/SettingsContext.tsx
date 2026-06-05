"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type ModelConfig = {
  id: string;
  label: string;
  provider: string;
  aspectRatios: string[];
  resolutions: string[];
  defaultResolution: string | null;
  costByResolution: Record<string, number>;
  thinkingLevel: string | null;
  thinkingLevels?: string[];
};

export const MODELS: Record<string, ModelConfig> = {
  'google-nano-banana': {
    id: 'gemini-2.5-flash-image',
    label: 'NANO BANANA',
    provider: 'google',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: [],
    defaultResolution: null,
    costByResolution: { default: 0.039 },
    thinkingLevel: null
  },
  'google-nano-banana-2': {
    id: 'gemini-3.1-flash-image-preview',
    label: 'NANO BANANA 2',
    provider: 'google',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: ['512', '1K', '2K', '4K'],
    defaultResolution: '1K',
    costByResolution: { '512': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.150 },
    thinkingLevel: 'minimal',
    thinkingLevels: ['minimal', 'high']
  },
  'nano-banana-pro': {
    id: 'gemini-3-pro-image-preview',
    label: 'NANO BANANA PRO',
    provider: 'google',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    resolutions: ['1K', '2K', '4K'],
    defaultResolution: '1K',
    costByResolution: { '1K': 0.134, '2K': 0.134, '4K': 0.240 },
    thinkingLevel: null
  }
};

interface SettingsContextType {
  googleApiKey: string;
  setGoogleApiKey: (val: string) => void;
  activeModelKey: string;
  setActiveModelKey: (val: string) => void;
  activeResolution: string;
  setActiveResolution: (val: string) => void;
  thinkingLevel: string;
  setThinkingLevel: (val: string) => void;
  scanTiming: string;
  setScanTiming: (val: string) => void;
  keepDescriptions: boolean;
  setKeepDescriptions: (val: boolean) => void;
  scanTimeout: number;
  setScanTimeout: (val: number) => void;
  
  // Computed helpers
  activeModel: ModelConfig;
  activeThinkingLevel: string | null;
  costPerImage: number;
}

const STORAGE_KEY = 'cafehtml-settings';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [activeModelKey, setActiveModelKey] = useState("google-nano-banana");
  const [activeResolution, setActiveResolution] = useState("1K");
  const [thinkingLevel, setThinkingLevel] = useState("minimal");
  const [scanTiming, setScanTiming] = useState("generate");
  const [keepDescriptions, setKeepDescriptions] = useState(true);
  const [scanTimeout, setScanTimeout] = useState(20);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.googleApiKey) setGoogleApiKey(saved.googleApiKey);
        if (saved.activeModel && MODELS[saved.activeModel]) setActiveModelKey(saved.activeModel);
        if (saved.activeResolution) setActiveResolution(saved.activeResolution);
        if (saved.thinkingLevel) setThinkingLevel(saved.thinkingLevel);
        if (saved.scanTiming) setScanTiming(saved.scanTiming);
        if (typeof saved.keepDescriptions === 'boolean') setKeepDescriptions(saved.keepDescriptions);
        if (typeof saved.scanTimeout === 'number') setScanTimeout(saved.scanTimeout);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        googleApiKey,
        activeModel: activeModelKey,
        activeResolution,
        thinkingLevel,
        scanTiming,
        keepDescriptions,
        scanTimeout
      }));
    } catch {}
  }, [googleApiKey, activeModelKey, activeResolution, thinkingLevel, scanTiming, keepDescriptions, scanTimeout, mounted]);

  const activeModel = MODELS[activeModelKey];

  let activeThinkingLevel: string | null = null;
  if (activeModel.thinkingLevels && activeModel.thinkingLevels.length) {
    activeThinkingLevel = activeModel.thinkingLevels.includes(thinkingLevel) ? thinkingLevel : activeModel.thinkingLevels[0];
  } else {
    activeThinkingLevel = activeModel.thinkingLevel;
  }

  const costs = activeModel.costByResolution;
  const costPerImage = costs[activeResolution] || costs['default'] || (activeModel.defaultResolution && costs[activeModel.defaultResolution]) || 0;

  // Intercept setter to also update defaults when changing models
  const handleSetActiveModelKey = (key: string) => {
    const model = MODELS[key];
    if (!model) return;
    setActiveModelKey(key);
    setActiveResolution(model.defaultResolution || (model.resolutions && model.resolutions[0]) || '1K');
  };

  return (
    <SettingsContext.Provider
      value={{
        googleApiKey, setGoogleApiKey,
        activeModelKey, setActiveModelKey: handleSetActiveModelKey,
        activeResolution, setActiveResolution,
        thinkingLevel, setThinkingLevel,
        scanTiming, setScanTiming,
        keepDescriptions, setKeepDescriptions,
        scanTimeout, setScanTimeout,
        activeModel,
        activeThinkingLevel,
        costPerImage
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}


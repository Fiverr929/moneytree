"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./music-test.module.css";
import { useSettings } from "@/context/SettingsContext";
import { useApp } from "@/context/AppContext";
import {
  interpolateLiveMusicConfig,
  liveMusicConfig,
  LyriaRealtimeEngine,
  type LyriaStatus,
} from "@/lib/music/lyriaRealtime";
import {
  barDurationMs,
  clonePrompts,
  interpolatePrompts,
  millisecondsUntilNextBar,
  sceneFromState,
  type MusicScene,
  type MusicTake,
  type TakeEvent,
} from "@/lib/music/workstation";

type PromptTrack = {
  id: string;
  text: string;
  weight: number;
  muted: boolean;
  color: "orange" | "blue" | "light";
};

type ThreeWayValue = 0 | 1 | 2;
type StemName = "drums" | "bass" | "other";
type WaveBar = { id: number; height: number; tone: "light" | "blue" | "orange" };
type TransitionBars = 0 | 1 | 2 | 4;

const INITIAL_PROMPTS: PromptTrack[] = [
  { id: "hyperpop", text: "hyperpop", weight: 0.78, muted: false, color: "light" },
  { id: "guitar-riff", text: "guitar riff", weight: 0.61, muted: false, color: "blue" },
  { id: "jungle", text: "jungle", weight: 0.42, muted: false, color: "light" },
  { id: "liquid-dnb", text: "liquid dnb", weight: 0.69, muted: false, color: "blue" },
];

const DEFAULT_SCENES: MusicScene[] = [
  {
    id: "scene-origin",
    name: "ORIGIN",
    createdAt: 1,
    prompts: clonePrompts(INITIAL_PROMPTS),
    density: 1,
    brightness: 1,
    diversity: 1,
    roles: { drums: true, bass: true, other: true },
    bpm: "Auto",
    musicKey: "Auto",
  },
  {
    id: "scene-air",
    name: "AIR",
    createdAt: 2,
    prompts: [
      { id: "air-ambient", text: "ethereal ambience", weight: 1.1, muted: false },
      { id: "air-harp", text: "harp", weight: 0.52, muted: false },
      { id: "air-texture", text: "sustained chords", weight: 0.8, muted: false },
    ],
    density: 0,
    brightness: 2,
    diversity: 1,
    roles: { drums: false, bass: false, other: true },
    bpm: 90,
    musicKey: "C maj / A min",
  },
  {
    id: "scene-pressure",
    name: "PRESSURE",
    createdAt: 3,
    prompts: [
      { id: "pressure-jungle", text: "jungle", weight: 1.3, muted: false },
      { id: "pressure-bass", text: "boomy bass", weight: 0.9, muted: false },
      { id: "pressure-glitch", text: "glitchy effects", weight: 0.66, muted: false },
    ],
    density: 2,
    brightness: 1,
    diversity: 2,
    roles: { drums: true, bass: true, other: true },
    bpm: 160,
    musicKey: "D maj / B min",
  },
];

const SUGGESTIONS = [
  "indie electronic", "indian classical", "existential angst", "xylophone trap beat",
  "harp", "delta blues", "rich orchestration", "dub harmonica", "doo wop",
  "grime symphony", "funk metal", "ominous drone", "djembe", "jamaican dub",
  "ranchera", "saturated tones", "shredding guitar", "glitch hop",
  "soprano saxophone", "gamelan", "glitchy effects", "moog oscillations",
  "polka", "bagpipes", "ska", "throat singing", "hang drum", "warm acoustic guitar",
];

const KEYS = [
  "Auto",
  "C maj / A min",
  "Db maj / Bb min",
  "D maj / B min",
  "Eb maj / C min",
  "E maj / C# min",
  "F maj / D min",
  "Gb maj / Eb min",
  "G maj / E min",
  "Ab maj / F min",
  "A maj / F# min",
  "Bb maj / G min",
  "B maj / G# min",
];

function Icon({ name }: { name: "play" | "pause" | "reset" | "volume" | "mute" | "trash" | "plus" | "share" | "refresh" | "record" | "save" | "download" }) {
  const paths = {
    play: <path d="M9 6v12l10-6-10-6Z" fill="currentColor" />,
    pause: <path d="M7 6h4v12H7zm6 0h4v12h-4z" fill="currentColor" />,
    reset: <path d="M6.4 7.2A7 7 0 1 1 5 13h2.2a4.8 4.8 0 1 0 1-3L11 12H4V5l2.4 2.2Z" fill="currentColor" />,
    volume: <path d="M4 10v4h4l5 4V6L8 10H4Zm11.2-.9a4 4 0 0 1 0 5.8l1.4 1.4a6 6 0 0 0 0-8.6l-1.4 1.4Z" fill="currentColor" />,
    mute: <path d="M4 10v4h4l5 4V6L8 10H4Zm11-1 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" fill="none" />,
    trash: <path d="M7 7h10l-1 13H8L7 7Zm2-3h6l1 2H8l1-2Z" fill="currentColor" />,
    plus: <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" fill="currentColor" />,
    share: <path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.8a3 3 0 0 0 0-2.8l6.7-3.8A3 3 0 1 0 15 5c0 .1 0 .3.1.4L8.4 9.2a3 3 0 1 0 0 5.6l6.7 3.8A3 3 0 1 0 18 16Z" fill="currentColor" />,
    refresh: <path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.3L13 11h7V4l-2.3 2.3Z" fill="currentColor" />,
    record: <circle cx="12" cy="12" r="6" fill="currentColor" />,
    save: <path d="M5 4h12l2 2v14H5V4Zm3 1v5h8V5H8Zm0 9v4h8v-4H8Z" fill="currentColor" />,
    download: <path d="M11 4h2v9l3-3 1.4 1.4L12 17l-5.4-5.6L8 10l3 3V4ZM5 18h14v2H5v-2Z" fill="currentColor" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function ThreeWayControl({ label, value, onChange, icons }: {
  label: string;
  value: ThreeWayValue;
  onChange: (value: ThreeWayValue) => void;
  icons: [string, string, string];
}) {
  return (
    <div className={styles.characterControl}>
      <div className={styles.segmented}>
        {icons.map((icon, index) => (
          <button
            key={icon}
            type="button"
            className={value === index ? styles.segmentActive : ""}
            onClick={() => onChange(index as ThreeWayValue)}
            aria-label={`${label} ${["low", "auto", "high"][index]}`}
          >
            {icon}
          </button>
        ))}
      </div>
      <span>{label}</span>
    </div>
  );
}

export default function MusicTestPage() {
  const { geminiApiKey } = useSettings();
  const { setSettingsOpen } = useApp();
  const [prompts, setPrompts] = useState(INITIAL_PROMPTS);
  const [draft, setDraft] = useState("");
  const [suggestionPage, setSuggestionPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.72);
  const [density, setDensity] = useState<ThreeWayValue>(1);
  const [brightness, setBrightness] = useState<ThreeWayValue>(1);
  const [diversity, setDiversity] = useState<ThreeWayValue>(1);
  const [stems, setStems] = useState<Record<StemName, boolean>>({ drums: true, bass: true, other: true });
  const [openPanel, setOpenPanel] = useState<"bpm" | "key" | null>(null);
  const [bpm, setBpm] = useState<number | "Auto">("Auto");
  const [bpmDraft, setBpmDraft] = useState(120);
  const [musicKey, setMusicKey] = useState("Auto");
  const [musicKeyDraft, setMusicKeyDraft] = useState("Auto");
  const [toast, setToast] = useState("");
  const [lyriaError, setLyriaError] = useState("");
  const [lyriaStatus, setLyriaStatus] = useState<LyriaStatus>("stopped");
  const [waveBars, setWaveBars] = useState<WaveBar[]>([]);
  const [scenes, setScenes] = useState<MusicScene[]>(DEFAULT_SCENES);
  const [activeSceneId, setActiveSceneId] = useState("scene-origin");
  const [queuedSceneId, setQueuedSceneId] = useState<string | null>(null);
  const [transitionBars, setTransitionBars] = useState<TransitionBars>(1);
  const [transportPosition, setTransportPosition] = useState({ bar: 1, beat: 1 });
  const [recording, setRecording] = useState(false);
  const [takes, setTakes] = useState<MusicTake[]>([]);
  const waveIdRef = useRef(0);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LyriaRealtimeEngine | null>(null);
  const transportStartRef = useRef(0);
  const sceneTimerRef = useRef<number | null>(null);
  const morphTimerRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const takeStartedAtRef = useRef(0);
  const takeEventsRef = useRef<TakeEvent[]>([]);

  const recordEvent = useCallback((type: string, detail: string) => {
    if (!recordingRef.current) return;
    takeEventsRef.current.push({
      at: Math.max(0, performance.now() - takeStartedAtRef.current),
      type,
      detail,
    });
  }, []);

  const suggestions = useMemo(() => {
    const result = [];
    for (let index = 0; index < 7; index += 1) {
      result.push(SUGGESTIONS[(suggestionPage * 7 + index) % SUGGESTIONS.length]);
    }
    return result;
  }, [suggestionPage]);

  const lyriaConfig = useMemo(() => liveMusicConfig({
    bpm,
    musicKey,
    density,
    brightness,
    diversity,
    roles: stems,
  }), [bpm, brightness, density, diversity, musicKey, stems]);

  useEffect(() => {
    engineRef.current?.close();
    if (!geminiApiKey.trim()) {
      engineRef.current = null;
      setLyriaStatus("stopped");
      return;
    }
    const engine = new LyriaRealtimeEngine(geminiApiKey.trim(), {
      onStatus: (status) => {
        setLyriaStatus(status);
        if (status === "connecting" || status === "playing") setLyriaError("");
        setPlaying(status === "playing" || status === "loading" || status === "connecting");
      },
      onAudioLevel: (level) => {
        const tone: WaveBar["tone"] = waveIdRef.current % 7 === 0 ? "orange" : waveIdRef.current % 3 === 0 ? "blue" : "light";
        setWaveBars((current) => [...current, {
          id: waveIdRef.current++,
          height: Math.max(18, Math.min(96, 18 + level * 78)),
          tone,
        }].slice(-120));
      },
      onPlaybackStart: (delayMs) => {
        transportStartRef.current = performance.now() + delayMs;
        setTransportPosition({ bar: 1, beat: 1 });
      },
      onError: (message) => {
        setLyriaError(message);
        setToast(message);
      },
      onFilteredPrompt: (text, reason) => setToast(`${text} was filtered${reason ? `: ${reason}` : "."}`),
      onWarning: (message) => {
        setLyriaError(message);
        setToast(message);
      },
    });
    engineRef.current = engine;
    return () => engine.close();
  }, [geminiApiKey]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cafehtml-music-scenes-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as MusicScene[];
        if (Array.isArray(parsed) && parsed.length) setScenes(parsed);
      }
    } catch {
      // The built-in scenes remain available when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("cafehtml-music-scenes-v1", JSON.stringify(scenes));
    } catch {
      // Scenes still work for the current session.
    }
  }, [scenes]);

  useEffect(() => {
    if (!playing) return;
    const updatePosition = () => {
      if (!transportStartRef.current) return;
      const beatMs = barDurationMs(bpm) / 4;
      const elapsed = Math.max(0, performance.now() - transportStartRef.current);
      const absoluteBeat = Math.floor(elapsed / beatMs);
      setTransportPosition({ bar: Math.floor(absoluteBeat / 4) + 1, beat: (absoluteBeat % 4) + 1 });
    };
    updatePosition();
    const timer = window.setInterval(updatePosition, 80);
    return () => window.clearInterval(timer);
  }, [bpm, playing]);

  useEffect(() => () => {
    if (sceneTimerRef.current) window.clearTimeout(sceneTimerRef.current);
    if (morphTimerRef.current) window.clearInterval(morphTimerRef.current);
  }, []);

  useEffect(() => {
    void engineRef.current?.setPrompts(prompts).catch((error: unknown) => {
      setToast(error instanceof Error ? error.message : "Unable to update Lyria prompts.");
    });
  }, [prompts]);

  useEffect(() => {
    void engineRef.current?.setConfig(lyriaConfig).catch(() => setToast("Unable to update Lyria controls."));
  }, [lyriaConfig]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform) return;
    waveform.scrollTo({ left: waveform.scrollWidth, behavior: "smooth" });
  }, [waveBars]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const promptTracksForScene = useCallback((scene: MusicScene) => {
    const colors: PromptTrack["color"][] = ["orange", "blue", "light"];
    return scene.prompts.map((prompt, index) => ({
      ...prompt,
      color: prompts.find((current) => current.text === prompt.text)?.color ?? colors[index % colors.length],
    }));
  }, [prompts]);

  const finishSceneTransition = useCallback((scene: MusicScene) => {
    const hardChange = scene.bpm !== bpm || scene.musicKey !== musicKey;
    const nextPrompts = promptTracksForScene(scene);
    setPrompts(nextPrompts);
    setDensity(scene.density);
    setBrightness(scene.brightness);
    setDiversity(scene.diversity);
    setStems({ ...scene.roles });
    setBpm(scene.bpm);
    if (scene.bpm !== "Auto") setBpmDraft(scene.bpm);
    setMusicKey(scene.musicKey);
    setMusicKeyDraft(scene.musicKey);
    setActiveSceneId(scene.id);
    setQueuedSceneId(null);
    recordEvent("scene", `${scene.name} entered`);

    void engineRef.current?.setConfig(liveMusicConfig({
      bpm: scene.bpm,
      musicKey: scene.musicKey,
      density: scene.density,
      brightness: scene.brightness,
      diversity: scene.diversity,
      roles: scene.roles,
    }), hardChange).catch(() => setToast("The scene changed, but Lyria could not apply every control."));
    setToast(`${scene.name} is live.`);
  }, [bpm, musicKey, promptTracksForScene, recordEvent]);

  const beginSceneTransition = useCallback((scene: MusicScene) => {
    const target = promptTracksForScene(scene);
    const duration = playing && bpm !== "Auto" ? barDurationMs(bpm) * transitionBars : 0;
    if (!duration) {
      finishSceneTransition(scene);
      return;
    }

    const source = clonePrompts(prompts);
    const sourceControls = {
      bpm,
      musicKey,
      density,
      brightness,
      diversity,
      roles: stems,
    };
    const targetControls = {
      bpm: scene.bpm,
      musicKey: scene.musicKey,
      density: scene.density,
      brightness: scene.brightness,
      diversity: scene.diversity,
      roles: scene.roles,
    };
    const startedAt = performance.now();
    if (morphTimerRef.current) window.clearInterval(morphTimerRef.current);
    setToast(`Morphing to ${scene.name} over ${transitionBars} bar${transitionBars === 1 ? "" : "s"}.`);
    morphTimerRef.current = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      const morphed = interpolatePrompts(source, target, progress).map((prompt, index) => ({
        ...prompt,
        color: target.find((item) => item.text === prompt.text)?.color
          ?? source.find((item) => item.text === prompt.text)?.color
          ?? (["orange", "blue", "light"] as const)[index % 3],
      }));
      setPrompts(morphed);
      void engineRef.current?.setConfig(
        interpolateLiveMusicConfig(sourceControls, targetControls, progress),
      ).catch(() => setToast("The scene morph was interrupted by Lyria."));
      if (progress >= 1) {
        if (morphTimerRef.current) window.clearInterval(morphTimerRef.current);
        morphTimerRef.current = null;
        finishSceneTransition(scene);
      }
    }, 180);
  }, [
    bpm,
    brightness,
    density,
    diversity,
    finishSceneTransition,
    musicKey,
    playing,
    promptTracksForScene,
    prompts,
    stems,
    transitionBars,
  ]);

  const launchScene = (scene: MusicScene) => {
    if (sceneTimerRef.current) window.clearTimeout(sceneTimerRef.current);
    if (morphTimerRef.current) window.clearInterval(morphTimerRef.current);
    setQueuedSceneId(scene.id);
    const delay = playing && bpm !== "Auto" && transportStartRef.current
      ? millisecondsUntilNextBar(transportStartRef.current, bpm)
      : 0;
    recordEvent("scene-queued", `${scene.name}; ${transitionBars} bar transition`);
    if (!delay) {
      beginSceneTransition(scene);
      return;
    }
    setToast(`${scene.name} queued for the next bar.`);
    sceneTimerRef.current = window.setTimeout(() => beginSceneTransition(scene), delay);
  };

  const saveScene = () => {
    const name = `SCENE ${String(scenes.length + 1).padStart(2, "0")}`;
    const scene = sceneFromState(name, {
      prompts,
      density,
      brightness,
      diversity,
      roles: stems,
      bpm,
      musicKey,
    });
    setScenes((current) => [...current, scene]);
    setActiveSceneId(scene.id);
    recordEvent("scene-saved", name);
    setToast(`${name} captured.`);
  };

  const toggleTakeRecording = async () => {
    if (!recordingRef.current) {
      recordingRef.current = true;
      takeStartedAtRef.current = performance.now();
      takeEventsRef.current = [{ at: 0, type: "record", detail: "Take started" }];
      const hasAudioRecorder = engineRef.current?.startRecording() ?? false;
      setRecording(true);
      setToast(hasAudioRecorder ? "Recording audio and control gestures." : "Recording control gestures. Start Lyria to capture audio.");
      return;
    }

    recordingRef.current = false;
    const durationMs = performance.now() - takeStartedAtRef.current;
    const audio = await engineRef.current?.stopRecording() ?? null;
    const number = takes.length + 1;
    const take: MusicTake = {
      id: `take-${Date.now()}`,
      name: `TAKE ${String(number).padStart(2, "0")}`,
      startedAt: Date.now() - durationMs,
      durationMs,
      events: [...takeEventsRef.current, { at: durationMs, type: "record", detail: "Take stopped" }],
      audioUrl: audio ? URL.createObjectURL(audio) : undefined,
    };
    setTakes((current) => [take, ...current].slice(0, 6));
    setRecording(false);
    setToast(`${take.name} captured: ${take.events.length - 2} musical events.`);
  };

  const addPrompt = (text: string) => {
    const cleanText = text.trim().toLowerCase();
    if (!cleanText || prompts.some((prompt) => prompt.text === cleanText)) return;
    const colors: PromptTrack["color"][] = ["orange", "blue", "light"];
    setPrompts((current) => [
      ...current,
      {
        id: `${cleanText.replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        text: cleanText,
        weight: 0.5,
        muted: false,
        color: colors[current.length % colors.length],
      },
    ]);
    setDraft("");
    recordEvent("prompt-added", cleanText);
  };

  const submitPrompt = (event: FormEvent) => {
    event.preventDefault();
    addPrompt(draft);
  };

  const togglePlayback = () => {
    if (playing) {
      engineRef.current?.pause();
      setPlaying(false);
      transportStartRef.current = 0;
      setTransportPosition({ bar: 1, beat: 1 });
      recordEvent("transport", "Paused");
      return;
    }
    if (!geminiApiKey.trim() || !engineRef.current) {
      setToast("Add a Gemini API key in CafeHTML Settings first.");
      return;
    }
    setToast("Connecting to Lyria ...");
    setLyriaError("");
    transportStartRef.current = 0;
    recordEvent("transport", "Play");
    void engineRef.current.play()
      .catch((error: unknown) => {
        setPlaying(false);
        setToast(error instanceof Error ? error.message : "Unable to start Lyria.");
      });

  };
  const resetMix = () => {
    engineRef.current?.reset();
    setPlaying(false);
    setWaveBars([]);
    setOpenPanel(null);
    transportStartRef.current = 0;
    setTransportPosition({ bar: 1, beat: 1 });
    recordEvent("transport", "Reset");
    setToast("Mix reset. Press play for a new variation.");
  };

  const applyRestartingChange = (nextBpm: number | "Auto", nextMusicKey: string) => {
    setBpm(nextBpm);
    setMusicKey(nextMusicKey);
    void engineRef.current?.setConfig(liveMusicConfig({
      bpm: nextBpm,
      musicKey: nextMusicKey,
      density,
      brightness,
      diversity,
      roles: stems,
    }), true).catch(() => setToast("Lyria could not apply the tempo or key change."));
    setOpenPanel(null);
  };

  const shareMix = async () => {
    const mix = prompts.map((prompt) => `${prompt.text}:${Math.round(prompt.weight * 100)}%`).join(", ");
    try {
      await navigator.clipboard?.writeText(`CafeHTML DJ - ${mix}`);
      setToast("Mix copied to clipboard.");
    } catch {
      setToast("Clipboard access is unavailable.");
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.workspace} aria-label="CafeHTML generative music workstation">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>CAFEHTML / GENERATIVE MUSIC WORKSTATION</span>
          </div>
          <div className={styles.headerStatus}>
            <span className={styles.clock}>BAR {String(transportPosition.bar).padStart(2, "0")} · BEAT {transportPosition.beat}</span>
            <button
              type="button"
              className={`${styles.connection} ${playing ? styles.connectionLive : ""}`}
              onClick={() => { if (!geminiApiKey.trim()) setSettingsOpen(true); }}
            >
              <span />
              {!geminiApiKey.trim() ? "API KEY NEEDED" : lyriaStatus === "playing" ? "LYRIA LIVE" : lyriaStatus === "connecting" || lyriaStatus === "loading" ? "CONNECTING" : lyriaStatus.toUpperCase()}
            </button>
          </div>
        </header>
        {lyriaError && (
          <div className={styles.connectionError} role="alert">
            <strong>LYRIA ERROR</strong>
            <span>{lyriaError}</span>
            <button type="button" onClick={() => setSettingsOpen(true)}>CHECK API SETTINGS</button>
          </div>
        )}

        <section className={styles.sceneDeck} aria-label="Musical scenes">
          <div className={styles.sceneDeckHeader}>
            <div>
              <strong>SCENES</strong>
              <span>Launch on next bar · morph musical intent</span>
            </div>
            <div className={styles.sceneTools}>
              <label>
                <span>TRANSITION</span>
                <select value={transitionBars} onChange={(event) => setTransitionBars(Number(event.target.value) as TransitionBars)}>
                  <option value={0}>CUT</option>
                  <option value={1}>1 BAR</option>
                  <option value={2}>2 BARS</option>
                  <option value={4}>4 BARS</option>
                </select>
              </label>
              <button type="button" onClick={saveScene}><Icon name="save" /> CAPTURE SCENE</button>
              <button
                type="button"
                className={`${styles.recordButton} ${recording ? styles.recording : ""}`}
                onClick={() => void toggleTakeRecording()}
              >
                <Icon name="record" /> {recording ? "STOP TAKE" : "RECORD TAKE"}
              </button>
            </div>
          </div>
          <div className={styles.sceneGrid}>
            {scenes.map((scene, index) => (
              <article
                key={scene.id}
                className={`${styles.sceneCard} ${activeSceneId === scene.id ? styles.sceneActive : ""} ${queuedSceneId === scene.id ? styles.sceneQueued : ""}`}
              >
                <button type="button" className={styles.sceneLaunch} onClick={() => launchScene(scene)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{scene.name}</strong>
                  <small>{scene.prompts.slice(0, 2).map((prompt) => prompt.text).join(" + ")}</small>
                  <b>{queuedSceneId === scene.id ? "QUEUED" : activeSceneId === scene.id ? "LIVE" : "LAUNCH"}</b>
                </button>
                {scene.createdAt > 3 && (
                  <button
                    type="button"
                    className={styles.sceneDelete}
                    onClick={() => setScenes((current) => current.filter((item) => item.id !== scene.id))}
                    aria-label={`Delete ${scene.name}`}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className={styles.promptMixer}>
          <div className={styles.promptList}>
            {prompts.map((prompt) => (
              <article key={prompt.id} className={`${styles.promptRow} ${styles[prompt.color]} ${prompt.muted ? styles.promptMuted : ""}`}>
                <div className={styles.promptActions}>
                  <button
                    type="button"
                    onClick={() => {
                      setPrompts((current) => current.map((item) => item.id === prompt.id ? { ...item, muted: !item.muted } : item));
                      recordEvent("prompt-mute", `${prompt.text}: ${prompt.muted ? "on" : "off"}`);
                    }}
                    aria-label={`${prompt.muted ? "Unmute" : "Mute"} ${prompt.text}`}
                  >
                    <Icon name={prompt.muted ? "mute" : "volume"} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrompts((current) => current.filter((item) => item.id !== prompt.id));
                      recordEvent("prompt-removed", prompt.text);
                    }}
                    aria-label={`Delete ${prompt.text}`}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
                <span className={styles.promptName}>{prompt.text}</span>
                <label className={styles.weightControl}>
                  <span className={styles.srOnly}>{prompt.text} strength</span>
                  <input
                    type="range"
                    min="0.05"
                    max="2"
                    step="0.01"
                    value={prompt.weight}
                    onChange={(event) => {
                      const weight = Number(event.target.value);
                      setPrompts((current) => current.map((item) => item.id === prompt.id ? { ...item, weight } : item));
                    }}
                    onPointerUp={(event) => recordEvent("prompt-weight", `${prompt.text}: ${Number(event.currentTarget.value).toFixed(2)}`)}
                    style={{ "--weight": `${(prompt.weight / 2) * 100}%` } as React.CSSProperties}
                  />
                </label>
              </article>
            ))}
          </div>

          <form className={styles.promptInput} onSubmit={submitPrompt}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a prompt ..." />
            <button type="button" onClick={() => setPrompts([])} aria-label="Clear all prompts"><Icon name="trash" /></button>
            <button type="submit" disabled={!draft.trim()} aria-label="Add prompt"><Icon name="plus" /></button>
          </form>
        </section>

        <div className={styles.suggestions}>
          <button type="button" className={styles.moreChip} onClick={() => setSuggestionPage((page) => page + 1)}>
            <Icon name="refresh" /> more
          </button>
          {suggestions.map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => addPrompt(suggestion)}>{suggestion}</button>
          ))}
        </div>

        <section className={styles.console}>
          <div className={styles.characterRow}>
            <ThreeWayControl label="Density" value={density} onChange={(value) => { setDensity(value); recordEvent("density", String(value)); }} icons={["MIN", "AUTO", "MAX"]} />
            <ThreeWayControl label="Brightness" value={brightness} onChange={(value) => { setBrightness(value); recordEvent("brightness", String(value)); }} icons={["DARK", "AUTO", "BRIGHT"]} />
            <ThreeWayControl label="Diversity" value={diversity} onChange={(value) => { setDiversity(value); recordEvent("diversity", String(value)); }} icons={["LOW", "MID", "HIGH"]} />

            <div className={styles.stems} aria-label="Generation roles">
              {(Object.keys(stems) as StemName[]).map((stem) => (
                <label key={stem}>
                  <button
                    type="button"
                    className={stems[stem] ? styles.stemOn : ""}
                    onClick={() => {
                      const next = { ...stems, [stem]: !stems[stem] };
                      if (!next.drums && !next.bass && !next.other) {
                        setToast("Keep at least one generation role active.");
                        return;
                      }
                      setStems(next);
                      recordEvent("role", `${stem}: ${next[stem] ? "on" : "off"}`);
                    }}
                    aria-label={`${stems[stem] ? "Mute" : "Unmute"} ${stem === "other" ? "music" : stem}`}
                  >
                    <Icon name={stems[stem] ? "volume" : "mute"} />
                  </button>
                  <span>{stem === "other" ? "Music" : stem[0].toUpperCase() + stem.slice(1)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.transport}>
            <button
              type="button"
              className={`${styles.playButton} ${playing ? styles.playing : ""}`}
              onClick={togglePlayback}
              aria-label={playing ? "Pause music" : "Play music"}
            >
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button type="button" className={styles.roundButton} onClick={resetMix} aria-label="Reset mix"><Icon name="reset" /></button>

            <label className={styles.volumeControl}>
              <Icon name={volume === 0 ? "mute" : "volume"} />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                onPointerUp={(event) => recordEvent("volume", Number(event.currentTarget.value).toFixed(2))}
              />
            </label>

            <div ref={waveformRef} className={`${styles.waveform} ${playing ? styles.waveformPlaying : ""}`} aria-label="Live waveform">
              <div className={styles.waveformTrack}>
                {waveBars.map((bar) => (
                  <i
                    key={bar.id}
                    className={styles[`wave${bar.tone[0].toUpperCase()}${bar.tone.slice(1)}`]}
                    style={{ "--bar": `${bar.height}%` } as React.CSSProperties}
                  />
                ))}
                <span className={styles.playhead} />
              </div>
            </div>

            <div className={styles.transportMenus}>
              <div className={styles.popoverAnchor}>
                <button type="button" className={styles.valueButton} onClick={() => {
                  if (openPanel === "bpm") setOpenPanel(null);
                  else {
                    setBpmDraft(bpm === "Auto" ? 120 : bpm);
                    setOpenPanel("bpm");
                  }
                }}>
                  <span>BPM</span>{bpm !== "Auto" && <b>{bpm}</b>}
                </button>
                {openPanel === "bpm" && (
                  <div className={styles.popover}>
                    <label>BPM <strong>{bpmDraft}</strong></label>
                    <input type="range" min="60" max="200" value={bpmDraft} onChange={(event) => setBpmDraft(Number(event.target.value))} />
                    <p>Adjusting BPM during playback resets the current mix.</p>
                    <footer>
                      <button type="button" onClick={() => applyRestartingChange("Auto", musicKey)}>Reset</button>
                      <button type="button" onClick={() => applyRestartingChange(bpmDraft, musicKey)}>Apply</button>
                    </footer>
                  </div>
                )}
              </div>

              <div className={styles.popoverAnchor}>
                <button type="button" className={styles.valueButton} onClick={() => {
                  if (openPanel === "key") setOpenPanel(null);
                  else {
                    setMusicKeyDraft(musicKey);
                    setOpenPanel("key");
                  }
                }}>
                  <span>KEY</span>{musicKey !== "Auto" && <b>{musicKey.split(" ")[0]}</b>}
                </button>
                {openPanel === "key" && (
                  <div className={`${styles.popover} ${styles.keyPopover}`}>
                    <label>Key</label>
                    <select value={musicKeyDraft} onChange={(event) => setMusicKeyDraft(event.target.value)}>
                      {KEYS.map((key) => <option key={key}>{key}</option>)}
                    </select>
                    <p>Adjusting the key during playback resets the current mix.</p>
                    <footer>
                      <button type="button" onClick={() => applyRestartingChange(bpm, "Auto")}>Reset</button>
                      <button type="button" onClick={() => applyRestartingChange(bpm, musicKeyDraft)}>Apply</button>
                    </footer>
                  </div>
                )}
              </div>

              <button type="button" className={styles.shareButton} onClick={shareMix} aria-label="Copy mix"><Icon name="share" /></button>
            </div>
          </div>
        </section>

        {takes.length > 0 && (
          <section className={styles.takeShelf} aria-label="Recorded takes">
            <span className={styles.takeShelfLabel}>TAKES</span>
            {takes.map((take) => (
              <article key={take.id}>
                <div>
                  <strong>{take.name}</strong>
                  <small>{(take.durationMs / 1000).toFixed(1)}s · {Math.max(0, take.events.length - 2)} events</small>
                </div>
                {take.audioUrl ? (
                  <a href={take.audioUrl} download={`${take.name.toLowerCase().replace(" ", "-")}.webm`} aria-label={`Download ${take.name}`}>
                    <Icon name="download" />
                  </a>
                ) : <span className={styles.controlOnly}>CONTROL ONLY</span>}
              </article>
            ))}
          </section>
        )}
      </section>
      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}

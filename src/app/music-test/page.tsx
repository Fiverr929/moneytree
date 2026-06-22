"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./music-test.module.css";
import { useSettings } from "@/context/SettingsContext";
import { useApp } from "@/context/AppContext";
import {
  generationModeForDiversity,
  LYRIA_SCALE_BY_LABEL,
  LyriaRealtimeEngine,
  type LyriaStatus,
} from "@/lib/music/lyriaRealtime";

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

const INITIAL_PROMPTS: PromptTrack[] = [
  { id: "hyperpop", text: "hyperpop", weight: 0.78, muted: false, color: "light" },
  { id: "guitar-riff", text: "guitar riff", weight: 0.61, muted: false, color: "blue" },
  { id: "jungle", text: "jungle", weight: 0.42, muted: false, color: "light" },
  { id: "liquid-dnb", text: "liquid dnb", weight: 0.69, muted: false, color: "blue" },
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

function Icon({ name }: { name: "play" | "pause" | "reset" | "volume" | "mute" | "trash" | "plus" | "share" | "refresh" }) {
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
  const [toast, setToast] = useState("");
  const [lyriaStatus, setLyriaStatus] = useState<LyriaStatus>("stopped");
  const [waveBars, setWaveBars] = useState<WaveBar[]>([]);
  const waveIdRef = useRef(0);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LyriaRealtimeEngine | null>(null);

  const suggestions = useMemo(() => {
    const result = [];
    for (let index = 0; index < 7; index += 1) {
      result.push(SUGGESTIONS[(suggestionPage * 7 + index) % SUGGESTIONS.length]);
    }
    return result;
  }, [suggestionPage]);

  const lyriaConfig = useMemo(() => ({
    bpm: bpm === "Auto" ? undefined : bpm,
    scale: LYRIA_SCALE_BY_LABEL[musicKey],
    density: density === 0 ? 0.2 : density === 2 ? 0.85 : undefined,
    brightness: brightness === 0 ? 0.2 : brightness === 2 ? 0.85 : undefined,
    musicGenerationMode: generationModeForDiversity(diversity),
    muteBass: !stems.bass,
    muteDrums: !stems.drums,
    onlyBassAndDrums: !stems.other,
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
      onError: (message) => setToast(message),
      onFilteredPrompt: (text, reason) => setToast(`${text} was filtered${reason ? `: ${reason}` : "."}`),
    });
    engineRef.current = engine;
    return () => engine.close();
  }, [geminiApiKey]);

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
  };

  const submitPrompt = (event: FormEvent) => {
    event.preventDefault();
    addPrompt(draft);
  };

  const togglePlayback = () => {
    if (playing) {
      engineRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!geminiApiKey.trim() || !engineRef.current) {
      setToast("Add a Gemini API key in CafeHTML Settings first.");
      return;
    }
    setToast("Connecting to Lyria ...");
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
    setToast("Mix reset. Press play for a new variation.");
  };

  const applyRestartingChange = () => {
    void engineRef.current?.setConfig(lyriaConfig, true);
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
      <section className={styles.workspace} aria-label="CafeHTML music DJ test">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>CAFEHTML / LIVE MUSIC TEST</span>
          </div>
          <button
            type="button"
            className={`${styles.connection} ${playing ? styles.connectionLive : ""}`}
            onClick={() => { if (!geminiApiKey.trim()) setSettingsOpen(true); }}
          >
            <span />
            {!geminiApiKey.trim() ? "API KEY NEEDED" : lyriaStatus === "playing" ? "LYRIA LIVE" : lyriaStatus === "connecting" || lyriaStatus === "loading" ? "CONNECTING" : lyriaStatus.toUpperCase()}
          </button>
        </header>

        <section className={styles.promptMixer}>
          <div className={styles.promptList}>
            {prompts.map((prompt) => (
              <article key={prompt.id} className={`${styles.promptRow} ${styles[prompt.color]} ${prompt.muted ? styles.promptMuted : ""}`}>
                <div className={styles.promptActions}>
                  <button
                    type="button"
                    onClick={() => setPrompts((current) => current.map((item) => item.id === prompt.id ? { ...item, muted: !item.muted } : item))}
                    aria-label={`${prompt.muted ? "Unmute" : "Mute"} ${prompt.text}`}
                  >
                    <Icon name={prompt.muted ? "mute" : "volume"} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompts((current) => current.filter((item) => item.id !== prompt.id))}
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
            <ThreeWayControl label="Density" value={density} onChange={setDensity} icons={["MIN", "AUTO", "MAX"]} />
            <ThreeWayControl label="Brightness" value={brightness} onChange={setBrightness} icons={["DARK", "AUTO", "BRIGHT"]} />
            <ThreeWayControl label="Diversity" value={diversity} onChange={setDiversity} icons={["LOW", "MID", "HIGH"]} />

            <div className={styles.stems}>
              {(Object.keys(stems) as StemName[]).map((stem) => (
                <label key={stem}>
                  <button
                    type="button"
                    className={stems[stem] ? styles.stemOn : ""}
                    onClick={() => setStems((current) => ({ ...current, [stem]: !current[stem] }))}
                    aria-label={`${stems[stem] ? "Mute" : "Unmute"} ${stem}`}
                  >
                    <Icon name={stems[stem] ? "volume" : "mute"} />
                  </button>
                  <span>{stem[0].toUpperCase() + stem.slice(1)}</span>
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
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
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
                <button type="button" className={styles.valueButton} onClick={() => setOpenPanel(openPanel === "bpm" ? null : "bpm")}>
                  <span>BPM</span>{bpm !== "Auto" && <b>{bpm}</b>}
                </button>
                {openPanel === "bpm" && (
                  <div className={styles.popover}>
                    <label>BPM <strong>{bpm === "Auto" ? "Auto" : bpmDraft}</strong></label>
                    <input type="range" min="60" max="200" value={bpmDraft} onChange={(event) => { setBpmDraft(Number(event.target.value)); setBpm(Number(event.target.value)); }} />
                    <p>Adjusting BPM during playback resets the current mix.</p>
                    <footer>
                      <button type="button" onClick={() => { setBpm("Auto"); setOpenPanel(null); }}>Reset</button>
                      <button type="button" onClick={applyRestartingChange}>Apply</button>
                    </footer>
                  </div>
                )}
              </div>

              <div className={styles.popoverAnchor}>
                <button type="button" className={styles.valueButton} onClick={() => setOpenPanel(openPanel === "key" ? null : "key")}>
                  <span>KEY</span>{musicKey !== "Auto" && <b>{musicKey.split(" ")[0]}</b>}
                </button>
                {openPanel === "key" && (
                  <div className={`${styles.popover} ${styles.keyPopover}`}>
                    <label>Key</label>
                    <select value={musicKey} onChange={(event) => setMusicKey(event.target.value)}>
                      {KEYS.map((key) => <option key={key}>{key}</option>)}
                    </select>
                    <p>Adjusting the key during playback resets the current mix.</p>
                    <footer>
                      <button type="button" onClick={() => { setMusicKey("Auto"); setOpenPanel(null); }}>Reset</button>
                      <button type="button" onClick={applyRestartingChange}>Apply</button>
                    </footer>
                  </div>
                )}
              </div>

              <button type="button" className={styles.shareButton} onClick={shareMix} aria-label="Copy mix"><Icon name="share" /></button>
            </div>
          </div>
        </section>
      </section>
      {toast && <div className={styles.toast}>{toast}</div>}
    </main>
  );
}

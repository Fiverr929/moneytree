"use client";

import {
  GoogleGenAI,
  MusicGenerationMode,
  Scale,
  type AudioChunk,
  type LiveMusicGenerationConfig,
  type LiveMusicServerMessage,
  type LiveMusicSession,
} from "@google/genai";

export type LyriaPrompt = {
  id: string;
  text: string;
  weight: number;
  muted: boolean;
};

export type LyriaStatus = "connecting" | "loading" | "playing" | "paused" | "stopped" | "error";

export type LyriaCallbacks = {
  onStatus: (status: LyriaStatus) => void;
  onAudioLevel: (level: number) => void;
  onPlaybackStart?: (delayMs: number) => void;
  onError: (message: string) => void;
  onFilteredPrompt: (text: string, reason?: string) => void;
  onWarning?: (message: string) => void;
};

export const LYRIA_SCALE_BY_LABEL: Record<string, Scale> = {
  Auto: Scale.SCALE_UNSPECIFIED,
  "C maj / A min": Scale.C_MAJOR_A_MINOR,
  "Db maj / Bb min": Scale.D_FLAT_MAJOR_B_FLAT_MINOR,
  "D maj / B min": Scale.D_MAJOR_B_MINOR,
  "Eb maj / C min": Scale.E_FLAT_MAJOR_C_MINOR,
  "E maj / C# min": Scale.E_MAJOR_D_FLAT_MINOR,
  "F maj / D min": Scale.F_MAJOR_D_MINOR,
  "Gb maj / Eb min": Scale.G_FLAT_MAJOR_E_FLAT_MINOR,
  "G maj / E min": Scale.G_MAJOR_E_MINOR,
  "Ab maj / F min": Scale.A_FLAT_MAJOR_F_MINOR,
  "A maj / F# min": Scale.A_MAJOR_G_FLAT_MINOR,
  "Bb maj / G min": Scale.B_FLAT_MAJOR_G_MINOR,
  "B maj / G# min": Scale.B_MAJOR_A_FLAT_MINOR,
};

export function diversityConfig(value: 0 | 1 | 2) {
  if (value === 0) {
    return {
      musicGenerationMode: MusicGenerationMode.QUALITY,
      temperature: 0.7,
      topK: 24,
      guidance: 4.8,
    };
  }
  if (value === 2) {
    return {
      musicGenerationMode: MusicGenerationMode.DIVERSITY,
      temperature: 1.6,
      topK: 80,
      guidance: 3.2,
    };
  }
  return {
    musicGenerationMode: MusicGenerationMode.QUALITY,
    temperature: 1.1,
    topK: 40,
    guidance: 4,
  };
}

export type LiveMusicControlState = {
  bpm: number | "Auto";
  musicKey: string;
  density: 0 | 1 | 2;
  brightness: 0 | 1 | 2;
  diversity: 0 | 1 | 2;
  roles: { drums: boolean; bass: boolean; other: boolean };
};

export function liveMusicConfig({
  bpm,
  musicKey,
  density,
  brightness,
  diversity,
  roles,
}: LiveMusicControlState): LiveMusicGenerationConfig {
  return {
    ...diversityConfig(diversity),
    bpm: bpm === "Auto" ? undefined : bpm,
    scale: LYRIA_SCALE_BY_LABEL[musicKey],
    density: density === 0 ? 0.2 : density === 2 ? 0.85 : undefined,
    brightness: brightness === 0 ? 0.2 : brightness === 2 ? 0.85 : undefined,
    muteBass: !roles.bass,
    muteDrums: !roles.drums,
    onlyBassAndDrums: !roles.other && (roles.bass || roles.drums),
  };
}

function characterValue(value: 0 | 1 | 2) {
  return value === 0 ? 0.2 : value === 2 ? 0.85 : 0.5;
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

export function interpolateLiveMusicConfig(
  from: LiveMusicControlState,
  to: LiveMusicControlState,
  progress: number,
): LiveMusicGenerationConfig {
  const amount = Math.max(0, Math.min(1, progress));
  const fromDiversity = diversityConfig(from.diversity);
  const toDiversity = diversityConfig(to.diversity);
  const roles = amount < 0.65 ? from.roles : to.roles;

  return {
    bpm: from.bpm === "Auto" ? undefined : from.bpm,
    scale: LYRIA_SCALE_BY_LABEL[from.musicKey],
    density: lerp(characterValue(from.density), characterValue(to.density), amount),
    brightness: lerp(characterValue(from.brightness), characterValue(to.brightness), amount),
    temperature: lerp(fromDiversity.temperature, toDiversity.temperature, amount),
    topK: Math.round(lerp(fromDiversity.topK, toDiversity.topK, amount)),
    guidance: lerp(fromDiversity.guidance, toDiversity.guidance, amount),
    musicGenerationMode: amount < 0.5
      ? fromDiversity.musicGenerationMode
      : toDiversity.musicGenerationMode,
    muteBass: !roles.bass,
    muteDrums: !roles.drums,
    onlyBassAndDrums: !roles.other && (roles.bass || roles.drums),
  };
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodePcm16(
  data: Uint8Array,
  context: AudioContext,
  sampleRate = 48000,
  channelCount = 2,
) {
  const sampleCount = Math.floor(data.byteLength / 2 / channelCount);
  const audioBuffer = context.createBuffer(channelCount, sampleCount, sampleRate);
  const samples = new Int16Array(data.buffer, data.byteOffset, sampleCount * channelCount);
  let energy = 0;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const output = audioBuffer.getChannelData(channel);
    for (let index = 0; index < sampleCount; index += 1) {
      const value = samples[index * channelCount + channel] / 32768;
      output[index] = value;
      energy += value * value;
    }
  }

  const rms = Math.sqrt(energy / Math.max(1, sampleCount * channelCount));
  return { audioBuffer, level: Math.min(1, rms * 4.5) };
}

export class LyriaRealtimeEngine {
  private readonly client: GoogleGenAI;
  private readonly callbacks: LyriaCallbacks;
  private readonly context: AudioContext;
  private readonly analyser: AnalyserNode;
  private session: LiveMusicSession | null = null;
  private sessionPromise: Promise<LiveMusicSession> | null = null;
  private output: GainNode;
  private readonly recordingOutput: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private nextStartTime = 0;
  private readonly bufferSeconds = 1.25;
  private prompts: LyriaPrompt[] = [];
  private config: LiveMusicGenerationConfig = {};
  private stopped = true;
  private analyserTimer: number | null = null;
  private firstAudioTimer: number | null = null;
  private playbackAnchored = false;
  private readonly scheduledSources = new Set<AudioBufferSourceNode>();

  constructor(apiKey: string, callbacks: LyriaCallbacks) {
    this.client = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    this.callbacks = callbacks;
    this.context = new AudioContext({ sampleRate: 48000 });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.output = this.context.createGain();
    this.recordingOutput = this.context.createMediaStreamDestination();
    this.analyser.connect(this.output);
    this.output.connect(this.context.destination);
    this.output.connect(this.recordingOutput);
  }

  private async connect() {
    this.callbacks.onStatus("connecting");
    let resolveSetup: () => void = () => {};
    const setupReady = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    const connection = this.client.live.music.connect({
      model: "models/lyria-realtime-exp",
      callbacks: {
        onmessage: (message: LiveMusicServerMessage) => {
          if (message.setupComplete) resolveSetup();
          const warning = (message as LiveMusicServerMessage & { warning?: string }).warning;
          if (warning) this.callbacks.onWarning?.(warning);
          if (message.filteredPrompt?.text) {
            this.callbacks.onFilteredPrompt(message.filteredPrompt.text, message.filteredPrompt.filteredReason);
          }
          if (message.serverContent?.audioChunks?.length) {
            void this.processAudioChunks(message.serverContent.audioChunks);
          }
        },
        onerror: (event) => this.fail(event.message || "Lyria connection error."),
        onclose: (event) => {
          const detail = event.reason || (event.code ? `code ${event.code}` : "no reason provided");
          if (!this.stopped) this.fail(`Lyria connection closed (${detail}).`);
        },
      },
    });
    const session = await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Lyria connection timed out. Check API key and model access.")),
          15000,
        );
      }),
    ]);
    this.session = session;
    try {
      await Promise.race([
        setupReady,
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("Lyria opened a connection but did not finish setup.")),
            10000,
          );
        }),
      ]);
    } catch (error) {
      session.close();
      this.session = null;
      throw error;
    }
    return session;
  }

  private getSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = this.connect().catch((error: unknown) => {
        this.sessionPromise = null;
        this.fail(error instanceof Error ? error.message : "Unable to connect to Lyria.");
        throw error;
      });
    }
    return this.sessionPromise;
  }

  private fail(message: string) {
    const session = this.session;
    this.session = null;
    this.sessionPromise = null;
    this.callbacks.onStatus("error");
    this.callbacks.onError(message);
    this.stopped = true;
    this.clearScheduledAudio();
    this.clearFirstAudioTimeout();
    this.stopAnalyserLoop();
    session?.close();
  }

  private async processAudioChunks(chunks: AudioChunk[]) {
    if (this.stopped) return;
    for (const chunk of chunks) {
      if (!chunk.data) continue;
      this.clearFirstAudioTimeout();
      const { audioBuffer } = decodePcm16(decodeBase64(chunk.data), this.context);
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser);
      this.scheduledSources.add(source);
      source.onended = () => {
        this.scheduledSources.delete(source);
        source.disconnect();
      };

      if (this.nextStartTime === 0 || this.nextStartTime < this.context.currentTime) {
        this.nextStartTime = this.context.currentTime + this.bufferSeconds;
        this.callbacks.onStatus("loading");
      }

      if (!this.playbackAnchored) {
        this.playbackAnchored = true;
        this.callbacks.onPlaybackStart?.(
          Math.max(0, (this.nextStartTime - this.context.currentTime) * 1000),
        );
      }
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      if (this.nextStartTime - this.context.currentTime >= this.bufferSeconds) {
        this.callbacks.onStatus("playing");
      }
    }
  }

  private activePrompts(prompts = this.prompts) {
    return prompts
      .filter((prompt) => !prompt.muted && prompt.weight > 0)
      .map((prompt) => ({ text: prompt.text, weight: prompt.weight }));
  }

  async setPrompts(prompts: LyriaPrompt[]) {
    this.prompts = prompts;
    if (!this.session) return;
    const weightedPrompts = this.activePrompts();
    if (!weightedPrompts.length) throw new Error("At least one prompt must be active.");
    await this.session.setWeightedPrompts({ weightedPrompts });
  }

  async setConfig(config: LiveMusicGenerationConfig, resetContext = false) {
    this.config = config;
    if (!this.session) return;
    await this.session.setMusicGenerationConfig({ musicGenerationConfig: this.config });
    if (resetContext) {
      this.clearScheduledAudio();
      this.playbackAnchored = false;
      this.session.resetContext();
      if (!this.stopped) {
        this.callbacks.onStatus("loading");
        this.startFirstAudioTimeout();
      }
    }
  }

  setVolume(volume: number) {
    this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.06);
  }

  startRecording() {
    if (this.recorder?.state === "recording") return true;
    if (typeof MediaRecorder === "undefined") return false;
    this.recordedChunks = [];
    this.recorder = new MediaRecorder(this.recordingOutput.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.recordedChunks.push(event.data);
    };
    this.recorder.start(500);
    return true;
  }

  stopRecording() {
    return new Promise<Blob | null>((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = this.recordedChunks.length
          ? new Blob(this.recordedChunks, { type: recorder.mimeType || "audio/webm" })
          : null;
        this.recorder = null;
        this.recordedChunks = [];
        resolve(blob);
      };
      recorder.stop();
    });
  }

  private startAnalyserLoop() {
    if (this.analyserTimer) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    
    this.analyserTimer = window.setInterval(() => {
      if (this.stopped || this.context.state !== "running") return;
      
      this.analyser.getByteTimeDomainData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      // scale up level for better visibility, clamp to 1
      const level = Math.min(1, rms * 5.0);
      
      this.callbacks.onAudioLevel(level);
    }, 90);
  }

  private stopAnalyserLoop() {
    if (this.analyserTimer) {
      window.clearInterval(this.analyserTimer);
      this.analyserTimer = null;
    }
  }

  private clearFirstAudioTimeout() {
    if (this.firstAudioTimer) {
      window.clearTimeout(this.firstAudioTimer);
      this.firstAudioTimer = null;
    }
  }

  private startFirstAudioTimeout() {
    this.clearFirstAudioTimeout();
    this.firstAudioTimer = window.setTimeout(() => {
      this.fail("Lyria connected, but no audio arrived. Check model access, billing, and regional availability.");
    }, 15000);
  }

  private clearScheduledAudio() {
    for (const source of this.scheduledSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that already ended needs no further cleanup.
      }
      source.disconnect();
    }
    this.scheduledSources.clear();
    this.nextStartTime = 0;
  }

  async play() {
    const weightedPrompts = this.activePrompts();
    if (!weightedPrompts.length) throw new Error("At least one prompt must be active.");
    this.stopped = false;
    this.startAnalyserLoop();
    this.callbacks.onStatus("loading");
    await this.context.resume();
    const session = await this.getSession();
    await session.setWeightedPrompts({ weightedPrompts });
    await session.setMusicGenerationConfig({ musicGenerationConfig: this.config });
    session.play();
    this.playbackAnchored = false;
    this.startFirstAudioTimeout();
  }

  pause() {
    this.stopped = true;
    this.session?.pause();
    this.callbacks.onStatus("paused");
    this.clearScheduledAudio();
    this.playbackAnchored = false;
    this.clearFirstAudioTimeout();
    this.stopAnalyserLoop();
  }

  stop() {
    this.stopped = true;
    this.session?.stop();
    this.callbacks.onStatus("stopped");
    this.clearScheduledAudio();
    this.playbackAnchored = false;
    this.clearFirstAudioTimeout();
    this.stopAnalyserLoop();
  }

  reset() {
    this.stop();
  }

  close() {
    this.stopped = true;
    this.stopAnalyserLoop();
    this.clearFirstAudioTimeout();
    this.session?.close();
    this.session = null;
    this.sessionPromise = null;
    this.clearScheduledAudio();
    this.playbackAnchored = false;
    if (this.recorder?.state === "recording") this.recorder.stop();
    void this.context.close();
  }
}

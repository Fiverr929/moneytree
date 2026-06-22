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
  onError: (message: string) => void;
  onFilteredPrompt: (text: string, reason?: string) => void;
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

export function generationModeForDiversity(value: 0 | 1 | 2) {
  return value === 2 ? MusicGenerationMode.DIVERSITY : MusicGenerationMode.QUALITY;
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
  private nextStartTime = 0;
  private readonly bufferSeconds = 1.25;
  private prompts: LyriaPrompt[] = [];
  private config: LiveMusicGenerationConfig = {};
  private stopped = true;
  private analyserTimer: any = null;

  constructor(apiKey: string, callbacks: LyriaCallbacks) {
    this.client = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    this.callbacks = callbacks;
    this.context = new AudioContext({ sampleRate: 48000 });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.output = this.context.createGain();
    this.analyser.connect(this.output);
    this.output.connect(this.context.destination);
  }

  private async connect() {
    this.callbacks.onStatus("connecting");
    const connection = this.client.live.music.connect({
      model: "models/lyria-realtime-exp",
      callbacks: {
        onmessage: (message: LiveMusicServerMessage) => {
          if (message.filteredPrompt?.text) {
            this.callbacks.onFilteredPrompt(message.filteredPrompt.text, message.filteredPrompt.filteredReason);
          }
          if (message.serverContent?.audioChunks?.length) {
            void this.processAudioChunks(message.serverContent.audioChunks);
          }
        },
        onerror: () => this.fail("Lyria connection error."),
        onclose: () => {
          if (!this.stopped) this.fail("Lyria connection closed.");
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
    this.callbacks.onStatus("error");
    this.callbacks.onError(message);
    this.stopped = true;
    this.nextStartTime = 0;
    this.stopAnalyserLoop();
  }

  private async processAudioChunks(chunks: AudioChunk[]) {
    if (this.stopped) return;
    for (const chunk of chunks) {
      if (!chunk.data) continue;
      const { audioBuffer } = decodePcm16(decodeBase64(chunk.data), this.context);
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.analyser);

      if (this.nextStartTime === 0 || this.nextStartTime < this.context.currentTime) {
        this.nextStartTime = this.context.currentTime + this.bufferSeconds;
        this.callbacks.onStatus("loading");
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
    if (resetContext) this.session.resetContext();
  }

  setVolume(volume: number) {
    this.output.gain.setTargetAtTime(volume, this.context.currentTime, 0.06);
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
  }

  pause() {
    this.session?.pause();
    this.callbacks.onStatus("paused");
    this.nextStartTime = 0;
    this.stopAnalyserLoop();
  }

  stop() {
    this.stopped = true;
    this.session?.stop();
    this.callbacks.onStatus("stopped");
    this.nextStartTime = 0;
    this.stopAnalyserLoop();
  }

  reset() {
    this.stop();
  }

  close() {
    this.stopped = true;
    this.stopAnalyserLoop();
    this.session?.close();
    this.session = null;
    this.sessionPromise = null;
    this.nextStartTime = 0;
    void this.context.close();
  }
}

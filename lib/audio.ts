import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import { db } from "./db";
import { now, uid, type Config } from "./model";
interface NativeAudio {
  accessibilitySettings(): Promise<{ textScale: number; voiceOver: boolean }>;
  recordingPath(options: { path: string }): Promise<{ path: string; repaired: boolean }>;
  prepare(options: {
    brightness: number;
    recognition: boolean;
  }): Promise<{ onDeviceSpeech: boolean; brightness: number; testInput?: boolean }>;
  beginListening(options: { context: string }): Promise<void>;
  stopListening(): Promise<void>;
  startTrial(options: {
    trialId: string;
  }): Promise<{ path: string; brightness?: number }>;
  beginAnswer(options: { recognize: boolean }): Promise<void>;
  stopAnswer(): Promise<{ path: string; transcript: string }>;
  stopTrial(): Promise<{ path: string; brightness?: number }>;
  speak(options: { text: string }): Promise<void>;
  beep(): Promise<void>;
  shareExport(options: { base64: string; filename: string }): Promise<void>;
  restore(): Promise<void>;
  addListener(
    name: string,
    callback: (data: {
      text?: string;
      message?: string;
      textScale?: number;
      voiceOver?: boolean;
      isFinal?: boolean;
    }) => void,
  ): Promise<PluginListenerHandle>;
}
export const NativeRecorder = registerPlugin<NativeAudio>("MLPTAudio");
export const isNative = () => Capacitor.getPlatform() === "ios";
const voiceUrl = process.env.NEXT_PUBLIC_VOICE_URL || "http://127.0.0.1:3001";
const pickMime = () =>
  ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
export async function nativeFile(path: string, onRepair?: () => void): Promise<Blob> {
  if (isNative()) {
    const resolved = await NativeRecorder.recordingPath({ path });
    path = resolved.path;
    if (resolved.repaired) onRepair?.();
  }
  const response = await fetch(Capacitor.convertFileSrc(path));
  // Capacitor serves media through a non-HTTP URLResponse, whose status is 0.
  if (!response.ok && response.status !== 0)
    throw new Error("Unable to read the native recording.");
  const bytes = await response.arrayBuffer();
  const header = new TextDecoder().decode(bytes.slice(0, 12));
  if (bytes.byteLength < 44 || !header.startsWith("RIFF") || header.slice(8) !== "WAVE")
    throw new Error("The native recording is not a readable WAV file.");
  return new Blob([bytes], { type: "audio/wav" });
}
const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read audio."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
        resultIndex: number;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
function speechConstructor() {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}
export class TrialAudio {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  answerRecorder?: MediaRecorder;
  answerChunks: Blob[] = [];
  recognition?: Recognition;
  ctx?: AudioContext;
  pending: Promise<unknown>[] = [];
  listeners: PluginListenerHandle[] = [];
  sequence = 0;
  trialId = "";
  nativePath = "";
  actualBrightness: number | null = null;
  transcript = "";
  active = false;
  testInput = false;
  commandsAvailable = false;
  onText?: (text: string, isFinal?: boolean) => void;
  listeningWanted = false;
  constructor(
    public config: Config,
    private onProblem: (message: string) => void,
  ) {}
  async prepare() {
    if (this.config.speechProvider === "gateway") {
      const r = await fetch(`${voiceUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok || !(await r.json()).configured)
        throw new Error(
          "The AI Gateway voice server is not configured. Set up the voice server or choose device speech in Configuration.",
        );
    }
    if (isNative()) {
      const info = await NativeRecorder.prepare({
        brightness: this.config.brightness,
        recognition: true,
      });
      this.actualBrightness = info.brightness;
      this.testInput = !!info.testInput;
      this.commandsAvailable = !!info.onDeviceSpeech || this.testInput;
      this.listeners.push(
        await NativeRecorder.addListener("transcript", (d) => {
          this.transcript = d.text || "";
          this.onText?.(this.transcript, d.isFinal);
        }),
      );
      this.listeners.push(
        await NativeRecorder.addListener("speechError", (d) =>
          this.onProblem(
            `Speech recognition: ${d.message || "unavailable"}. Use the answer field or retry.`,
          ),
        ),
      );
      this.listeners.push(
        await NativeRecorder.addListener("interrupted", (d) =>
          this.onProblem(d.message || "Audio recording was interrupted."),
        ),
      );
      return info.testInput ? "Whisper on Mac · simulator audio fixtures" : this.config.speechProvider === "gateway" ? "AI Gateway" : info.onDeviceSpeech ? "Apple on-device speech" : "Audio recording · manual answers";
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error(
        "Microphone recording is unavailable. Use the iPad app or a supported browser on localhost or HTTPS.",
      );
    this.commandsAvailable = !!speechConstructor();
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    this.stream.getAudioTracks().forEach((t) =>
      t.addEventListener("ended", () => {
        if (this.active) this.onProblem("Microphone access ended.");
      }),
    );
    return this.config.speechProvider === "gateway"
      ? "AI Gateway"
      : this.commandsAvailable ? "Browser speech recognition" : "Audio recording · manual answers";
  }
  async start(trialId: string) {
    this.trialId = trialId;
    this.sequence = 0;
    this.pending = [];
    this.active = true;
    if (isNative()) {
      const result = await NativeRecorder.startTrial({ trialId });
      this.nativePath = result.path;
      this.actualBrightness = result.brightness ?? this.actualBrightness;
      return result.path;
    }
    if (!this.stream) throw new Error("Microphone is not ready.");
    const mimeType = pickMime();
    this.recorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined,
    );
    this.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const sequence = this.sequence++;
      const saved = db.media.add({
        id: uid(),
        trialId,
        sequence,
        at: now(),
        blob: e.data,
        kind: "audio",
      });
      this.pending.push(saved);
      saved.catch(() =>
        this.onProblem("Audio could not be saved. Check device storage."),
      );
    };
    this.recorder.onerror = () => this.onProblem("Audio recording failed.");
    this.recorder.start(1000);
    return undefined;
  }
  async listen(context: string, onText: (text: string, isFinal?: boolean) => void) {
    await this.stopListening();
    this.onText = onText;
    this.listeningWanted = true;
    this.transcript = "";
    if (isNative()) {
      await NativeRecorder.beginListening({ context });
      return;
    }
    this.startBrowserRecognition(onText);
  }
  async stopListening() {
    this.listeningWanted = false;
    this.onText = undefined;
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.abort();
      this.recognition = undefined;
    }
    if (isNative()) await NativeRecorder.stopListening();
  }
  startBrowserRecognition(onText: (text: string, isFinal?: boolean) => void) {
    const Ctor = speechConstructor();
    if (!Ctor) throw new Error("Speech recognition is unavailable in this browser.");
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      this.transcript = Array.from(event.results).map(r => r[0].transcript).join(" ").trim();
      onText(this.transcript, event.results[event.results.length - 1]?.isFinal);
    };
    recognition.onerror = event => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      this.listeningWanted = false;
      this.onProblem(`Speech recognition: ${event.error}. Touch controls are available.`);
    };
    recognition.onend = () => {
      if (this.listeningWanted && this.recognition === recognition)
        setTimeout(() => { if (this.listeningWanted && this.recognition === recognition) this.startBrowserRecognition(onText); }, 300);
    };
    recognition.start();
  }
  async beginAnswer(onText: (text: string, isFinal?: boolean) => void) {
    this.transcript = "";
    if (isNative()) {
      this.onText = onText;
      await NativeRecorder.beginAnswer({
        recognize: this.config.speechProvider === "device",
      });
      return;
    }
    if (this.config.speechProvider === "gateway") {
      if (!this.stream) throw new Error("Microphone is not ready.");
      this.answerChunks = [];
      const mimeType = pickMime();
      this.answerRecorder = new MediaRecorder(
        this.stream,
        mimeType ? { mimeType } : undefined,
      );
      this.answerRecorder.ondataavailable = (e) => {
        if (e.data.size) this.answerChunks.push(e.data);
      };
      this.answerRecorder.start();
      return;
    }
    this.listeningWanted = true;
    this.startBrowserRecognition(onText);
  }
  async stopAnswer(transcribe = true) {
    this.listeningWanted = false;
    let blob: Blob | undefined;
    if (isNative()) {
      const answer = await NativeRecorder.stopAnswer();
      if (this.config.speechProvider === "gateway" && transcribe)
        blob = await nativeFile(answer.path);
      else this.transcript = answer.transcript || this.transcript;
    } else if (this.answerRecorder) {
      const recorder = this.answerRecorder;
      if (recorder.state !== "inactive")
        await new Promise<void>((resolve, reject) => {
          recorder.onstop = () => resolve();
          recorder.onerror = () =>
            reject(new Error("Answer recording failed."));
          recorder.stop();
        });
      blob = new Blob(this.answerChunks, { type: recorder.mimeType });
      this.answerRecorder = undefined;
    }
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.abort();
      this.recognition = undefined;
    }
    if (blob && transcribe) {
      const r = await fetch(`${voiceUrl}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify({
          audio: await base64(blob),
          mediaType: blob.type,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      this.transcript = String(data.text || "").slice(0, 500);
    }
    return this.transcript;
  }
  async stop() {
    await this.stopListening();
    this.active = false;
    if (this.recognition) {
      this.recognition.onerror = null;
      this.recognition.abort();
      this.recognition = undefined;
    }
    if (this.answerRecorder?.state === "recording") this.answerRecorder.stop();
    this.answerRecorder = undefined;
    if (isNative()) {
      const { path } = await NativeRecorder.stopTrial();
      if (path && this.trialId) {
        const blob = await nativeFile(path);
        await db.media.put({
          id: `native-${this.trialId}`,
          trialId: this.trialId,
          sequence: 0,
          at: now(),
          blob,
          kind: "audio",
          nativeFinalized: true,
        });
      }
      return;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      const rec = this.recorder;
      await new Promise<void>((resolve, reject) => {
        rec.onstop = () => resolve();
        rec.onerror = () =>
          reject(new Error("Audio recording could not be finalized."));
        rec.stop();
      });
    }
    await Promise.all(this.pending);
    this.recorder = undefined;
  }
  async say(text: string) {
    await this.stopListening();
    if (!this.config.guidance) return;
    if (isNative()) {
      await Promise.race([
        NativeRecorder.speak({ text }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Spoken guidance timed out.")),
            20000,
          ),
        ),
      ]);
      // Keep the speaker's final syllable out of the next recognition request.
      await new Promise(resolve => setTimeout(resolve, 250));
      return;
    }
    if (!("speechSynthesis" in window))
      throw new Error("Spoken guidance is unavailable.");
    speechSynthesis.cancel();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        speechSynthesis.cancel();
        reject(new Error("Spoken guidance timed out."));
      }, 20000);
      const s = new SpeechSynthesisUtterance(text);
      s.lang = "en-US";
      s.rate = 0.95;
      s.onend = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = (e) => {
        clearTimeout(timer);
        e.error === "canceled"
          ? resolve()
          : reject(new Error("Spoken guidance failed."));
      };
      speechSynthesis.speak(s);
    });
  }
  beep() {
    if (isNative()) {
      void NativeRecorder.beep().catch(() =>
        this.onProblem("The trial tone could not play."),
      );
      return;
    }
    if (!this.ctx) this.ctx = new AudioContext();
    void this.ctx.resume();
    const o = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    o.frequency.value = 660;
    gain.gain.value = 0.08;
    o.connect(gain);
    gain.connect(this.ctx.destination);
    o.start();
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.14);
    o.stop(this.ctx.currentTime + 0.16);
  }
  async dispose() {
    await this.stopListening();
    this.active = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.recognition?.abort();
    await Promise.all(this.listeners.map((l) => l.remove()));
    this.listeners = [];
    await this.ctx?.close();
    if (isNative()) await NativeRecorder.restore();
    else if ("speechSynthesis" in window) speechSynthesis.cancel();
  }
}

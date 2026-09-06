"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mic,
  Volume2,
  Square,
  RotateCcw,
  Keyboard,
  Settings2,
  History,
  MicOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  db,
  getConfig,
  logEvent,
  recoverInterruptedSessions,
  saveTrial,
} from "@/lib/db";
import { TrialAudio, isNative, nativeFile } from "@/lib/audio";
import {
  DEFAULT_CONFIG,
  now,
  uid,
  createTrial,
  geometryFor,
  confirmTrial,
  type Config,
  type Session,
  type Trial,
  type Touch,
} from "@/lib/model";
import { voiceAction, voicePrompt, type VoiceContext } from "@/lib/voice";
import { targetMarkup, overlaySvg } from "@/lib/stimulus";
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
export default function Training() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG),
    [ready, setReady] = useState(false),
    [screen, setScreen] = useState<
      "preflight" | "running" | "complete" | "interrupted"
    >("preflight");
  const [trial, setTrial] = useState<Trial>(),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [recording, setRecording] = useState(false),
    [listening, setListening] = useState(false),
    [completed, setCompleted] = useState(0),
    [correct, setCorrect] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false),
    [manual, setManual] = useState(false),
    [ending, setEnding] = useState(false),
    [testInput, setTestInput] = useState(false);
  const voiceEnabledRef = useRef(false), endingRef = useRef(false),
    screenRef = useRef("preflight"), autoVoiceAttempted = useRef(false),
    voiceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    voiceEpoch = useRef(0), speechLabel = useRef("");
  const sessionRef = useRef<Session | undefined>(undefined),
    trialRef = useRef<Trial | undefined>(undefined),
    audio = useRef<TrialAudio | undefined>(undefined),
    area = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const busyRef = useRef(false),
    touchBuffer = useRef<Touch[]>([]),
    touchWrites = useRef<Promise<void>>(Promise.resolve()),
    startClock = useRef(0),
    answerRef = useRef(""),
    edited = useRef(false),
    alive = useRef(true);
  const interruptRef = useRef<(reason: string) => Promise<void>>(
      async () => {},
    ),
    primaryRef = useRef<() => void>(() => {}),
    pointerStart = useRef(
      new Map<number, { at: number; x: number; y: number }>(),
    ),
    taps = useRef<number[]>([]);
  function update(t: Trial) {
    trialRef.current = t;
    setTrial(t);
  }
  function setWords(value: string) {
    answerRef.current = value;
    setAnswer(value);
  }
  async function flushTouches() {
    const batch = touchBuffer.current.splice(0);
    if (!batch.length) return touchWrites.current;
    touchWrites.current = touchWrites.current.then(async () => {
      await db.touches.bulkAdd(batch);
    });
    return touchWrites.current;
  }
  function goScreen(value: "preflight" | "running" | "complete" | "interrupted") {
    screenRef.current = value;
    setScreen(value);
  }
  function currentContext(): VoiceContext | null {
    if (endingRef.current) return "ending";
    if (screenRef.current === "preflight") return "ready";
    const phase = trialRef.current?.phase;
    if (screenRef.current === "running" && phase && ["exploring", "answering", "confirming", "feedback"].includes(phase)) return phase as VoiceContext;
    return null;
  }
  function guidance(context: VoiceContext, index = trialRef.current?.index || 0, answer = answerRef.current, last = !!config.trials && index >= config.trials) {
    return voicePrompt(context, index, answer, last, voiceEnabledRef.current && (context !== "answering" || config.speechProvider === "device"));
  }
  async function stopVoice() {
    voiceEpoch.current++;
    clearTimeout(voiceTimer.current);
    setListening(false);
    await audio.current?.stopListening();
  }
  async function listenCurrent() {
    const context = currentContext();
    if (!context || !audio.current || !voiceEnabledRef.current || !alive.current || busyRef.current) return;
    const epoch = ++voiceEpoch.current;
    const receive = (text: string, final = false) => {
      if (!alive.current || busyRef.current || epoch !== voiceEpoch.current || !text.trim()) return;
      clearTimeout(voiceTimer.current);
      if (context === "answering" && !edited.current) setWords(text.trim().replace(/[.!?]+$/, ""));
      voiceTimer.current = setTimeout(() => {
        if (busyRef.current || epoch !== voiceEpoch.current || context !== currentContext()) return;
        const action = voiceAction(context, text);
        if (sessionRef.current) void logEvent(sessionRef.current.id, "voice_input", trialRef.current?.id, { text, action, context, testInput: audio.current?.testInput });
        if (action === "repeat") { void repeat(); return; }
        if (action === "end") { endingRef.current ? void endConfirmed() : void requestEnd(); return; }
        if (action === "cancel") { void cancelEnd(); return; }
        if (action === "start") { void startSession(); return; }
        if (action === "finish") { void finishExploring(); return; }
        if (action === "confirm") { void confirm(); return; }
        if (action === "change") { void changeAnswer(); return; }
        if (action === "next") { void advance(); return; }
        if (context === "answering" && !edited.current) { void reviewAnswer(); return; }
        // Final free speech is retained in the trial audio, but never scored.
        if (final) void listenCurrent();
      }, final ? 350 : 1400);
    };
    try {
      if (context === "answering") await audio.current.beginAnswer(receive);
      else await audio.current.listen(context, receive);
      if (epoch === voiceEpoch.current) setListening(true);
    } catch (e) { voiceProblem(e instanceof Error ? e.message : "Recognition unavailable"); }
  }
  function voiceProblem(message: string) {
    const wasEnabled = voiceEnabledRef.current;
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    setListening(false);
    setManual(true);
    clearTimeout(voiceTimer.current);
    setError("Voice recognition is unavailable. You can use the large buttons below.");
    const t = trialRef.current;
    if (t) void logEvent(t.sessionId, "speech_recognition_error", t.id, { message });
    if (wasEnabled && !busyRef.current) void audio.current?.say("Voice recognition is unavailable. Please use the large buttons, or ask someone to help.");
  }
  async function prepareAudio() {
    if (audio.current) return;
    const next = new TrialAudio({ ...config, guidance: true }, message => {
      if (message.startsWith("Speech recognition:")) voiceProblem(message);
      else if (screenRef.current === "running") void interruptRef.current(message);
      else voiceProblem(message);
    });
    audio.current = next;
    try {
      speechLabel.current = await next.prepare();
      setTestInput(next.testInput);
      voiceEnabledRef.current = next.commandsAvailable;
      setVoiceEnabled(next.commandsAvailable);
      if (!next.commandsAvailable) {
        setManual(true);
        setError("Voice recognition is unavailable here. Spoken prompts, buttons, and typed answers are available.");
      }
    } catch (error) {
      await next.dispose().catch(() => {});
      audio.current = undefined;
      throw error;
    }
  }
  async function enableVoice() {
    await run(async () => {
      if (audio.current && !audio.current.active && !audio.current.commandsAvailable) {
        await audio.current.dispose();
        audio.current = undefined;
      }
      await prepareAudio();
      voiceEnabledRef.current = !!audio.current?.commandsAvailable;
      setVoiceEnabled(voiceEnabledRef.current);
      const context = currentContext();
      if (context === "answering") await audio.current?.stopAnswer(false).catch(() => {});
      if (context) await speak(guidance(context));
    });
  }
  async function repeat() {
    await run(async () => {
      if (currentContext() === "answering") {
        await audio.current?.stopAnswer(false).catch(() => {});
        setWords(""); edited.current = false;
      }
      const context = currentContext();
      if (context) await speak(guidance(context));
    });
  }
  async function requestEnd() {
    await run(async () => {
      if (currentContext() === "answering") await audio.current?.stopAnswer(false).catch(() => {});
      endingRef.current = true; setEnding(true);
      await speak(guidance("ending"));
    });
  }
  async function cancelEnd() {
    await run(async () => {
      endingRef.current = false; setEnding(false);
      const context = currentContext();
      if (context) await speak(guidance(context));
    });
  }
  async function endConfirmed() {
    await run(async () => {
      endingRef.current = false; setEnding(false);
      await finishSession(trialRef.current?.phase !== "feedback", "participant_ended_session");
    });
  }
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await stopVoice();
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The action could not be completed. Please try again.",
      );
    } finally {
      busyRef.current = false;
      if (alive.current) { setBusy(false); await listenCurrent(); }
    }
  }
  async function speak(text: string) {
    setListening(false);
    setStatus(text);
    try {
      await audio.current?.say(text);
    } catch {
      setError(
        "Spoken guidance could not play. Use Repeat guidance or your screen reader.",
      );
      if (sessionRef.current)
        await logEvent(
          sessionRef.current.id,
          "guidance_error",
          trialRef.current?.id,
        );
    }
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const initialize = async () => {
      if (cancelled) return;
      try {
        if (isNative()) {
          const trials = await db.trials
            .filter((t) => !!t.nativeAudioPath && t.phase !== "feedback")
            .toArray();
          for (const t of trials) {
            try {
              if ((await db.media.get(`native-${t.id}`))?.nativeFinalized) continue;
              // Reimport interrupted native files so an old, unfinalized cached
              // WAV can be replaced by the recovered copy after an app update.
              let repaired = false;
              const blob = await nativeFile(t.nativeAudioPath!, () => { repaired = true; });
              await db.media.put({
                  id: `native-${t.id}`,
                  trialId: t.id,
                  sequence: 0,
                  at: now(),
                  kind: "audio",
                  nativeFinalized: true,
                  blob,
                });
              if (repaired && !t.flags.includes("native_audio_header_recovered"))
                await db.trials.update(t.id, { flags: [...t.flags, "native_audio_header_recovered"] });
            } catch {
              await db.trials.update(t.id, {
                flags: [...t.flags, "native_audio_recovery_failed"],
              });
            }
          }
        }
        await recoverInterruptedSessions();
        const c = await getConfig();
        if (!cancelled) {
          setConfig(c);
          setReady(true);
        }
      } catch {
        setError(
          "The local database is unavailable. Check storage before beginning.",
        );
      }
    };
    const lockAbort = new AbortController();
    let releaseLock: (() => void) | undefined;
    const lockTimeout = setTimeout(() => lockAbort.abort(), 1500);
    if (navigator.locks) {
      void navigator.locks.request("mlpt-active-training", { signal: lockAbort.signal }, async () => {
        clearTimeout(lockTimeout);
        if (cancelled) return;
        await new Promise<void>(resolve => {
          releaseLock = resolve;
          void initialize();
        });
      }).catch(() => {
        if (!cancelled) setError("Training is open in another tab. Close that session first.");
      });
    } else {
      clearTimeout(lockTimeout);
      setError("Use the iPad app or a current browser to record a session.");
    }
    return () => {
      cancelled = true;
      alive.current = false;
      voiceEpoch.current++;
      clearTimeout(voiceTimer.current);
      clearTimeout(lockTimeout);
      lockAbort.abort();
      releaseLock?.();
      const previousAudio = audio.current;
      void previousAudio?.stop().catch(() => {}).finally(() => previousAudio.dispose());
    };
  }, []);
  useEffect(() => {
    if (ready && isNative() && !autoVoiceAttempted.current) {
      autoVoiceAttempted.current = true;
      void enableVoice();
    }
  }, [ready]);
  useEffect(() => {
    if (trial?.phase !== "preparing") heading.current?.focus({ preventScroll: true });
  }, [trial?.phase, screen, ending]);
  useEffect(() => {
    if (screen !== "running") return;
    const timer = setInterval(
      () =>
        void flushTouches().catch(() => {
          void interruptRef.current("Touch data could not be saved.");
        }),
      250,
    );
    const onHidden = () => {
      if (document.hidden)
        void interruptRef.current("The app left the foreground.");
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        primaryRef.current();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("keydown", onKey);
    };
  }, [screen]);
  useEffect(() => {
    const element = area.current;
    if (!element || !trial?.geometry || trial.phase === "preparing") return;
    const g = trial.geometry;
    const observer = new ResizeObserver(() => {
      if (trialRef.current?.phase === "feedback") return;
      const r = element.getBoundingClientRect();
      if (Math.abs(r.width - g.width) > 2 || Math.abs(r.height - g.height) > 2)
        void interruptRef.current(
          "The experimental area changed size or orientation.",
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [trial?.id, trial?.geometry, trial?.phase]);
  async function beginTrial(s: Session, index: number) {
    await logEvent(s.id, "randomization_requested");
    const t = createTrial(s, index);
    if (audio.current!.testInput) t.flags.push("simulator_audio_fixture");
    await saveTrial(t, "target_generated", t.randomization);
    update(t);
    setWords("");
    edited.current = false;
    setListening(false);
    taps.current = [];
    pointerStart.current.clear();
    goScreen("running");
    await frame();
    await frame();
    if (!area.current) throw new Error("The experimental area is not ready.");
    const r = area.current.getBoundingClientRect();
    t.geometry = geometryFor(
      t,
      r.width,
      r.height,
      window.devicePixelRatio,
      screenOrientation(),
    );
    t.nativeAudioPath = await audio.current!.start(t.id);
    t.actualBrightness = audio.current!.actualBrightness;
    setRecording(true);
    await saveTrial(t, "audio_recording_started", {
      nativeAudioPath: t.nativeAudioPath,
    });
    t.phase = "exploring";
    startClock.current = performance.now();
    update({ ...t });
    await frame();
    t.presentedAt = now();
    t.startedAt = t.presentedAt;
    const targetElement = area.current?.querySelector("svg")?.firstElementChild;
    if (targetElement && area.current) {
      const bounds = targetElement.getBoundingClientRect();
      const areaBounds = area.current.getBoundingClientRect();
      t.geometry.renderedBounds = {
        x: bounds.left - areaBounds.left,
        y: bounds.top - areaBounds.top,
        width: bounds.width,
        height: bounds.height,
        source: "DOM rendered fill bounds; stroke width recorded separately",
      };
    }
    await saveTrial(t, "stimulus_presented", {
      geometry: t.geometry,
      brightness: t.actualBrightness,
    });
    update({ ...t });
    audio.current!.beep();
    if (audio.current!.testInput) {
      await logEvent(s.id, "simulator_audio_fixture_session", t.id);
    }
    await speak(guidance("exploring", index));
  }
  async function startSession() {
    await run(async () => {
      await prepareAudio();
      const a = audio.current!;
      try {
        if (!alive.current) throw new Error("Session start was cancelled.");
        const speech = speechLabel.current;
        const storage = await navigator.storage?.estimate();
        if (
          storage?.quota &&
          storage.usage !== undefined &&
          storage.quota - storage.usage < 25 * 1024 * 1024
        )
          throw new Error(
            "Less than 25 MB of local storage remains. Export and free space before recording.",
          );
        await navigator.storage?.persist?.();
        const s: Session = {
          id: uid(),
          participantId: a.testInput ? "VOICE-TEST" : config.participantId,
          mode: "training",
          task: "standard",
          status: "active",
          startedAt: now(),
          config: { ...structuredClone(config), guidance: true, participantId: a.testInput ? "VOICE-TEST" : config.participantId },
          device: {
            userAgent: navigator.userAgent,
            platform: isNative() ? "ios-capacitor" : "web",
            speech,
            audioInput: a.testInput ? "synthetic-audio-fixtures" : "microphone",
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            dpr: devicePixelRatio,
            brightness: a.actualBrightness,
          },
        };
        sessionRef.current = s;
        await db.sessions.add(s);
        await logEvent(s.id, "session_started", undefined, {
          config: s.config,
          device: s.device,
        });
        await beginTrial(s, 1);
      } catch (e) {
        await a.stop().catch(() => {});
        await a.dispose().catch(() => {});
        if (sessionRef.current) {
          await db.sessions.update(sessionRef.current.id, {
            status: "interrupted",
            endedAt: now(),
          });
          goScreen("interrupted");
        }
        throw e;
      }
    });
  }
  async function finishExploring() {
    await run(async () => {
      const t = trialRef.current;
      if (!t || t.phase !== "exploring") return;
      await flushTouches();
      const next = { ...t, phase: "answering" as const };
      update(next);
      await saveTrial(next, "final_response_requested");
      audio.current!.beep();
      await speak(guidance("answering"));
      await logEvent(t.sessionId, "final_answer_capture_started", t.id, {
        provider: config.speechProvider,
      });
    });
  }
  async function reviewAnswer() {
    await run(async () => {
      const t = trialRef.current;
      if (!t || t.phase !== "answering") return;
      const responseAt = now();
      let text = answerRef.current;
      try {
        const recognized = await audio.current!.stopAnswer();
        if (!edited.current) text = recognized || text;
      } catch (e) {
        if (!text.trim()) throw e;
        await logEvent(
          t.sessionId,
          "transcription_failed_manual_response",
          t.id,
        );
      }
      setListening(false);
      if (!text.trim())
        throw new Error(
          "No answer was recognized. Record again or enter your answer.",
        );
      setWords(text);
      const next = {
        ...t,
        phase: "confirming" as const,
        draft: text,
        responseAt,
      };
      update(next);
      await saveTrial(next, "response_review_requested", {
        draft: text,
        source: edited.current ? "manual" : audio.current?.testInput ? "simulator-whisper" : config.speechProvider,
      });
      await speak(guidance("confirming", t.index, text));
    });
  }
  async function changeAnswer() {
    await run(async () => {
      const t = trialRef.current;
      if (!t) return;
      await audio.current!.stopAnswer(false).catch(() => {});
      setListening(false);
      setWords("");
      edited.current = false;
      const next = {
        ...t,
        phase: "answering" as const,
        draft: undefined,
        responseAt: undefined,
      };
      update(next);
      await saveTrial(next, "response_correction_requested");
      await speak(guidance("answering"));
    });
  }
  async function confirm() {
    await run(async () => {
      const t = trialRef.current;
      if (!t) return;
      let next = confirmTrial(t, answerRef.current);
      await saveTrial(next, "response_confirmed", {
        response: next.response,
        confirmedAt: next.confirmedAt,
      });
      update(next);
      try {
        await audio.current!.stop();
        await logEvent(t.sessionId, "audio_recording_stopped", t.id);
      } catch {
        next = { ...next, flags: [...next.flags, "audio_finalize_failed"] };
        setError(
          "The response is saved, but the audio could not be finalized. The trial is flagged for review.",
        );
        await saveTrial(next, "audio_finalize_error");
        update(next);
      }
      setRecording(false);
      await flushTouches();
      const touches = await db.touches.where("trialId").equals(t.id).toArray();
      await db.media.put({
        id: `overlay-${t.id}`,
        trialId: t.id,
        sequence: 0,
        at: now(),
        kind: "overlay",
        blob: new Blob([overlaySvg(next, touches)], { type: "image/svg+xml" }),
      });
      await logEvent(t.sessionId, "trial_ended", t.id);
      setCompleted((c) => c + 1);
      if (next.correct) setCorrect((c) => c + 1);
      await logEvent(t.sessionId, "feedback_presented", t.id, {
        target: next.target,
      });
      await speak(
        `The target was ${next.target}. ${next.correct ? "Your answer matched." : "Your answer was " + next.response + "."} ${guidance("feedback", t.index)}`,
      );
    });
  }
  async function advance() {
    await run(async () => {
      const s = sessionRef.current,
        t = trialRef.current;
      if (!s || !t || t.phase !== "feedback") return;
      if (config.trials && t.index >= config.trials) {
        await finishSession(false);
        return;
      }
      await beginTrial(s, t.index + 1);
    });
  }
  async function finishSession(interrupted: boolean, reason?: string) {
    const s = sessionRef.current;
    if (!s) return;
    const t = trialRef.current;
    if (t && t.phase !== "feedback") {
      try {
        await audio.current?.stop();
      } catch {
        setError("Audio could not be finalized. Saved chunks are retained.");
      }
      const next = {
        ...t,
        phase: "interrupted" as const,
        endedAt: now(),
        flags: [...t.flags, reason || "participant_ended_trial"],
      };
      await saveTrial(next, "trial_interrupted", { reason });
      update(next);
    }
    await flushTouches().catch(() => {});
    await db.sessions.update(s.id, {
      status: interrupted ? "interrupted" : "completed",
      endedAt: now(),
    });
    await logEvent(s.id, "session_ended", t?.id, { reason });
    setRecording(false);
    setListening(false);
    goScreen(interrupted ? "interrupted" : "complete");
    await speak(
      interrupted
        ? "The session has stopped. Saved data are available in session history."
        : "Session complete. Your results are saved on this device.",
    );
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    await audio.current?.dispose();
    audio.current = undefined;
  }
  interruptRef.current = async (reason) => {
    if (!sessionRef.current || screen !== "running") return;
    if (busyRef.current) {
      setTimeout(() => void interruptRef.current(reason), 150);
      return;
    }
    await run(async () => {
      setError(reason);
      await finishSession(true, reason);
    });
  };
  primaryRef.current = () => {
    if (busyRef.current) return;
    switch (trialRef.current?.phase) {
      case "exploring":
        void finishExploring();
        break;
      case "answering":
        void reviewAnswer();
        break;
      case "confirming":
        void confirm();
        break;
      case "feedback":
        void advance();
        break;
    }
  };
  function recordTouch(
    e: React.PointerEvent<HTMLDivElement>,
    type: Touch["type"],
  ) {
    const t = trialRef.current;
    if (
      !t?.geometry ||
      !["exploring", "answering", "confirming"].includes(t.phase)
    )
      return;
    const r = e.currentTarget.getBoundingClientRect();
    const native = e.nativeEvent;
    const coalesced =
      type === "MOVE" && native.getCoalescedEvents
        ? native.getCoalescedEvents()
        : [];
    const events = coalesced.length ? coalesced : [native];
    for (const sample of events)
      touchBuffer.current.push({
        id: uid(),
        trialId: t.id,
        at: new Date(performance.timeOrigin + sample.timeStamp).toISOString(),
        elapsedMs: sample.timeStamp - startClock.current,
        type,
        x: sample.clientX - r.left,
        y: sample.clientY - r.top,
        pointerId: sample.pointerId,
        pointerType: sample.pointerType,
        pressure:
          sample.pointerType === "pen" || sample.pressure !== 0.5
            ? sample.pressure
            : null,
        contactWidth: sample.width > 1 ? sample.width : null,
        contactHeight: sample.height > 1 ? sample.height : null,
      });
    if (type === "DOWN") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerStart.current.set(e.pointerId, {
        at: performance.now(),
        x: e.clientX,
        y: e.clientY,
      });
    }
    if (type === "UP") {
      const start = pointerStart.current.get(e.pointerId);
      pointerStart.current.delete(e.pointerId);
      if (
        t.phase === "exploring" &&
        config.tripleTap &&
        start &&
        performance.now() - start.at < 250 &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) < 20
      ) {
        const time = performance.now();
        taps.current = [...taps.current.filter((n) => time - n < 900), time];
        if (taps.current.length === 3) {
          taps.current = [];
          void finishExploring();
        }
      }
    }
  }
  function returnHome() {
    sessionRef.current = undefined;
    trialRef.current = undefined;
    setTrial(undefined);
    setCompleted(0); setCorrect(0); setWords(""); setError(""); setManual(false);
    goScreen("preflight");
    if (isNative()) void enableVoice();
  }
  const phase = trial?.phase;
  const last = !!config.trials && !!trial && trial.index >= config.trials;
  const context = currentContext();
  const voiceHint = busy ? "Speaking…" : listening ? "Listening" : "Touch controls ready";
  const micStatus = <div className={`voice-state ${listening ? "is-listening" : ""}`} role="status" aria-live="off">
    {listening ? <Mic size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
    <span>{voiceHint}</span>
    {listening && <span className="listening-dots" aria-hidden="true"><i/><i/><i/></span>}
  </div>;
  if (screen === "preflight") return (
    <main id="main" className="participant-home">
      <header className="participant-brand">MLPT <span>Participant</span></header>
      <section className="ready-content" aria-labelledby="ready-title">
        <div className="voice-orb" aria-hidden="true"><Mic size={44}/></div>
        <h1 id="ready-title" ref={heading} tabIndex={-1}>Ready when you are.</h1>
        <p className="ready-instruction">{voiceEnabled ? <>Say <strong>“Start session”</strong></> : "Start a session at your own pace."}</p>
        {micStatus}
        <Button className="participant-primary" disabled={!ready || busy} onClick={startSession}>Start session <ArrowRight aria-hidden="true"/></Button>
        {!voiceEnabled && <Button className="participant-link" disabled={!ready || busy} onClick={enableVoice}><Mic aria-hidden="true"/>Enable voice controls</Button>}
        <p className="session-preview">{config.trials ? `${config.trials} trials` : "Open-ended"} · {config.category} · saved settings</p>
        {error && <p className="participant-error" role="alert">{error}</p>}
        {testInput && <p className="test-badge">Simulator test · synthetic audio · local Whisper</p>}
      </section>
      <footer className="participant-nav" aria-label="Session tools">
        <Link href="/settings/"><Settings2 aria-hidden="true"/>Session setup</Link>
        <Link href="/sessions/"><History aria-hidden="true"/>Session history</Link>
        <Link href="/guide/"><Volume2 aria-hidden="true"/>Help</Link>
      </footer>
    </main>
  );
  if (screen === "complete" || screen === "interrupted") return (
    <main id="main" className="participant-summary">
      <section className="summary-card">
        <span className="summary-check" aria-hidden="true"><Check size={30}/></span>
        <h1 ref={heading} tabIndex={-1}>{screen === "complete" ? "Session complete" : "Session stopped"}</h1>
        <p>Your session is saved on this device.</p>
        <div className="summary-stats">
          <div><span>Trials completed</span><strong>{completed}</strong></div>
          <div><span>Exact matches</span><strong>{completed ? Math.round(correct/completed*100) + "%" : "—"}</strong></div>
        </div>
        {screen === "interrupted" && <p>Unconfirmed answers are kept for review and are not scored.</p>}
        {error && <p role="alert" className="participant-error">{error}</p>}
        <Button className="participant-primary" onClick={returnHome}>Done</Button>
        <Link className="summary-review" href="/sessions/">Review session</Link>
      </section>
    </main>
  );
  return (
    <main className={`participant-trial ${phase === "feedback" ? "is-feedback" : ""}`}>
      <a className="skip-link" href="#trial-controls">Skip to trial controls</a>
      <header className="participant-trial-header">
        <span>Trial {trial?.index}{config.trials ? ` / ${config.trials}` : ""}</span>
        <span className="trial-recording">{recording && <i aria-hidden="true"/>}{recording ? "REC" : "Saved"}</span>
        <Button className="participant-link" aria-label="End session" disabled={busy} onClick={requestEnd}><Square size={17} aria-hidden="true"/>End session</Button>
      </header>
      <div ref={area} className={`participant-target ${phase === "feedback" && trial?.category === "shapes" ? "feedback-shape" : ""}`}
        style={{ background: config.backgroundColor, height: trial?.geometry?.height }}
        role="group" aria-label="Touch exploration area"
        onPointerDown={e => recordTouch(e,"DOWN")} onPointerMove={e => recordTouch(e,"MOVE")}
        onPointerUp={e => recordTouch(e,"UP")} onPointerCancel={e => recordTouch(e,"CANCEL")}>
        {trial?.geometry && phase !== "preparing" && <svg aria-hidden="true" focusable="false"
          viewBox={`0 0 ${trial.geometry.width} ${trial.geometry.height}`} preserveAspectRatio="none"
          dangerouslySetInnerHTML={{ __html: targetMarkup(trial) }}/>}
      </div>
      <section id="trial-controls" className="voice-dock" aria-labelledby="phase-title">
        <h1 id="phase-title" ref={heading} tabIndex={-1}>
          {ending ? "End this session?" : phase === "feedback" ? trial?.target : phase === "confirming" ? `You said “${answer}”. Correct?` : phase === "answering" ? "What is your answer?" : "Explore freely"}
        </h1>
        <p className="voice-instruction">{!voiceEnabled ? (phase === "answering" ? "Type your answer below." : "Use the buttons below to continue.") : ending ? "Say yes to end, or no to keep going." : phase === "exploring" ? "Say “Finish trial” when you’re ready." : phase === "answering" ? "Say or spell your answer. We’ll read it back." : phase === "confirming" ? "Say “Yes” or “Change”." : phase === "feedback" ? (last ? "Say “Finish session” when you’re ready." : "Say “Next trial” when you’re ready.") : "Preparing…"}</p>
        {micStatus}
        <div className="participant-actions">
          {ending ? <><Button className="participant-primary" disabled={busy} onClick={endConfirmed}>Yes, end session</Button><Button className="participant-secondary" disabled={busy} onClick={cancelEnd}>Keep going</Button></>
            : phase === "exploring" ? <Button className="participant-primary" disabled={busy} onClick={finishExploring}>Finish trial</Button>
            : phase === "answering" ? <Button className="participant-primary" disabled={busy || (!answer.trim() && config.speechProvider !== "gateway")} onClick={reviewAnswer}>Use this answer</Button>
            : phase === "confirming" ? <><Button className="participant-primary" disabled={busy} onClick={confirm}><Check aria-hidden="true"/>Yes</Button><Button className="participant-secondary" disabled={busy} onClick={changeAnswer}>Change</Button></>
            : <Button className="participant-primary" disabled={busy} onClick={advance}>{last ? "Finish session" : "Next trial"}<ArrowRight aria-hidden="true"/></Button>}
        </div>
        <div className="participant-small-actions">
          <Button className="participant-link" disabled={busy} onClick={repeat}><Volume2 aria-hidden="true"/>Repeat</Button>
          {!voiceEnabled && <Button className="participant-link" disabled={busy} onClick={enableVoice}><Mic aria-hidden="true"/>Retry voice</Button>}
          {phase === "answering" && <Button className="participant-link" disabled={busy} onClick={() => setManual(!manual)}><Keyboard aria-hidden="true"/>Type an answer</Button>}
        </div>
        {phase === "answering" && manual && <label className="manual-answer">Your answer<input value={answer} maxLength={500} autoComplete="off" autoCorrect="off" spellCheck={false}
          onFocus={() => { edited.current = true; void stopVoice(); }} onChange={e => { edited.current = true; setWords(e.target.value); }}/></label>}
        {error && <p className="participant-error" role="alert">{error}</p>}
        <p className="sr-only" role="status" aria-live={voiceEnabled ? "off" : "polite"}>{status}</p>
      </section>
    </main>
  );
}
function screenOrientation() {
  return (
    window.screen.orientation?.type ||
    (window.innerWidth > window.innerHeight ? "landscape" : "portrait")
  );
}

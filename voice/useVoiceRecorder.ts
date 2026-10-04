// Record speech and turn it into text — works in the Android app (WebView) and every modern browser.
// Tap → mic permission → recording with a live level meter (so you can see it hears you)
// → stop → transcription on our server (Whisper) → text.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDevicePermission } from "../calls/media";

export type RecorderState = "idle" | "starting" | "recording" | "transcribing" | "error";
const MAX_MS = 180_000;

function pickMime(): string {
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MR.isTypeSupported(t)) return t;
  return "";
}

export function useVoiceRecorder({ supabase, apiBaseUrl, onText }: { supabase: SupabaseClient; apiBaseUrl: string; onText: (text: string) => void }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0); // 0..1, live mic level
  const [heard, setHeard] = useState(false); // voice detected at least once
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    try {
      rec.current?.stop();
    } catch {}
    teardown();
  }, [teardown]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        const r = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/transcribe`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "audio/webm", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: blob,
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.text) throw new Error(d.error || "Couldn't turn that into text. Please try again.");
        setState("idle");
        onTextRef.current(d.text);
      } catch (e: any) {
        setError(e?.message?.startsWith("Failed to fetch") ? "No connection. Check your internet and try again." : e.message);
        setState("error");
      }
    },
    [supabase, apiBaseUrl]
  );

  const start = useCallback(async () => {
    if (state === "recording" || state === "starting" || state === "transcribing") return;
    setError(null);
    setHeard(false);
    setElapsed(0);
    setState("starting");
    cancelled.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !(window as any).MediaRecorder) throw new Error("This device can't record audio here. Please type instead.");
      if (!(await ensureDevicePermission(false))) throw new Error("Allow the microphone for NetworQ in your phone settings, then try again.");
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch((e) => {
        throw new Error(e?.name === "NotAllowedError" ? "Microphone is blocked. Allow it for NetworQ and try again." : e?.name === "NotFoundError" ? "No microphone found on this device." : "Couldn't start the microphone. Please try again.");
      });
      stream.current = s;

      // live level meter + "we can hear you" detection
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const c: AudioContext = new AC();
        ctx.current = c;
        const an = c.createAnalyser();
        an.fftSize = 512;
        c.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += ((buf[i] - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / buf.length);
          const lv = Math.min(1, rms * 6);
          setLevel(lv);
          if (lv > 0.12) setHeard(true);
          const ms = Date.now() - startedAt.current;
          setElapsed(ms);
          if (ms > MAX_MS) rec.current?.state === "recording" && rec.current.stop();
          raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      } catch {
        setHeard(true); // no meter available — don't nag
      }

      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        teardown();
        if (cancelled.current) return setState("idle");
        const blob = new Blob(chunks.current, { type: (r.mimeType || mime || "audio/webm").split(";")[0] });
        if (blob.size < 1500) {
          setError("We didn't catch anything. Tap the mic and speak for a few seconds.");
          return setState("error");
        }
        transcribe(blob);
      };
      rec.current = r;
      startedAt.current = Date.now();
      r.start(1000);
      setState("recording");
    } catch (e: any) {
      teardown();
      setError(e.message);
      setState("error");
    }
  }, [state, teardown, transcribe]);

  const stop = useCallback(() => {
    if (rec.current?.state === "recording") rec.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (rec.current?.state === "recording") rec.current.stop();
    else teardown();
    setState("idle");
  }, [teardown]);

  return { state, error, level, heard, elapsed, start, stop, cancel, clearError: () => (setError(null), setState("idle")) };
}

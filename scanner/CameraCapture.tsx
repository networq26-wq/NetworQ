import React, { useEffect, useRef, useState } from "react";

// Full-screen, iOS-style card camera: live viewfinder, card-shaped guide with corner
// brackets, and a classic white shutter (ring + disc) that shrinks while pressed.
// If the browser can't stream the camera (permission denied / unsupported), it offers
// the phone's own camera app via `onFallback` instead of failing silently.

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

export function CameraCapture({
  open,
  onClose,
  onCapture,
  onFallback,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    if (!open) {
      stop();
      setReady(false);
      return;
    }
    setError("");
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't show a live camera.");
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        v.onloadedmetadata = () => v.play().then(() => setReady(true)).catch(() => setReady(true));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err?.name === "NotAllowedError"
            ? "Camera access is off. Allow it in your phone's settings, or use the phone camera instead."
            : "Couldn't start the camera."
        );
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [open]);

  if (!open) return null;

  const snap = () => {
    const v = videoRef.current;
    if (!v || !ready) return;
    vibrate(15);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `card_${Date.now()}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92
    );
  };

  const corner = (pos: React.CSSProperties, borders: React.CSSProperties) => (
    <span style={{ position: "absolute", width: 28, height: 28, borderColor: "#FFFFFF", borderStyle: "solid", borderWidth: 0, ...pos, ...borders }} />
  );

  return (
    <div role="dialog" aria-label="Card camera" style={{ position: "fixed", inset: 0, zIndex: 99999, background: "#000", display: "flex", flexDirection: "column", color: "#FFF" }}>
      {/* Top bar */}
      <div style={{ padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
        <button
          onClick={onClose}
          aria-label="Close camera"
          style={{ width: 36, height: 36, borderRadius: 18, border: "none", background: "rgba(255,255,255,0.16)", color: "#FFF", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          ✕
        </button>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Scan card</div>
        <div style={{ width: 36 }} />
      </div>

      {/* Viewfinder */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", gap: 16 }}>
            <div style={{ fontSize: 15, lineHeight: 1.45, color: "rgba(255,255,255,0.85)", maxWidth: 300 }}>{error}</div>
            <button
              onClick={() => {
                onClose();
                onFallback();
              }}
              style={{ padding: "12px 22px", borderRadius: 999, border: "none", background: "#FFFFFF", color: "#000", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
            >
              Use phone camera
            </button>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            {/* Card guide: business-card ratio (≈1.75:1) with dimmed surroundings */}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ position: "relative", width: "min(86%, 520px)", aspectRatio: "1.75 / 1", borderRadius: 16, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}>
                {corner({ top: 0, left: 0 }, { borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 })}
                {corner({ top: 0, right: 0 }, { borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 })}
                {corner({ bottom: 0, left: 0 }, { borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 })}
                {corner({ bottom: 0, right: 0 }, { borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 })}
              </div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, textAlign: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 13, fontWeight: 500, background: "rgba(0,0,0,0.5)", padding: "6px 14px", borderRadius: 999 }}>
                {ready ? "Fit the card inside the frame" : "Starting camera…"}
              </span>
            </div>
          </>
        )}
        {flash && <div style={{ position: "absolute", inset: 0, background: "#FFF", opacity: 0.85, pointerEvents: "none" }} />}
      </div>

      {/* Shutter bar */}
      <div style={{ padding: "22px 0 calc(env(safe-area-inset-bottom, 0px) + 26px)", display: "flex", justifyContent: "center", background: "#000" }}>
        <button
          onClick={snap}
          disabled={!ready || !!error}
          aria-label="Take photo"
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          style={{
            width: 78,
            height: 78,
            borderRadius: "50%",
            border: "4px solid #FFFFFF",
            background: "transparent",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: ready ? "pointer" : "default",
            opacity: ready && !error ? 1 : 0.4,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span
            style={{
              width: 62,
              height: 62,
              borderRadius: "50%",
              background: "#FFFFFF",
              transform: pressed ? "scale(0.86)" : "scale(1)",
              transition: "transform 120ms ease",
            }}
          />
        </button>
      </div>
    </div>
  );
}

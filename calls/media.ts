// Microphone / camera access that also works inside the Android app shell:
// the shell must hold the Android runtime permission before the WebView can use the device.

let seq = 0;
const waiting = new Map<number, (granted: boolean) => void>();

if (typeof window !== "undefined") {
  (window as any).__networqPermResult = (r: { id: number; granted: boolean }) => {
    waiting.get(r.id)?.(!!r.granted);
    waiting.delete(r.id);
  };
}

/** Ask the Android shell (if any) for mic (+ camera). Resolves true in a normal browser. */
export function ensureDevicePermission(video: boolean): Promise<boolean> {
  const rn = typeof window !== "undefined" ? (window as any).ReactNativeWebView : null;
  if (!rn?.postMessage) return Promise.resolve(true);
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(true); // older shells don't answer — let the browser prompt decide
    }, 20_000);
    waiting.set(id, (g) => {
      clearTimeout(timer);
      resolve(g);
    });
    rn.postMessage(JSON.stringify({ type: "perm:media", id, video }));
  });
}

export class MediaError extends Error {}

/** Mic (and front camera for video) with friendly errors. */
export async function getCallMedia(video: boolean, facingMode: "user" | "environment" = "user"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MediaError("This browser can't make calls. Try Chrome or the NetworQ app.");
  if (!(await ensureDevicePermission(video))) {
    throw new MediaError(video ? "Allow microphone and camera for NetworQ in your phone settings to make video calls." : "Allow the microphone for NetworQ in your phone settings to make calls.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (e: any) {
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError") {
      throw new MediaError(video ? "Camera or microphone is blocked. Allow them for this site, then try again." : "Microphone is blocked. Allow it for this site, then try again.");
    }
    if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") {
      throw new MediaError(video ? "No camera or microphone found on this device." : "No microphone found on this device.");
    }
    if (e?.name === "NotReadableError") throw new MediaError("Your camera or microphone is being used by another app.");
    throw new MediaError("Couldn't start your microphone. Please try again.");
  }
}

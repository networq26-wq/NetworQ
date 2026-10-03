// Speaks assistant replies: natural Orpheus voice from /api/tts, falling back to the
// device's most natural *female* voice. One utterance at a time; new speech interrupts.

const FEMALE_HINTS = /(samantha|ava|allison|susan|karen|moira|tessa|victoria|serena|zira|aria|jenny|michelle|sonia|libby|natasha|google us english|google uk english female|female|woman)/i;
const MALE_HINTS = /(daniel|alex|fred|tom|aaron|arthur|oliver|george|guy|ryan|david|mark|male)/i;

export function pickFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const female = en.filter((v) => FEMALE_HINTS.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, "")));
  // prefer premium/natural variants, then any female English voice, then any non-male English voice
  return (
    female.find((v) => /(natural|premium|enhanced|neural)/i.test(v.name)) ||
    female[0] ||
    en.find((v) => !MALE_HINTS.test(v.name)) ||
    en[0] ||
    null
  );
}

export function speechText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#`~>|[\]]/g, "")
    .replace(/•/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function createVoicePlayer(opts: { endpoint: string; getToken: () => Promise<string | null> }) {
  let generation = 0;
  let audio: HTMLAudioElement | null = null;
  let serverVoiceDown = false;

  function stop() {
    generation++;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function speakOnDevice(text: string, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickFemaleVoice(window.speechSynthesis.getVoices());
      if (v) u.voice = v;
      u.rate = 0.98;
      u.pitch = 1.04;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      if (gen === generation) window.speechSynthesis.speak(u);
      else resolve();
    });
  }

  async function playClips(clips: string[], gen: number) {
    for (const src of clips) {
      if (gen !== generation) return;
      await new Promise<void>((resolve, reject) => {
        audio = new Audio(src);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("playback failed"));
        audio.play().catch(reject);
      });
    }
  }

  /** Resolves when speech finishes or is interrupted. */
  async function speak(raw: string, hooks: { onLoading?: () => void; onStart?: () => void } = {}) {
    stop();
    const gen = generation;
    const text = speechText(raw);
    if (!text) return;
    hooks.onLoading?.();
    if (!serverVoiceDown) {
      try {
        const token = await opts.getToken();
        const res = await fetch(opts.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ text }),
        });
        if (gen !== generation) return;
        if (res.status === 503) serverVoiceDown = true; // provider not set up: use device voice for this session
        if (res.ok) {
          const { clips } = await res.json();
          hooks.onStart?.();
          await playClips(clips, gen);
          return;
        }
      } catch {
        if (gen !== generation) return;
      }
    }
    hooks.onStart?.();
    await speakOnDevice(text, gen);
  }

  return { speak, stop };
}

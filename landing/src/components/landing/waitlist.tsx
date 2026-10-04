import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Share2, Sparkles, Loader2 } from "lucide-react";
import { Reveal } from "./reveal";
import darkTexture from "../../assets/dark-texture.jpg";

const SUPABASE_URL = "https://jpuxmkkuzqojqeatespa.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwdXhta2t1enFvanFlYXRlc3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTA5MDEsImV4cCI6MjEwMzU2NjkwMX0.eO4xWQyVlA0KzvnJugFADiVrahWXTRDEUq-k5uRcPp0";

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "already" | "error">("idle");
  const [position, setPosition] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    try {
      setStatus("loading");
      setErrorMsg("");

      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_waitlist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ p_email: cleanEmail }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || errJson.hint || "Failed to join waitlist");
      }

      const data = await res.json();
      setPosition(data.position || null);

      if (data.already_exists) {
        setStatus("already");
      } else {
        setStatus("success");
      }
    } catch (err: any) {
      console.warn("Waitlist join error:", err);
      setStatus("error");
      setErrorMsg(err.message || "Something went wrong. Please check your email and try again.");
    }
  };

  const handleShare = () => {
    const text = "I just reserved my early access spot for NetworQ — the AI networking and digital identity CRM. Check it out:";
    const url = "https://www.networq.co.in/waitlist";
    if (navigator.share) {
      navigator.share({ title: "NetworQ Waitlist", text, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <section id="waitlist" className="section-dark relative isolate overflow-hidden">
      <img
        src={darkTexture}
        alt=""
        aria-hidden="true"
        loading="lazy"
        width={1920}
        height={1088}
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-70"
      />
      <div className="relative mx-auto max-w-3xl px-6 py-28 text-center md:py-40">
        <Reveal>
          <h2 className="text-4xl leading-[1.14] font-semibold tracking-[-0.035em] text-balance sm:text-[3.25rem]">
            You met <span className="font-serif italic text-primary">12</span> people at that event. You'll remember{" "}
            <span className="font-serif italic text-primary">2</span> by Friday.
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-6 max-w-md text-[17px] text-muted-foreground">
            NetworQ scans business cards and QR codes, drafts your follow-up emails, and nudges you to reconnect before people forget you ever met.
          </p>
        </Reveal>

        <Reveal delay={0.14}>
          {status === "success" || status === "already" ? (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-violet-500/30 bg-card/90 p-8 text-center backdrop-blur-xl shadow-2xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-600/20 text-violet-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="mt-4 text-2xl font-bold text-foreground">
                {status === "already" ? "You're already on the list!" : "You're on the early access list!"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {status === "already"
                  ? `Your spot #${position || "reserved"} is confirmed. We will email you the moment early access opens.`
                  : `Congratulations! Your spot #${position || "reserved"} is locked in. First 100 users receive 3 months of NetworQ Pro free.`}
              </p>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md transition-transform hover:-translate-y-px"
                >
                  <Share2 className="h-4 w-4" />
                  {copied ? "Link Copied to Clipboard!" : "Share & Move Up the Queue"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setEmail("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Register another email
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row"
            >
              <label htmlFor="waitlist-email" className="sr-only">
                Email address
              </label>
              <input
                id="waitlist-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                disabled={status === "loading"}
                className="h-12 flex-1 rounded-xl border border-input bg-card px-4 text-[15px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform duration-200 hover:-translate-y-px disabled:opacity-50"
              >
                {status === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Reserving…</span>
                  </>
                ) : (
                  <>
                    <span>Get early access</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          )}

          {status === "error" && (
            <div className="mx-auto mt-3 max-w-md text-sm text-rose-400">
              {errorMsg}
            </div>
          )}
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <span>First 100 users get 3 months free. No credit card required.</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

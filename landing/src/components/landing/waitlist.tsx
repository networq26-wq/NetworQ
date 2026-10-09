import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Share2, Sparkles, Loader2, Mail } from "lucide-react";
import { Reveal } from "./reveal";

const SUPABASE_URL = "https://jpuxmkkuzqojqeatespa.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwdXhta2t1enFvanFlYXRlc3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5OTA5MDEsImV4cCI6MjEwMzU2NjkwMX0.eO4xWQyVlA0KzvnJugFADiVrahWXTRDEUq-k5uRcPp0";

// Where this visit came from (UTM tags / ?ref= invite code / referring page) — sent with the sign-up
function visitDetails(source: string) {
  const p = new URLSearchParams(window.location.search);
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* older browsers */
  }
  return {
    source,
    utm_source: p.get("utm_source") || "",
    utm_medium: p.get("utm_medium") || "",
    utm_campaign: p.get("utm_campaign") || "",
    ref: p.get("ref") || "",
    referrer: document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : "",
    tz,
  };
}

export function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "already" | "error">("idle");
  const [position, setPosition] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    try {
      setStatus("loading");
      setErrorMsg("");

      let data: any = null;
      try {
        // Same-origin on networq.co.in; from any other host call the main site (8 s, then Supabase directly)
        const sameOrigin = /^(www\.)?networq\.co\.in$|onrender\.com$|^localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const apiRes = await fetch(`${sameOrigin ? "" : "https://www.networq.co.in"}/api/waitlist/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: cleanEmail, ...visitDetails("landing") }),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        if (apiRes.ok) {
          data = await apiRes.json();
        }
      } catch (_) {}

      if (!data) {
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
        data = await res.json();
      }
      setPosition(data.position || null);
      setRefCode(data.ref_code || null);

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
    // Your own invite link: people who join through it move you up the invite queue
    const url = `https://waitlist.networq.co.in/${refCode ? `?ref=${encodeURIComponent(refCode)}` : ""}`;
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
      {/* Ambient Royal Violet Tech Mesh Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[480px] bg-gradient-to-tr from-violet-600/20 via-purple-600/10 to-indigo-600/0 rounded-full blur-[110px] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(#8b5cf6_1px,transparent_1px)] [background-size:36px_36px] opacity-[0.08]" />
      </div>
      <div className="relative mx-auto max-w-3xl px-6 py-16 text-center sm:py-24 md:py-36">
        <Reveal>
          <h2 className="text-2xl leading-snug font-semibold tracking-[-0.03em] text-balance sm:text-4xl md:text-[3.25rem]">
            You met <span className="font-serif italic text-[#8B5CF6] font-semibold">12</span> people at that event. You'll remember{" "}
            <span className="font-serif italic text-[#8B5CF6] font-semibold">2</span> by Friday.
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mx-auto mt-4 sm:mt-6 max-w-md text-[15px] sm:text-[17px] text-muted-foreground leading-relaxed">
            NetworQ scans business cards and QR codes, drafts your follow-up emails, and nudges you to reconnect before people forget you ever met.
          </p>
        </Reveal>

        <Reveal delay={0.14}>
          {status === "success" || status === "already" ? (
            <div className="mx-auto mt-8 sm:mt-10 max-w-md rounded-2xl border border-violet-500/30 bg-card/90 p-6 sm:p-8 text-center backdrop-blur-xl shadow-2xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-600/20 text-violet-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="mt-4 text-xl sm:text-2xl font-bold text-foreground">
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
            <div className="relative mx-auto mt-8 sm:mt-10 w-full max-w-xl px-2 sm:px-0">
              {/* Subtle ambient violet back-glow */}
              <div
                aria-hidden="true"
                className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-violet-600/35 via-purple-600/25 to-violet-600/35 blur-md opacity-80"
              />

              <form
                onSubmit={onSubmit}
                className="relative flex w-full flex-col sm:flex-row gap-2.5 sm:gap-2 rounded-2xl border border-white/20 bg-card/95 p-2 sm:p-2 backdrop-blur-xl shadow-2xl text-left"
                style={{ width: "100%", boxSizing: "border-box" }}
              >
                <label htmlFor="waitlist-email" className="sr-only">
                  Email address
                </label>
                <div className="relative flex flex-1 items-center" style={{ width: "100%", minHeight: "52px" }}>
                  <Mail className="absolute left-4 h-5 w-5 text-muted-foreground/60 pointer-events-none" />
                  <input
                    id="waitlist-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    disabled={status === "loading"}
                    className="h-12 w-full rounded-xl bg-transparent pl-12 pr-4 text-base sm:text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60 transition-colors focus:ring-0"
                    style={{ minHeight: "52px", width: "100%", fontSize: "16px" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="group inline-flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base sm:text-sm font-semibold text-primary-foreground shadow-md transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 shrink-0 whitespace-nowrap cursor-pointer"
                  style={{ minHeight: "52px" }}
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
            </div>
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
            <span>First 100 users get 3 months free.</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

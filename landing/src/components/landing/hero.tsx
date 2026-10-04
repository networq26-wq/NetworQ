import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, CalendarClock, MapPin, MessageSquareText, Sparkles } from "lucide-react";

export function Hero() {
  const reduced = useReducedMotion();
  const rise = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] as const },
  });

  return (
    <section id="top" className="relative isolate overflow-hidden pt-24 pb-16 md:pt-40 md:pb-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(70% 60% at 50% 0%, black, transparent 75%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 0%, black, transparent 75%)",
        }}
      />
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <div>
          <motion.div {...rise(0)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Early Access · First 100 users get 3 months free
              </span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Never lose a conversation again
            </p>
          </motion.div>

          <motion.h1
            {...rise(0.08)}
            className="mt-4 text-[2.2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.1rem]"
          >
            Meet people.
            <br />
            Networ<span className="text-[#8B5CF6]">Q</span> does the rest.
          </motion.h1>

          <motion.p
            {...rise(0.16)}
            className="mt-6 max-w-lg text-[16px] sm:text-[17px] leading-relaxed text-muted-foreground"
          >
            You meet valuable people all the time. NetworQ remembers who they are, what you talked
            about, and when to follow up — before the connection goes cold.
          </motion.p>

          <motion.div {...rise(0.24)} className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4">
            <a
              href="#waitlist"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground shadow-[var(--shadow-soft)] transition-transform duration-200 hover:-translate-y-px"
            >
              Join the waitlist
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <span className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
              First 100 users get 3 months free.
            </span>
          </motion.div>
        </div>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <HeroSurface />
        </motion.div>
      </div>
    </section>
  );
}

function HeroSurface() {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-lift)]">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="h-2 w-2 rounded-full bg-border" />
          <span className="h-2 w-2 rounded-full bg-border" />
        </div>
        <span className="ml-2 text-xs text-muted-foreground">Connections</span>
      </div>

      <div className="p-5 sm:p-6">
        <p className="label-eyebrow">You met</p>
        <div className="mt-3 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary text-sm font-medium">
            RS
          </div>
          <div>
            <p className="text-[15px] font-medium tracking-[-0.01em]">Rahul Sharma</p>
            <p className="text-sm text-muted-foreground">Founder at XYZ Labs</p>
          </div>
        </div>

        <div className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <MapPin className="h-4 w-4" />
            Hyderabad Tech Summit
          </div>
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <MessageSquareText className="h-4 w-4" />
            Discussed AI infrastructure
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-secondary/60 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <CalendarClock className="h-4 w-4 text-primary" />
            <span className="font-medium">Follow up</span>
          </div>
          <span className="text-sm text-muted-foreground">Tomorrow · 10:00 AM</span>
        </div>
      </div>

      <div className="border-t border-border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            You haven't spoken to Rahul in 6 days. Want to send a follow-up?
          </p>
        </div>
        <button
          type="button"
          className="mt-4 w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Draft follow-up
        </button>
      </div>
    </div>
  );
}

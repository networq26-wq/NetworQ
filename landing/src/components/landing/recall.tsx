import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowRight, Search } from "lucide-react";

const QUERY =
  "Who did I meet at the startup event last month who was building something in AI?";

export function Recall() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState("");
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setTyped(QUERY);
      setShowResult(true);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(QUERY.slice(0, i));
      if (i >= QUERY.length) {
        clearInterval(id);
        setTimeout(() => setShowResult(true), 420);
      }
    }, 22);
    return () => clearInterval(id);
  }, [inView, reduced]);

  return (
    <section className="section-dark">
      <div ref={ref} className="mx-auto max-w-4xl px-6 py-28 md:py-36">
        <div className="text-center">
          <h2 className="text-4xl leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            You don't need to remember everything.
          </h2>
          <p className="mt-5 text-[17px] text-muted-foreground">Just remember to meet people.</p>
        </div>

        <div className="mt-14 rounded-2xl border border-border bg-card shadow-[var(--shadow-lift)]">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-[15px] leading-relaxed">
              {typed}
              {typed.length < QUERY.length && (
                <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[2px] animate-pulse bg-primary" />
              )}
            </p>
          </div>

          <div className="min-h-[240px] p-5 sm:p-7">
            <AnimatePresence>
              {showResult && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-secondary text-sm font-medium">
                      AR
                    </div>
                    <div>
                      <p className="text-[15px] font-medium tracking-[-0.01em]">Ananya Rao</p>
                      <p className="text-sm text-muted-foreground">Co-founder · Neural Labs</p>
                    </div>
                  </div>

                  <dl className="mt-7 space-y-4 border-t border-border pt-6 text-sm">
                    <Row label="Met at" value="Hyderabad Startup Summit" />
                    <Row
                      label="You discussed"
                      value="AI infrastructure and potential collaboration."
                    />
                    <Row label="Last interaction" value="3 weeks ago" />
                  </dl>

                  <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Suggested action · </span>
                      <span className="font-medium text-primary">Reconnect this week</span>
                    </p>
                    <button
                      type="button"
                      className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
                    >
                      Draft a message
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[160px_1fr] sm:gap-6">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

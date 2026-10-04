import { Reveal } from "./reveal";
import { QrCode, NotebookPen, Send, Search } from "lucide-react";
import meeraAvatar from "../../assets/meera-iyer.jpg";

const steps = [
  {
    n: "01",
    title: "Capture",
    lead: "Meet someone. Save the moment.",
    body: "Scan a business card or exchange your QR code.",
    icon: QrCode,
  },
  {
    n: "02",
    title: "Remember",
    lead: "Add the context that matters.",
    body: "Attach the event, conversation notes, and reminders.",
    icon: NotebookPen,
  },
  {
    n: "03",
    title: "Follow up",
    lead: "Never lose momentum.",
    body: "Get reminded and draft a personalised follow-up instantly.",
    icon: Send,
  },
  {
    n: "04",
    title: "Find anyone",
    lead: "Ask naturally.",
    body: "“Who did I meet at TechSummit who works in robotics?”",
    icon: Search,
  },
];

export function Solution() {
  return (
    <section id="how-it-works" className="section-dark">
      <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
        <Reveal>
          <p className="label-eyebrow">How it works</p>
        </Reveal>
        
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-baseline">
          <Reveal delay={0.05}>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl md:text-5xl">
              Your memory for professional relationships.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              NetworQ quietly remembers every connection, the context behind it, and the right moment to reconnect.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 items-stretch">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08} className="h-full">
              <div className="h-full flex flex-col justify-between rounded-2xl border border-border bg-card/60 p-6 md:p-7 backdrop-blur-sm shadow-[var(--shadow-soft)] hover:border-primary/40 hover:shadow-lg transition-all duration-300">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-[0.14em] uppercase text-primary">
                      {s.n} — {s.title}
                    </span>
                    <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <s.icon className="h-4 w-4" />
                    </div>
                  </div>

                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
                    {s.lead}
                  </h3>
                  
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {s.body}
                  </p>
                </div>

                {/* Bottom preview widget for visual balance across all cards */}
                {s.n === "01" && (
                  <div className="mt-6 pt-4 border-t border-border/80">
                    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background/80 p-3 text-xs">
                      <span className="h-7 w-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-bold text-[11px]">QR</span>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">Card & QR Auto-Scan</p>
                        <p className="text-[11px] text-muted-foreground truncate">Name, role & contact saved</p>
                      </div>
                    </div>
                  </div>
                )}

                {s.n === "02" && (
                  <div className="mt-6 pt-4 border-t border-border/80">
                    <div className="rounded-xl border border-border bg-background/80 p-3 text-xs space-y-1.5">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium text-[10px]">
                        📍 Bengaluru Tech Summit
                      </span>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 italic">
                        “Discussed AI agent architecture & intro”
                      </p>
                    </div>
                  </div>
                )}

                {s.n === "03" && (
                  <div className="mt-6 pt-4 border-t border-border/80">
                    <div className="rounded-xl border border-border bg-background/80 p-3 text-xs flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">Follow-up reminder</p>
                        <p className="text-[11px] text-emerald-400 font-medium">⚡ 1-click draft ready</p>
                      </div>
                      <span className="px-2 py-1 rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
                        Send
                      </span>
                    </div>
                  </div>
                )}

                {s.n === "04" && (
                  <div className="mt-6 pt-4 border-t border-border/80">
                    <div className="rounded-xl border border-violet-500/30 bg-background/90 p-3 text-xs shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase font-bold text-primary tracking-wider">Result</span>
                        <span className="text-[10px] text-emerald-400 font-medium">Verified match</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <img 
                          src={meeraAvatar} 
                          alt="Meera Iyer" 
                          className="h-9 w-9 rounded-full object-cover ring-1 ring-primary/40 shrink-0" 
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">Meera Iyer</p>
                          <p className="text-[11px] text-muted-foreground truncate">Robotics lead · TechSummit</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "./reveal";
import { QrCode, NotebookPen, Send, Search } from "lucide-react";

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
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-end">
          <Reveal delay={0.05}>
            <h2 className="text-4xl leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              Your memory for professional relationships.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              NetworQ quietly remembers every connection, the context behind it, and the right
              moment to reconnect.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 -mx-6 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex snap-x snap-mandatory items-start gap-5 lg:grid lg:grid-cols-4 lg:gap-0">
            {steps.map((s, i) => (
              <Reveal
                key={s.n}
                delay={i * 0.08}
                className="w-[76vw] shrink-0 snap-start sm:w-[340px] lg:w-auto"
              >
                <div className="h-full border-t border-border pt-7 lg:border-l lg:border-t-0 lg:px-9 lg:first:pl-0 lg:last:pr-0">
                  <div className="flex items-center gap-3">
                    <s.icon className="h-4 w-4 text-primary" />
                    <span className="text-xs tracking-[0.14em] text-muted-foreground">
                      {s.n} — {s.title.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-6 text-[17px] font-medium tracking-[-0.02em]">{s.lead}</p>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                  {s.n === "04" && (
                    <div className="mt-5 rounded-xl border border-border bg-card p-4">
                      <p className="text-[13px] text-muted-foreground">Result</p>
                      <p className="mt-1.5 text-sm font-medium">Meera Iyer</p>
                      <p className="text-[13px] text-muted-foreground">
                        Robotics lead · met at TechSummit
                      </p>
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

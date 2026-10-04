import { Reveal } from "./reveal";
import {
  ScanLine,
  QrCode,
  BookMarked,
  Sparkles,
  Search,
  BellRing,
  CalendarCheck,
} from "lucide-react";

const features = [
  {
    icon: ScanLine,
    title: "AI Card Scanner",
    body: "Turn any business card into a saved connection in seconds.",
    span: "md:col-span-3",
  },
  {
    icon: QrCode,
    title: "Personal QR",
    body: "Share your details instantly and capture connections seamlessly.",
    span: "md:col-span-3",
  },
  {
    icon: BookMarked,
    title: "Context Memory",
    body: "Remember where you met, what you discussed, and why it mattered.",
    span: "md:col-span-2",
  },
  {
    icon: Sparkles,
    title: "AI Follow-ups",
    body: "Generate warm, personalised follow-up emails without starting from scratch.",
    span: "md:col-span-2",
  },
  {
    icon: Search,
    title: "Smart Search",
    body: "Search your professional network using natural language.",
    span: "md:col-span-2",
  },
  {
    icon: BellRing,
    title: "Reconnection Reminders",
    body: "Get reminded before important relationships go cold.",
    span: "md:col-span-3",
  },
  {
    icon: CalendarCheck,
    title: "Meeting Scheduler",
    body: "Turn a conversation into the next meeting without unnecessary back-and-forth.",
    span: "md:col-span-3",
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-28 md:py-36">
      <Reveal>
        <p className="label-eyebrow">What NetworQ does</p>
      </Reveal>
      <Reveal delay={0.05}>
        <h2 className="mt-6 max-w-2xl text-4xl leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
          Everything after “Nice meeting you.”
        </h2>
      </Reveal>

      <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-6">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.05} className={f.span}>
            <div className="group h-full bg-background p-7 transition-colors duration-300 hover:bg-card md:p-9">
              <f.icon className="h-[18px] w-[18px] text-muted-foreground transition-colors duration-300 group-hover:text-primary" />
              <h3 className="mt-6 text-[17px] font-medium tracking-[-0.02em]">{f.title}</h3>
              <p className="mt-2.5 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

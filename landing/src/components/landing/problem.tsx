import { Reveal } from "./reveal";
import conversation from "../../assets/conversation.jpg";

const steps = ["Meet", "Exchange details", "Forget context", "Miss follow-up", "Connection fades"];

export function Problem() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-28 md:py-36">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-24">
        <div>
          <Reveal>
            <p className="label-eyebrow">The problem</p>
          </Reveal>
          <Reveal delay={0.05}>
            <h2 className="mt-6 text-4xl leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              The hardest part of networking
              <br className="hidden sm:block" /> isn't meeting people.
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 text-4xl font-semibold tracking-[-0.035em] text-primary sm:text-5xl">
              It's remembering them.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-9 max-w-md space-y-2 text-[17px] leading-relaxed text-muted-foreground">
              <p>You meet someone. Exchange details. Have a great conversation.</p>
              <p>A few days later, the context is gone.</p>
              <p>Their name. Their company. What you discussed.</p>
              <p>And eventually, the follow-up never happens.</p>
            </div>
          </Reveal>
        </div>

        <div className="lg:pt-4">
          <Reveal>
            <figure className="mb-12 overflow-hidden rounded-2xl border border-border bg-card">
              <img
                src={conversation}
                alt="Two professionals connecting and exchanging contact at a conference"
                width={1600}
                height={1104}
                loading="lazy"
                className="aspect-[16/11] w-full object-cover shadow-sm transition-transform duration-500 hover:scale-[1.02]"
              />
            </figure>
          </Reveal>

          <ol className="relative">
            {steps.map((s, i) => (
              <Reveal key={s} delay={i * 0.07}>
                <li className="relative flex items-center gap-4 pb-9 last:pb-0">
                  {i < steps.length - 1 && (
                    <span className="absolute top-3 bottom-0 left-[3.5px] w-px bg-border" />
                  )}
                  <span className="relative z-10 h-[7px] w-[7px] shrink-0 rounded-full bg-border" />
                  <span
                    className="text-[15px]"
                    style={{ opacity: 1 - i * 0.15 }}
                  >
                    {s}
                  </span>
                </li>
              </Reveal>
            ))}
          </ol>

          <Reveal delay={0.35}>
            <div className="mt-4 border-t border-primary/40 pt-6">
              <p className="text-lg font-medium tracking-[-0.02em] text-primary">
                NetworQ changes this.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

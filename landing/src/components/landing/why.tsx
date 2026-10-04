import { Reveal } from "./reveal";

const rows = [
  ["Name and phone number", "The person + the context"],
  ["Static information", "Relationship history"],
  ["You remember to follow up", "NetworQ reminds you"],
  ["Search by name", "Search by what you remember"],
];

export function Why() {
  return (
    <section id="why" className="mx-auto max-w-6xl px-6 py-28 md:py-36">
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-24">
        <div>
          <Reveal>
            <h2 className="text-4xl leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              Networking isn't about
              <br className="hidden sm:block" /> collecting contacts.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-8 text-3xl leading-[1.15] font-medium tracking-[-0.03em] text-primary sm:text-4xl">
              It's about not losing people.
            </p>
          </Reveal>
          <Reveal delay={0.14}>
            <div className="mt-8 space-y-1.5 text-[17px] leading-relaxed text-muted-foreground">
              <p>A contact list remembers names.</p>
              <p>NetworQ remembers relationships.</p>
            </div>
          </Reveal>
        </div>

        <div className="lg:pt-3">
          <Reveal>
            <div className="grid grid-cols-2 gap-6 border-b border-border pb-4">
              <p className="label-eyebrow">Traditional contacts</p>
              <p className="label-eyebrow" style={{ color: "var(--primary)" }}>
                NetworQ
              </p>
            </div>
          </Reveal>
          {rows.map(([a, b], i) => (
            <Reveal key={a} delay={i * 0.07}>
              <div className="grid grid-cols-2 gap-6 border-b border-border py-6">
                <p className="text-[15px] leading-snug text-muted-foreground">{a}</p>
                <p className="text-[15px] leading-snug font-medium tracking-[-0.01em]">{b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Reveal } from "./reveal";

const audiences = [
  "Founders",
  "Sales professionals",
  "Consultants",
  "Recruiters",
  "Event attendees",
];

export function Trust() {
  return (
    <section className="border-y border-border">
      <Reveal className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <p className="text-sm text-muted-foreground">
            Built for the conversations worth remembering.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            {audiences.map((a, i) => (
              <span key={a} className="flex items-center gap-3">
                <span className="text-[13px] font-medium tracking-[-0.01em]">{a}</span>
                {i < audiences.length - 1 && (
                  <span className="text-border" aria-hidden>
                    ·
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

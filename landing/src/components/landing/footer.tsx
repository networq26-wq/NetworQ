import { Wordmark } from "./wordmark";

const links = [
  { label: "Product", href: "#features" },
  { label: "Waitlist", href: "#waitlist" },
  { label: "Privacy", href: "https://www.networq.co.in" },
  { label: "Contact", href: "https://www.networq.co.in" },
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-14 md:flex-row md:items-start md:justify-between">
        <div>
          <Wordmark />
          <p className="mt-2 text-sm text-muted-foreground">Smart Networking, Digitally.</p>
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="mx-auto max-w-6xl border-t border-border px-6 py-6">
        <p className="text-xs text-muted-foreground">© 2026 NetworQ. All rights reserved.</p>
      </div>
    </footer>
  );
}

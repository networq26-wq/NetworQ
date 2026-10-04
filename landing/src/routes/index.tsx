import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Trust } from "@/components/landing/trust";
import { Problem } from "@/components/landing/problem";
import { Solution } from "@/components/landing/solution";
import { Features } from "@/components/landing/features";
import { Recall } from "@/components/landing/recall";
import { Why } from "@/components/landing/why";
import { Waitlist } from "@/components/landing/waitlist";
import { Footer } from "@/components/landing/footer";

const title = "NetworQ — Smart Networking, Digitally.";
const description =
  "NetworQ remembers the people you meet, what you discussed, and when to follow up. AI contact capture, context memory, follow-ups and smart search.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "NetworQ",
          applicationCategory: "BusinessApplication",
          description,
        }),
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />
        <Trust />
        <Problem />
        <Solution />
        <Features />
        <Recall />
        <Why />
        <Waitlist />
      </main>
      <Footer />
    </div>
  );
}

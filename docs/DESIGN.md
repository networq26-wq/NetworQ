# Design — NetworQ

## The test every screen must pass
*Could a 2-year-old or an 80-year-old use this without being taught?*
- **One idea per screen.** One primary action, everything else quieter.
- **Plain words.** "Who's next", "Going", "Save contact" — never jargon ("Auto-Pilot", "CRM sync").
- **Big, obvious targets.** ≥ 44 pt touch targets; the main action is a filled pill.
- **Honest states.** Skeletons while loading, plain errors with a way out, empty states that say what to do next. Never fake data.
- **One way to each thing.** No duplicate entries (e.g. Me is reached only from the header avatar).

## Information architecture (phone)

```
Header:  [NetworQ logo]                         [Search] [Bell] [Avatar → Me]
Body:    People | Messages | Radar | Events  (the current tab)
Bottom:  ─────────── People · Messages · Radar · Events ───────────  (+ quiet AI button)
```

| Tab | Top to bottom |
|---|---|
| **People** | Greeting + live line → at-a-glance strip → quick actions (Scan · Type · Voice · My QR · Follow up) → Who's next → Coming up → Your people (search, one filter row, list; Select mode) |
| **Messages** | Title + New message → conversations (unread first by recency) |
| **Radar** | Nearby / Events switch → state card (off → turn on; on → discoverable, people, privacy) |
| **Events** | Title + Add → search with location pill → date control + calendar → categories → results by day |
| **Me** | Card (flip for QR) → Show QR / Share → grouped rows: Profile · Card · Organization / Notifications · Privacy · Password & devices · Appearance / Tools / Data · Help · Account (each a sub-page with "‹ Me") |

Desktop uses a left sidebar with the same destinations and a right-hand contact inspector.

## Brand
- **Logo:** official artwork only — `public/brand/networq-wordmark.png` (light), `networq-wordmark-white.png` (dark), `networq-q*.png` (mark). The **Q scan beam** (CSS `.nq-qscan`) sweeps inside the Q's opening in the logo's own violets (#5E35F5 / #715DFC with a light core).
- **Tagline:** "Never lose a conversation again."
- **Primary:** Royal violet `#7C3AED` (dark-mode accent `#C4B5FD` / `#A78BFA`). Logo violets `#361DD9 → #5E35F5`, bar `#715DFC`.
- **Status:** success `#34C759`, warning `#FF9F0A`, destructive `#FF3B30`.

## Tokens
| Token | Light | Dark |
|---|---|---|
| Background | `#F2F2F7` / `#F5F5F7` | `#000000` |
| Surface (cards, sheets) | `#FFFFFF` | `#1C1C1E` |
| Raised (inputs, chips) | `#F2F2F7` | `#2C2C2E` |
| Text | `#1C1C1E` | `#FFFFFF` |
| Secondary text | `#6E6E73` | `#AEAEB2` |
| Hairline | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` |

Typography: system font (SF Pro / Roboto). Titles 28 / 22 / 17 semibold–bold with −0.02em tracking; body 15–16; captions 12–13. Radius: 14 inputs, 18–22 cards, 28 sheet tops, full pills for chips and buttons.

## Components
- **Grouped list** (iOS-style): one rounded card, hairline separators, 44 px avatar, name + one secondary line, at most two round icon buttons.
- **Sheets** slide up from the bottom with a grabber; tap outside or Back to close.
- **Chips:** pill, inverted (black/white) when selected.
- **Segmented control:** for 2–4 mutually exclusive choices (dates, reminder, radar scope).
- **Card-shaped surfaces** (ID-1 ratio 1.586): your digital card, event cards, Coming up tiles.
- **Badges/pills** are vertically centred inline-flex with even height.

## Motion (Apple HIG-inspired)
| Class | Use | Feel |
|---|---|---|
| `nq-screen` | tab change | quick opacity fade (no transform, so fixed overlays aren't trapped) |
| `nq-sheet-up` / `nq-sheet-right` | sheets / sub-pages | 0.3–0.34 s, cubic-bezier(0.32, 0.72, 0, 1) |
| `nq-pop` | new list items, dialogs | 0.24 s scale from 0.94 |
| `nq-stagger` | lists | children fade in 25 ms apart |
| `nq-skeleton` | loading | soft shimmer |
| `nq-success-*` | important success | check draws itself |
| `nq-qscan`, `nq-scanline` | brand / scanning | slow sweep |
| Call screen | ringing | pulsing rings; tone + vibration |

No motion on frequent, repetitive interactions. Everything respects `prefers-reduced-motion`. Glass (blur) only on floating controls (bottom bar, AI button, select bar, call controls).

## Writing style
Short sentences, second person, verbs on buttons ("Save contact", "Send 3 emails"), real numbers ("2 people are waiting to hear from you"), and explain limits honestly ("Finding people around you uses Bluetooth, so it works in the NetworQ phone app").

# Design System — NetworQ

## Philosophy
Premium, minimal, focused. Inspired by Apple and Google's design principles.
No rainbow gradients. No gimmicks. Everything serves the user.

> "Design is not just what it looks like. Design is how it works." — Steve Jobs

---

## Brand

| Element | Value |
|---|---|
| Primary Color | `#7C3AED` (Purple) |
| Brand Name | NetworQ |
| Logo | Animated Q with laser scanner beam |
| Tagline | Professional Network Intelligence |

---

## Color Palette

### Dark Mode (Primary)
| Token | Value | Usage |
|---|---|---|
| Background | `#000000` | App background |
| Surface | `#1C1C1E` | Cards, modals |
| Surface 2 | `#2C2C2E` | Inputs, hover |
| Border | `rgba(255,255,255,0.08)` | Dividers, borders |
| Text Primary | `#FFFFFF` | Headings |
| Text Secondary | `#AEAEB2` | Labels, muted |
| Text Muted | `#6E6E73` | Placeholders |
| Accent | `#7C3AED` | Buttons, active states |
| Success | `#10B981` | Sent, confirmed |
| Warning | `#F59E0B` | Reminders, alerts |
| Error | `#EF4444` | Errors |

### Light Mode
| Token | Value | Usage |
|---|---|---|
| Background | `#F2F2F7` | App background |
| Surface | `#FFFFFF` | Cards, modals |
| Surface 2 | `#F2F2F7` | Inputs |
| Border | `rgba(0,0,0,0.08)` | Dividers |
| Text Primary | `#1C1C1E` | Headings |
| Text Secondary | `#3C3C43` | Labels |
| Text Muted | `#8E8E93` | Placeholders |

### Prohibited Colors
- No bright HSL rainbow gradients on roles or tags
- No neon or fluorescent colors
- No random color-per-user schemes
- Tags are always neutral: `rgba(255,255,255,0.06)` dark / `rgba(0,0,0,0.04)` light

---

## Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| App font | SF Pro / -apple-system / Arial | — | — |
| H1 (page titles) | System | 28–32px | 700–800 |
| H2 (section) | System | 20–24px | 600–700 |
| Body | System | 15px | 400 |
| Label | System | 13px | 500 |
| Caption | System | 11–12px | 400 |
| Monospace | SF Mono / monospace | 13px | 400 |

---

## Spacing
Based on 4px grid:
- `4px` — micro gap
- `8px` — compact
- `12px` — default inner padding
- `16px` — card padding
- `20–24px` — section gap
- `32–48px` — page sections

---

## Border Radius
| Element | Radius |
|---|---|
| Buttons | `10px` |
| Cards | `14–16px` |
| Inputs | `10px` |
| Modals | `20px` |
| Chips/Tags | `20px` (pill) |
| Avatar | `50%` (circle) |
| Logo container | `24px` |

---

## Buttons

### Primary
```
background: #7C3AED
color: white
padding: 12px 20px
border-radius: 10px
font-weight: 600
```

### Secondary
```
background: rgba(255,255,255,0.06)
color: inherit
border: 1px solid rgba(255,255,255,0.1)
```

### Destructive
```
background: rgba(239,68,68,0.15)
color: #EF4444
border: 1px solid rgba(239,68,68,0.3)
```

---

## Components

### Cards
- Background: surface color
- Border: 1px solid border color
- Border-radius: 14–16px
- Padding: 16–20px
- No drop shadows by default (Apple-style flat)
- Hover: slight background lift

### Inputs
- Background: surface-2
- Border: 1px solid border
- Border-radius: 10px
- Focus: 2px solid `#7C3AED`
- Height: 44px (touch-friendly)

### Modals
- Background: surface with `backdrop-filter: blur(20px)`
- Max-width: 480–520px
- Border-radius: 20px
- Overlay: `rgba(0,0,0,0.5)`

### Avatar / Display Picture
- Circle, 36–44px
- Photo if available
- Otherwise: SF-style user silhouette icon on neutral `#3A3A3C` background
- Never: colored initials, rainbow backgrounds

### Tags / Chips
- Neutral only: no bright colors
- Pill shape (border-radius: 20px)
- Font-size: 11–12px
- Padding: 3px 10px

---

## Icons
- Library: Custom SVG inline in `Icons` object in `App.tsx`
- Style: Lucide-inspired line icons
- Size: 16px default, 20px for nav, 24px for featured
- Color: inherits from parent (no hardcoded colors except brand elements)

---

## Motion & Animation
- Page transitions: `fadeUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)`
- Modals: scale + fade in
- Splash scanner: SVG animated laser beam in Q cavity
- Confetti: physics-based particle system on success
- No excessive bounce or spring animations

---

## Responsive Design
| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | < 768px | Full-width, bottom nav |
| Tablet | 768–1024px | Sidebar + content |
| Desktop | > 1024px | Wide sidebar + content |

---

## UX Requirements
- Every async action must have a loading state
- Every form must have error states
- Empty states must have a helpful message + CTA
- All interactive elements must be keyboard-navigable
- Minimum touch target: 44×44px (Apple HIG)
- Accessible color contrast (WCAG AA minimum)

---

## What NOT to do
- ❌ Bright role badges (founders = green, investor = blue etc.)
- ❌ Rainbow tag colors
- ❌ "Powered by Groq" or vendor branding in UI
- ❌ Fancy glassmorphism everywhere (use sparingly)
- ❌ Animations that block or delay user actions
- ❌ Colored initials avatars — use icon silhouette instead

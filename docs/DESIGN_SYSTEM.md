# Design System: Swiss Grid

Helvetica-style type, a 12-column grid, and a single red. The extension, the companion app and the landing page all follow this file. `tests/theme.test.ts` checks that their colour tokens match it.

```yaml
version: alpha
name: Swiss Grid
colors:
  primary: "#000000"      # headlines and core text
  secondary: "#555555"    # borders, captions, metadata
  tertiary: "#DC2626"     # the one accent: the main action
  neutral: "#F5F5F5"      # page background
  surface: "#FFFFFF"      # cards
  on-primary: "#FFFFFF"   # text on red
typography:
  display: { fontFamily: Inter Tight, fontSize: 4rem, fontWeight: 700, letterSpacing: "-0.03em" }
  h1:      { fontFamily: Inter Tight, fontSize: 2.25rem, fontWeight: 700, letterSpacing: "-0.02em" }
  body:    { fontFamily: Inter, fontSize: 0.95rem, lineHeight: 1.55 }
  label:   { fontFamily: Inter, fontSize: 0.75rem, letterSpacing: "0.02em" }
rounded: { sm: 0px, md: 0px, lg: 0px }
spacing: { sm: 8px, md: 16px, lg: 32px }
components:
  button-primary: { backgroundColor: tertiary, textColor: on-primary, rounded: 0px, padding: 12px 20px }
  card:           { backgroundColor: surface, textColor: primary, rounded: 0px, padding: 24px }
```

## Rules

- **One red per screen.** `#DC2626` is the main action (Scan, Save, Install, Download). Everything else is black, white or grey. Overdue deadlines may also use red, since that is the one thing that needs attention.
- **No other accents.** No blue, green, purple or amber in the interface. Status ("due soon", "synced") is shown with weight, borders and grey, not hue. Course colours that a student picks are their data and stay as chosen.
- **Flat.** No gradients, no decorative shadows. Separation comes from 1px borders and the grey page against white cards.
- **Square.** Every corner is 0px.
- **Negative space is a feature.** Let the neutral background carry the layout.

## Tokens in code

The three apps use the same CSS custom properties:

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--bg` | `#f5f5f5` | `#0a0a0a` |
| `--surface` | `#ffffff` | `#141414` |
| `--surface-border` | `#e5e5e5` | `#262626` |
| `--surface-border-strong` | `#d4d4d4` | `#3a3a3a` |
| `--text-main` | `#000000` | `#f5f5f5` |
| `--text-muted` | `#555555` | `#a3a3a3` |
| `--accent` | `#dc2626` | `#dc2626` |
| `--accent-hover` | `#b91c1c` | `#ef4444` |
| `--on-accent` | `#ffffff` | `#ffffff` |

The dark theme is the same system with black and white swapped; the red does not change. The landing page names its button tokens `--action-primary-bg` / `--action-primary-hover` with the same values.

## Fonts

Inter and Inter Tight (SIL Open Font License) are bundled, so nothing is loaded from Google:

- Extension: `public/fonts/` (served from the extension root as `/fonts/`)
- Companion and landing page: `mobile-web/companion/fonts/` (the landing page loads them from `/companion/fonts/`)

## Where the styles live

- Extension: `src/popup/popup.css`, plus `src/content/content.css` for the Scan button on Blackboard pages
- Companion: `mobile-web/companion/styles.css`
- Landing page: the `<style>` block in `mobile-web/index.html`

Each app's stylesheet ends with a "Swiss Grid design system" block that sets the fonts, headings, the red primary buttons and focus outlines.

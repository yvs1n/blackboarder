# Design System: Swiss Grid, two-tone

Swiss Grid typography, a 12-column grid, square corners and flat surfaces, in Blackboarder's two-tone colours: a near-black and a near-white, with grey shades of the two in between. The extension, the companion app and the landing page all follow this file. `tests/theme.test.ts` checks that their colour tokens match it.

```yaml
version: alpha
name: Swiss Grid (two-tone)
colors:
  primary: "#18181B"      # near-black: core text and the main action in light mode
  on-primary: "#FFFFFF"   # text on the primary colour
  light: "#F4F4F6"        # near-white: core text and the main action in dark mode
  neutral: "#F8FAFC"      # page background (light)
  surface: "#FFFFFF"      # cards (light)
  secondary: "#71717A"    # grey shade for captions and metadata
typography:
  display: { fontFamily: Inter Tight, fontSize: 4rem, fontWeight: 700, letterSpacing: "-0.03em" }
  h1:      { fontFamily: Inter Tight, fontSize: 2.25rem, fontWeight: 700, letterSpacing: "-0.02em" }
  body:    { fontFamily: Inter, fontSize: 0.95rem, lineHeight: 1.55 }
  label:   { fontFamily: Inter, fontSize: 0.75rem, letterSpacing: "0.02em" }
rounded: { sm: 0px, md: 0px, lg: 0px }
spacing: { sm: 8px, md: 16px, lg: 32px }
components:
  button-primary: { backgroundColor: primary, textColor: on-primary, rounded: 0px, padding: 12px 20px }
  card:           { backgroundColor: surface, textColor: primary, rounded: 0px, padding: 24px }
```

## Rules

- **Two colours, many shades.** Near-black and near-white, plus any grey shade between them where it helps (borders, muted text, hover and selected states). No blue, green, purple or amber in the interface. Red appears only for errors, overdue deadlines and delete actions. Course colours that a student picks are their data and stay as chosen.
- **One primary action per screen.** The main action (Scan, Save, Install, Download) is the solid primary colour: near-black in light mode, near-white in dark mode. Everything else is outlined or quiet.
- **Flat.** No gradients, no decorative shadows. Separation comes from 1px borders and the page against the cards.
- **Square.** Every corner is 0px.
- **Negative space is a feature.** Let the background carry the layout.

## Tokens in code

The three apps use the same CSS custom properties:

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--bg` | `#f8fafc` | `#121215` |
| `--surface` | `#ffffff` | `#1a1a1f` |
| `--surface-border` | `#e4e4e7` | `#2c2c36` |
| `--surface-border-strong` | `#d4d4d8` | `#3f3f4c` |
| `--text-main` | `#0f172a` | `#f4f4f6` |
| `--text-muted` | `#64748b` | `#a1a1aa` |
| `--primary` / `--accent` | `#18181b` | `#f4f4f6` |
| `--accent-hover` | `#27272a` | `#ffffff` |
| `--on-accent` | `#ffffff` | `#121215` |

Dark mode is the same two tones swapped. The landing page names its button tokens `--action-primary-bg` / `--action-primary-hover`.

## Fonts

Inter and Inter Tight (SIL Open Font License) are bundled, so nothing is loaded from Google:

- Extension: `public/fonts/` (served from the extension root as `/fonts/`)
- Companion and landing page: `mobile-web/companion/fonts/` (the landing page loads them from `/companion/fonts/`)

## Where the styles live

- Extension: `src/popup/popup.css`, plus `src/content/content.css` for the Scan button on Blackboard pages
- Companion: `mobile-web/companion/styles.css`
- Landing page: the `<style>` block in `mobile-web/index.html`

Each app's stylesheet ends with a "Design system" block that sets the fonts, headings, the primary buttons and focus outlines.

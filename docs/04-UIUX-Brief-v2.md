# Dry Run — UI/UX Design Brief v2

**Document:** 4 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 04-UIUX-Brief v1.0 · **Governed by:** `CLAUDE.md` · **Depends on:** 01-PRD-v2 · 03-App-Flow-v2

**Every hex value, font, duration and easing curve in this document is normative. Derive nothing.
If a value isn't here, ask before inventing it.**

UI/UX is separately and heavily scored at this event, and many competing teams include
professional engineers. They can also import a 3D library. What they cannot fake is having real
data behind every visual property. That is the whole strategy of this document.

---

## 0. What changed from v1 — and a warning

The v1 brief was sound. **The implementation drifted away from it, and that drift is the single
biggest visual regression to undo.** In the prototype:

| Token | v1 spec | What got built | Effect |
|---|---|---|---|
| `--ink-1` | `#A8A395` warm | `#94A3B8` | Tailwind slate-400 — cold |
| `--ink-2` | `#6E7A80` | `#475569` | Tailwind slate-600 — cold |
| `--flow` | `#8FC7D6` chalky | `#22d3ee` | Tailwind cyan-400 — neon |
| `--chart-shelf` / `--chart-shoal` | `#10202C` / `#17303E` | swapped, wrong values | surfaces read inverted |
| friction ramp `f-00…f-100` | 6 stops | **absent** | friction had no colour at all |
| `--ok` `--warn` `--danger` `--info` | 4 semantic | **absent** | `emerald-500` / `red-400` used ad hoc → three accent hues |

**Restore the tokens verbatim before writing a single component.** Warm bone on cold water, one
accent hue. The moment stock slate and cyan enter the file, the interface starts reading as
generated — which is the specific failure this brief exists to prevent.

**Additions in v2:** the friction ramp is now mandatory infrastructure (§12), provenance badges
are a never-cut item, and four new components exist for the exclusion story (§9): the exclusion
strip, the segment filter, the replay scrubber, and the drift step row. The build order (§13) is
recut for 36 hours and one visual owner.

---

## 1. Design thesis

**The app is terrain. Users are water. Friction is where the flow pools and drains away.**

Dry Run produces a survey of a system nobody has mapped: elevation where things are hard,
channels where people move, sinks where they disappear. That is a **bathymetric chart** — a depth
survey of unknown water. The name is already a pun on it: a dry run, a dried-up channel.

So the interface is a **survey instrument**, not a dashboard. Ink on deep water. Contour lines.
Condensed chart labels. Survey-orange markers on a blue-black ground. The Atlas isn't nodes
floating in space — it's a chart with elevation, plumb lines and depth contours radiating from
the places where users drown.

**Register:** precise, quiet, confident. The product makes a serious empirical claim. The
interface should look like it can back it up.

---

## 2. What we are deliberately not doing

| Banned | Why |
|---|---|
| Near-black `#0A0A0A` + one acid-green or violet accent | The most common AI dashboard look. Reads as generated instantly. |
| Purple/indigo gradient hero | Every AI hackathon project since 2023 |
| Glassmorphism / `backdrop-blur` on panels | Decorative, costs GPU we need, muddies screenshot textures |
| Tron grid floor, neon wireframes, cyberpunk | Wrong genre. We're an instrument, not a game. |
| Animated gradient mesh backgrounds | Pure decoration, competes with the data |
| Emoji in product UI | — |
| **Imported 3D models, mascots, decorative floating shapes** | **Every 3D element encodes data.** A polyhedron that means nothing is a subtraction. One exception, and it earns its place: the survey marker (§7.5). |
| More than one accent hue | We have exactly one: survey orange |
| Centered marketing layout on a tool screen | Tools are left-aligned and dense |
| Bloom strong enough to hurt text legibility | Bloom is a highlight, not a filter |
| Loading spinners where a skeleton works | — |

**Spend the boldness in one place: the Atlas contour system (§7).** Everything around it stays
disciplined and quiet. That contrast is what makes it land.

---

## 3. Colour

### 3.1 Substrate — deep water
```css
--chart-abyss:  #060D14;   /* page background, deepest */
--chart-deep:   #0A1620;   /* Atlas canvas, surface-0 */
--chart-shelf:  #10202C;   /* cards, panels, surface-1 */
--chart-shoal:  #17303E;   /* raised, overlays, surface-2 */
--rule:         #1F3D4D;   /* hairlines, 1px borders */
--rule-strong:  #2E5468;   /* emphasised dividers, focus outlines */
```
Blue-black, never neutral black. The cast is the point.

### 3.2 Ink — warm bone on cold water
```css
--ink-0: #EDE4D3;   /* primary text — warm bone */
--ink-1: #A8A395;   /* secondary */
--ink-2: #6E7A80;   /* tertiary, disabled, axis labels */
```
`--ink-0` on `--chart-deep` is **14.8:1**. This pairing is the move that makes the palette ours.
Do not substitute a cold grey.

### 3.3 Accent — the survey marker
```css
--marker:      #FF7A45;
--marker-dim:  #B8532C;
--marker-wash: rgba(255, 122, 69, 0.12);
```
One accent. Selection, primary actions, alarm. Nothing else.

### 3.4 Flow — persona current
```css
--flow:     #8FC7D6;
--flow-dim: #4E7E8C;
```
Chalky chart cyan, deliberately desaturated so it never competes with the marker.

### 3.5 Friction ramp — bathymetric, colourblind-safe
```css
--f-00:  #12293A;   /* 0–20   calm  */
--f-20:  #1E4A5C;
--f-40:  #3E7484;
--f-60:  #96A48F;   /* shoal */
--f-80:  #D8B06A;   /* sand  */
--f-100: #FF7A45;   /* hot   */
```
Deep water → shoal → sand → marker. **Never passes through red-vs-green.** Lightness rises
monotonically, so it survives greyscale, protanopia, deuteranopia and a bad projector.
Interpolate in **OKLab, not sRGB**, or the midtones go muddy.

**Colour is never the only encoding.** Friction is carried redundantly by ramp colour **+** node
elevation **+** contour ring count **+** the printed numeral. We ship a screen-reader segment and
rank apps on accessibility signals; failing our own test would be indefensible, and a judge who
checks will find out.

### 3.6 Semantic
```css
--ok:     #8AA98C;   /* intact, approved, success */
--warn:   #E0A03C;   /* truncated crawl, degraded, replay mode */
--danger: #FF7A45;   /* same as marker — orange is our alarm */
--info:   #8FC7D6;
```

### 3.7 Provenance — shape first, colour second
| Badge | Glyph | Fill | Text | Means |
|---|---|---|---|---|
| Observed | `▪` filled square | `--marker` | `--ink-0` | the browser measured this |
| Modeled | `◪` half square | `--flow-dim` | `--ink-1` | the simulation produced this |
| Predicted | `▫` hollow, 1px dashed | none | `--ink-2` | never crawled, no support |

Always accompanied by the word. A colourblind judge, a greyscale printout and a washed-out
projector all still work. **This is a never-cut item** — build the component before anything that
displays a number.

---

## 4. Typography

Three faces, all Google Fonts, all via `next/font/google`.

| Role | Face | Weights | Used for |
|---|---|---|---|
| **Cartouche** | **Instrument Serif** | 400, 400 italic | The hero line and section cartouches **only** |
| **UI** | **IBM Plex Sans** | 400, 500, 600 | All interface text |
| **Chart label** | **IBM Plex Sans Condensed** | 500, 600 | Atlas node labels, micro-labels, table headers |
| **Data** | **IBM Plex Mono** | 400, 500 | Every numeral, ref, anchor, score, code |

Plex was drawn for engineering documentation and carries a drafting lineage that fits a survey
instrument; the condensed cut gives authentic chart labels, which Inter cannot. Inter is the
default default — avoid it.

### Type scale (1280px baseline)
```
cartouche-1  48px / 1.05   Instrument Serif 400        tracking -0.02em
cartouche-2  30px / 1.15   Instrument Serif 400        tracking -0.01em
h1           22px / 1.25   Plex Sans 600               tracking -0.01em
h2           17px / 1.35   Plex Sans 600
body         14px / 1.55   Plex Sans 400
body-sm      12.5px/ 1.5   Plex Sans 400
label        11px / 1.35   Plex Sans Condensed 600     tracking 0.08em  UPPERCASE
data-xl      34px / 1.0    Plex Mono 500               tabular-nums
data-lg      20px / 1.1    Plex Mono 500               tabular-nums
data         13px / 1.35   Plex Mono 400               tabular-nums
```

**`font-variant-numeric: tabular-nums` on every element whose number can change.** Without it,
animated counters jitter horizontally and the whole interface looks cheap. Not optional.

**Copy rules:** sentence case everywhere, including buttons. Active voice. An action keeps its
name through the flow — the button says "Approve", the state says "Approved". Errors say what
happened and what to do next, and never apologise. **Never write copy that claims behavioural
realism** (L1): "41% of personas could not determine which control advances the task", never
"41% of users got frustrated".

---

## 5. Space, shape, surface

```css
--s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
--s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;

--r-sm: 3px;   /* chips, badges */
--r-md: 6px;   /* buttons, inputs, cards */
--r-lg: 10px;  /* panels, modals */
--r-full: 999px;
```
Radii stay tight. Instruments are precise; soft 16px corners read as consumer app.

**Elevation on dark is border-lightness, not shadow.** Shadows on `#0A1620` turn to grey mud.
```css
.surface        { background: var(--chart-shelf); border: 1px solid var(--rule);
                  box-shadow: inset 0 1px 0 rgba(237,228,211,0.04); }
.surface-raised { background: var(--chart-shoal); border-color: var(--rule-strong); }
```

**Contour substrate.** The page background carries a repeating contour-line pattern at **3%
opacity**, `background-size: 420px`, generated once as an inline SVG of irregular concentric
closed curves. Almost subliminal — noticed only when someone leans in. It says "chart" before a
single word is read, and it costs nothing.

---

## 6. Motion

```css
--t-instant: 80ms;   --t-fast: 140ms;   --t-base: 220ms;
--t-slow: 380ms;     --t-deliberate: 600ms;

--ease-out:    cubic-bezier(0.16, 1, 0.30, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
```
Framer Motion springs: `{ type:'spring', stiffness:260, damping:28, mass:0.9 }`.

### Named animations
| Name | Trigger | Spec |
|---|---|---|
| `node-birth` | `state-found` | scale 0.4→1, opacity 0→1, `--t-slow`, `--ease-out`, 40 ms stagger |
| `edge-draw` | `edge-found` | `strokeDashoffset` 1→0 over `--t-slow` |
| `plumb-drop` | after `node-birth` | vertical line grows to the chart plane, `--t-base`, 120 ms delay |
| `node-rise` | `metrics` arrives | node lifts from y=0 to its friction elevation, `--t-deliberate`, `--ease-out` |
| `contour-bloom` | friction resolves | rings expand from the plumb point, `--t-deliberate`, 90 ms stagger |
| `counter-roll` | any metric lands | **minimum 600 ms**, `--ease-out`, tabular-nums |
| `inspector-rise` | node selected | y +24→0, opacity 0→1, spring |
| `marker-plant` | node selected | the survey beacon drops in and settles, spring |
| `leak` | particle reaches a dropout node | opacity 1→0 over 900 ms with −0.4 y drift |
| `badge-pop` | finding or signal arrives | scale 0.8→1.06→1, spring |
| `stage-advance` | stage change | rail row fills left→right, `--t-base` |
| `view-crossfade` | stage done → atlas | 300 ms opacity crossfade, no layout shift |
| `segment-recolour` | segment filter change | node colours lerp over `--t-slow` — **do not snap**; the transition is the point |
| `walk-trace` | persona replay | particle travels edge by edge, 450 ms per hop, path highlights behind it |

### Rules
1. **Never animate a number faster than it can be read.** 600 ms floor on `counter-roll`. A metric
   that snaps looks fabricated; one that rolls looks measured.
2. **Never animate layout during a demo beat.** Crossfade inside a fixed frame.
3. **Ambient motion is continuous and slow.** Particle flow and the top-3 pulse run always.
   Everything else is triggered and finishes.
4. **`prefers-reduced-motion`** kills particles, fly-to, contour bloom, `walk-trace` and all
   pulses; keeps opacity fades and counter rolls. **Wired on day one, not as polish** — we're the
   accessibility-aware product.
5. **The animation is the computation, not decoration.** Nodes rise because friction resolved.
   Particles vanish because personas dropped out. If an animation doesn't correspond to a
   computation, it doesn't ship.

---

## 7. The Atlas — the signature element

This is where the boldness is spent. Everything else stays quiet so this lands.

### 7.1 The chart plane
A subtle grid plane at `y = 0`, `--rule` at 12% opacity, 1-unit spacing, fading out at 60 units
via fog (`--chart-abyss`, near 30, far 90). This is the sea floor. Nodes float above it at their
friction elevation, each tethered by a **plumb line** — 1px vertical, `--ink-2` at 35%. The plumb
lines are what make elevation legible; without them it's just floating cards.

### 7.2 Contour rings — the thing people remember
Concentric rings expand across the chart plane around each node's plumb point, like depth
contours around a seamount:
```
ringCount   = frictionRing(frictionScore)      // floor(score/20) → 0–5
ringRadius  = 1.2 + i * 0.55
ringColor   = frictionColor(frictionScore)
ringOpacity = 0.30 − i * 0.045
lineWidth   = 1.5px screen-space
```
Top-3 `fixValue` nodes get one additional **dashed** ring rotating at 0.08 rad/s. Cheap geometry,
and every property encodes real data. Nobody else in that room will have this.

### 7.3 Nodes
- `2.4 × 1.5` unit rounded plane, screenshot as texture (512×320 JPEG q70, pre-resized server-side)
- 1px emissive border in the ramp colour; emissive intensity `0.2 + friction/100 × 0.8`
- Y position `= frictionElevation(score)` = `score/100 × 6` units
- Label below in Plex Sans Condensed 600, 11px, letterspaced, `--ink-0`, via `drei/<Text>`
- Score right of the label in Plex Mono 500, ramp-coloured
- **In segment-filter mode:** the node's `ExclusionDelta` appears beside the score prefixed `+`,
  in `--marker` when positive
- Billboarded on the Y axis only, so the chart layout stays readable

### 7.4 Edges, flow, and the leak
- Quadratic Bézier tubes, radius `0.02 + traversalShare × 0.06`
- Colour: source node's ramp value at 30% opacity
- **Particles:** one `InstancedMesh`, 0.06-unit spheres, `--flow`, count `min(400, edges × 4)`.
  Per-instance `t` advanced in `useFrame`, speed ∝ traversal volume.
- **The leak:** at each node, a fraction of arriving particles equal to `dropout(s)` does not
  continue — they fade and drift down through the chart plane. **Tune this carefully; it is the
  best visual argument in the product.** A judge watching a quarter of the current fall through
  the floor at "Connect Source" understands the thesis without narration.

### 7.5 The survey marker — the one object in the scene
On selection, a small tripod beacon plants on the selected node: three tapered legs (cylinders),
a central staff, a faceted head in `--marker` at emissive 1.2. Built from primitives, ~40 lines,
no imported mesh. It drops with a spring and settles. It is the only element that is an object
rather than data, and it earns that by being the selection indicator.

### 7.6 Lighting, camera, post
```
ambient          0.38, #4E7E8C
key directional  [4, 8, 6], 0.7, #EDE4D3
rim directional  [-6, 2, -4], 0.35, --marker   (grazing warmth on node edges)
shadows          none  (cost, and they muddy screenshot textures)

camera           perspective 45°, frames the graph with 20% padding
controls         damped orbit, dampingFactor 0.08, distance 8–60
fly-to           600ms --ease-out on selection
bloom            threshold 0.78, strength 0.55, radius 0.4
vignette         0.32
```

**Selection state:** selected node scale 1.06, full opacity; all others 55%; edges not touching
it 20%. The graph visibly defers to what you clicked.

### 7.7 2D fallback — build this first
Same `d3-force-3d` positions with `z` discarded, rendered as SVG. Nodes are rounded rects with
the screenshot as `<image>`, a friction-coloured 3px left edge bar, label and score in the same
faces. **Contour rings become concentric SVG circles** — the signature survives the fallback.
Make it genuinely handsome; it may be what runs on the demo laptop.

---

## 8. Screen layouts

### 8.1 Launchpad (`/`)
12-column grid, 1280 max-width, 32px gutters.
```
┌────────────────────────────────────────────────────────────┐
│  DRY RUN ·····························  Docs   ⬤ engine    │ 56px
├────────────────────────────────────────────────────────────┤
│   Find where onboarding breaks.        ← cartouche-1       │ cols 1–7
│   Before anyone signs up.                Instrument Serif  │
│                                          italic            │
│   ┌────────────────────────────────┐ ┌──────────┐          │
│   │ https://staging.yourapp.com    │ │ Dry run →│          │ 48px
│   └────────────────────────────────┘ └──────────┘          │
│   Try the demo target ›                                    │
├──── hairline ──────────────────────────────────────────────┤
│  RECENT SURVEYS                        ← label style       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Meridian   2 min ago   17 screens   6 findings       │  │
│  │ ▪▪▪▪▪▪▪▪░░  worst: Connect Source              78    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```
The hero is the thesis line with the URL field directly beneath it. No stat blocks, no feature
grid, no gradient. **The single input is the pitch:** one field, and it maps your app.
Right of the hero (cols 8–12): a slowly rotating, muted, non-interactive Atlas at 40% opacity.

### 8.2 Run Setup (`/new`)
Single column, 720px, centred. Three numbered sections — numbered because it genuinely is a
sequence (what to test, what to try, who tries it), not for decoration. Section headers in
`label` style with a Plex Mono numeral. The attestation checkbox sits in a `--marker-wash` inset
with a 1px `--marker-dim` left border — visible, deliberate, unmissable. Launch bar sticky at the
bottom in `--chart-shoal`, estimate line in Plex Mono to its left.

### 8.3 Run Console
```
1280px:  [ canvas · fluid ][ rail 340px ]   inspector = bottom sheet 260px
1440px+: [ canvas · fluid ][ rail 380px ]   inspector = bottom sheet 300px
```
Top bar 56px fixed. View tabs right-aligned, underline indicator in `--marker` sliding between
them over `--t-base`.

**Live view** splits the right column: stage rail 200px on top, **signal feed** scrolling
beneath. Signal rows are `--chart-shelf` with a 2px left border in `--marker` and an `▪ Observed`
badge — each row is a measurement, not a narration.

**Inspector** slides up from the bottom over the canvas, `--chart-shoal`, 1px top border in
`--rule-strong`. Metrics in a 4-up Plex Mono grid at `data-lg`. Screenshot thumbnail left,
exclusion strip centre, finding chips right.

### 8.4 Findings
Single column 880px. The **ExclusionIndex header** is the first thing on the page: `data-xl`
numeral in `--marker`, the state and segment named in `h2`, the Observed fact beneath in
`body-sm`. Then the ranked list. Bias disclosure in `--ink-2` at the foot, always present.

### 8.5 Tour Builder
Single column 820px. Step cards with the order numeral in Plex Mono at 34px, `--ink-2`, on a left
rail; anchor chip and generated copy in the body; three actions right-aligned. Approved cards get
an `--ok` left border and drop their button row. Approval counter in the sticky footer beside
Preview and Export.

### 8.6 Drift
Single column 820px. Step rows with a health glyph (shape first: `●` `◐` `○`), old anchor and
proposed anchor in Plex Mono with the changed token in `--marker`, confidence numeral right.
Approve/reject per row. Apply in the sticky footer.

---

## 9. Component specs

| Component | Spec |
|---|---|
| **Button · primary** | `--marker` bg, `#0A1620` text, 500 weight, 36px tall, `--r-md`, 14px side padding. Hover brightness 1.08. Active scale 0.98 `--t-instant`. Disabled: `--chart-shoal` bg, `--ink-2` text, tooltip states the reason. |
| **Button · secondary** | transparent, 1px `--rule-strong`, `--ink-0`. Hover bg `--chart-shoal`. |
| **Input** | `--chart-abyss` bg, 1px `--rule`, 40px tall, `--ink-0`, Plex Mono for URLs. Focus: border `--marker` + `0 0 0 3px --marker-wash`. |
| **Friction meter** | 6px bar, `--chart-abyss` track, fill in ramp colour, `--r-full`. Numeral right at `data-lg`, ramp-coloured. Fill animates on `counter-roll` timing. |
| **Provenance badge** | 20px pill, `--r-full`, glyph + word at 11px Plex Sans Condensed. §3.7. |
| **Anchor chip** | Plex Mono 12px, `--chart-abyss` bg, 1px dashed `--rule-strong`, `--r-sm`. Format `button "Connect data source"`. Click → resolution-ladder popover. |
| **Stage rail row** | 32px, 8px left dot, label, right value in Plex Mono. Active: `--marker` dot with a 2s pulse, label `--ink-0`. Done: `--ok` dot. Pending: `--ink-2` hollow. |
| **Signal row** | `--chart-shelf`, 2px `--marker` left border, screen name in `label` style, measurement in Plex Mono, `▪ Observed` badge right. |
| **Finding card** | `--chart-shelf`, 3px left border in ramp colour. Title `h2`, signature as a mono chip, friction meter, provenance badge, exclusion strip. |
| **Exclusion strip** *(new)* | One 4px row per segment, 6px gap. Baseline dropout marked with a 1px `--ink-2` tick; the bar extends from the tick, `--flow-dim` for ≤0 and `--marker` for >0. Worst segment named in words beside it. **Never colour alone — the name is always printed.** |
| **Segment filter** *(new)* | Segmented control in `--chart-shelf`, active pill `--chart-shoal` with a 1px `--marker` bottom border. Six options. Changing it triggers `segment-recolour`. |
| **Replay scrubber** *(new)* | Bottom-left overlay panel, `--chart-shoal`, 280px. Persona label in `label` style, `◪ Modeled` badge, step counter in Plex Mono, play/pause, a 4px timeline, and the stop reason in `body-sm`. |
| **Drift step row** *(new)* | Health glyph, step title, old → new anchor chips, confidence numeral, approve/reject. Approved rows get `--ok` left border. |
| **Replay-mode banner** | Full-width, `--chart-shelf`, 1px `--warn` bottom border, `--warn` glyph, text in `--ink-0`. **Undismissable.** |
| **Toast** | bottom-right, `--chart-shoal`, 1px `--rule-strong`, 5s auto-dismiss, slide-up spring. |
| **Focus ring** | `2px solid --marker`, 2px offset, on **every** interactive element. Never removed. |

---

## 10. Accessibility — non-negotiable

We ship a Screen-Reader segment and rank apps on accessibility signals. Failing our own audit
would be the worst possible finding in that room.

1. Body text ≥ 4.5:1, UI elements and borders ≥ 3:1. Verified with a tool, not assumed.
2. **No information encoded by colour alone, anywhere.** Friction: colour + elevation + rings +
   numeral. Provenance: glyph + word. Drift health: glyph + word. Exclusion: bar + printed name.
3. Every interactive element keyboard-reachable in a sensible order, with a visible focus ring.
4. Stage rail, signal feed and findings wrapped in `aria-live="polite"`.
5. The Atlas canvas has an `aria-label` summary, and the Findings view is its keyboard-navigable
   equivalent — not a second-class citizen.
6. `prefers-reduced-motion` fully honoured (§6).
7. All imagery has alt text; screenshots describe the screen they show.

**Demo line worth having ready:** *"We ran Dry Run on Dry Run. Here's what it found."* If it finds
something real in our own setup screen, put the slide in and leave the finding unfixed.

---

## 11. Performance guardrails

| Guardrail | Rule |
|---|---|
| Textures | Server pre-resizes to 512×320 JPEG q70. Never full-resolution screenshots in the scene. |
| Particles | One `InstancedMesh`. Never one mesh per particle. |
| Canvas lifetime | Mounted once, hidden with CSS on view switch. **Never unmount** — remounting costs ~800 ms and reads as a hang. |
| Bloom | Auto-disable below 40 fps for 2 s, with a quiet toast. |
| Layout | `d3-force-3d` runs 300 ticks up front, then freezes. No continuous simulation. |
| Fonts | `next/font/google`, `display: swap`, preload the two Plex weights used above the fold. |
| Reflow | Nothing in the rail animates `width` or `height`. Transform and opacity only. |
| Target | 60 fps at 40 nodes / 120 edges / 400 particles on integrated graphics at 1280×720 |

---

## 12. Token implementation

```js
// tailwind.config.ts — theme.extend
colors: {
  abyss:'#060D14', deep:'#0A1620', shelf:'#10202C', shoal:'#17303E',
  rule:'#1F3D4D', 'rule-strong':'#2E5468',
  ink:    { 0:'#EDE4D3', 1:'#A8A395', 2:'#6E7A80' },
  marker: { DEFAULT:'#FF7A45', dim:'#B8532C' },
  flow:   { DEFAULT:'#8FC7D6', dim:'#4E7E8C' },
  f:      { 0:'#12293A', 20:'#1E4A5C', 40:'#3E7484',
            60:'#96A48F', 80:'#D8B06A', 100:'#FF7A45' },
  ok:'#8AA98C', warn:'#E0A03C', info:'#8FC7D6',
},
fontFamily: {
  cartouche: ['var(--font-instrument)', 'serif'],
  sans:      ['var(--font-plex-sans)', 'system-ui'],
  cond:      ['var(--font-plex-cond)', 'system-ui'],
  mono:      ['var(--font-plex-mono)', 'monospace'],
},
borderRadius: { sm:'3px', md:'6px', lg:'10px' },
transitionTimingFunction: { out:'cubic-bezier(.16,1,.3,1)' },
```

```ts
// packages/core/ramp.ts — single source of truth, imported by React AND three.js
export function frictionColor(score: number): string;      // OKLab lerp over 6 stops
export function frictionRing(score: number): number;       // floor(score / 20)
export function frictionElevation(score: number): number;  // score / 100 * 6
```
**Write this file before any visual work.** The prototype had zero implementations of the ramp,
which is worse than two that drift. Both the DOM and the 3D scene import from here.

---

## 13. Build order for the visual layer — 36 hours, one owner

The Atlas is the module most likely to eat a day. Follow this sequence; do not skip ahead.

| By | Deliverable |
|---|---|
| **H+3** | `tailwind.config.ts` tokens verbatim from §12, four fonts loaded, contour substrate, `ramp.ts`, **provenance badge component**. Every other dev inherits a styled shell. |
| **H+8** | **2D Atlas complete** against fixture data — SVG, force layout, contour circles, labels, selection, inspector. **Demo-safe from here.** |
| **H+13** | Console shell, view tabs, stage rail, signal feed wired to SSE. Findings list rendering real findings. |
| **H+17** | Friction data driving everything: elevation, ramp colour, ring count, counter rolls. **Review 2 target.** |
| **H+22** | 3D Atlas: chart plane, textured nodes, plumb lines, Bézier edges, damped orbit, 2D⇄3D toggle |
| **H+26** | Contour rings, particles, **the leak** |
| **H+29** | Segment filter + exclusion strip + ExclusionIndex header |
| **H+31** | Survey marker, bloom, fly-to, selection dimming, persona replay scrubber |
| **H+33** | `prefers-reduced-motion` pass, projector test at 1280×720, FPS guard, replay banner |
| **H+34** | **Freeze** |

**Hard rule:** bloom, the survey marker and the replay scrubber are **forbidden** until the 2D
fallback, the console shell and the findings list are all green. The most common way this project
fails is one person polishing a shader while the ranked list doesn't render.

**Second hard rule:** the visual owner builds against **fixtures from hour 0** — a committed
`fixtures/meridian/graph.json` with metrics. Never blocked on the engine, not for one minute.

---

## 14. The three visual moments that earn the marks

Everything in this document serves these. If you are deciding what to polish, polish these.

1. **The leak.** A quarter of the current falling through the chart plane at Connect Source. It
   explains the entire product without a word.
2. **The segment recolour.** Switching the filter to `screen-reader` and watching the map turn
   orange. That is the SDG story, told in one interaction and zero slides.
3. **The tour playing on Meridian.** Not our UI at all — our artifact running inside someone
   else's app. It's the moment the project stops being a report and becomes a product.

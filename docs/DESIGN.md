# SNACKERY — Design Bible

> **Stack the snack.**
> A premium 3D food-stacking game for phones. One thumb, infinite tower, zero friction.

This document is the single source of truth. Every subsystem must conform to it.

---

## 1. Positioning

| | |
|---|---|
| **Name** | Snackery |
| **Tagline** | Stack the snack. |
| **Genre** | Precision stacker / one-tap arcade |
| **Session** | 20–60 seconds. Restart in under 1 second. |
| **Bar** | Apple Design Award finalist. If a frame would not survive a full-screen App Store screenshot, it is not done. |

**Benchmarks we must beat:** Ketchapp *Stack* (loop purity, but flat and dated), *Tower Bloxx* (charm, but heavy), *Sushi Roll 3D* (food appeal, but cheap materials). We take Stack's loop, give it real food, real light, and a real brand.

**The core promise:** every single tap produces a satisfying, physical, edible-looking result.

---

## 2. Core loop

```
       ┌──────────────────────────────────────────────┐
       │  A food layer slides above the tower         │
       │  (alternating X / Z axis each layer)         │
       └──────────────────┬───────────────────────────┘
                          │  player taps anywhere
                          ▼
       ┌──────────────────────────────────────────────┐
       │  Overlap is KEPT and lands on the tower      │
       │  Overhang is SLICED and tumbles off-screen   │
       └──────────────────┬───────────────────────────┘
                          ▼
          overlap ≥ 96%  ──►  PERFECT: no slice, footprint
                              grows back, combo++, camera
                              pulse, sparkle burst, note up
                              the pentatonic ladder
          overlap  > 0   ──►  normal stack, combo resets
          overlap == 0   ──►  the layer misses, tower is
                              topped out, run ends
```

**Escalation:** slide speed and travel amplitude ramp with height. Every 8 layers is a *course* change (new ingredient run + subtle palette shift + a milestone banner). Combos multiply score. Perfect streaks widen the plate back, so skill literally buys you room — the run is winnable-feeling, never arbitrary.

**Why food:** a rectangular slab is a rectangle. A *pancake* has a domed top, a syrup pool, and a browned rim. Same silhouette, ten times the appetite appeal. Every layer is regenerated at its exact cut size — we never boolean-slice a mesh, we rebuild it, so a cut burger reads like a real cross-section.

### Tuning constants (authoritative)

| Constant | Value | Note |
|---|---|---|
| `BASE_FOOTPRINT` | `2.4` | world units, plate + first layer |
| `LAYER_THICKNESS` | `0.24–0.62` | per-food, see `FoodDef.thickness` |
| `PERFECT_TOLERANCE` | `0.10` | world units of misalignment |
| `PERFECT_REGROW` | `0.06` | footprint returned per perfect |
| `START_SPEED` | `1.55` | units/sec |
| `MAX_SPEED` | `4.60` | reached ~layer 55 |
| `TRAVEL` | `3.10 → 3.60` | slide amplitude |
| `COURSE_LENGTH` | `8` | layers per course |
| `Y_ORIGIN` | plate top = `y = 0` | towers grow +Y |

---

## 3. Art direction

**One line:** *studio food photography, rendered in real time.*

- **Light:** three-point studio rig. Warm key at 35° with soft shadows, cool fill, bright rim to separate the tower from the backdrop. ACES Filmic tonemapping, exposure ≈ 1.05. Never flat-lit.
- **Backdrop:** infinite seamless gradient sweep (a photographer's cyclorama), tinted per theme, with a soft vignette. No skyboxes, no horizons, no clutter. The tower is the hero.
- **Materials:** physically-based and *specific*. Bread is rough with sheen. Glaze and syrup use clearcoat. Gummies use transmission. Chocolate is smooth and dark with a tight highlight. Cheese has subsurface warmth. Never use a default gray.
- **Silhouette:** every food must be identifiable as a black silhouette at 120px. This is the test.
- **Colour:** food is saturated and warm; the world is desaturated and cool. Contrast makes it edible.
- **Depth of field:** subtle. Foreground/background falloff via fog, not an expensive DOF pass.
- **Motion language:** *weighty but snappy*. Landings squash 8–12% and recover on a damped spring (≈14Hz, decay 9). Camera follows with easing, never rigidly. Nothing linear, nothing instant, nothing that overshoots twice.

### Theme palettes (authoritative hex — do not improvise)

| Theme | bgTop | bgBottom | fog | key | fill | rim | ground | accent | accentSoft |
|---|---|---|---|---|---|---|---|---|---|
| **Classic Diner** | `#FFE7C4` | `#E07A5F` | `#F2B48C` | `#FFF1DC` | `#8FB8DE` | `#FFD9A0` | `#B4523C` | `#E23E57` | `#FFB4A2` |
| **Sushi Tower** | `#22384A` | `#0A1218` | `#16242F` | `#EAF4FF` | `#5F8FA8` | `#FF9E80` | `#0E1A22` | `#FF6B57` | `#7FD1C1` |
| **Candy Stack** | `#FFE3F5` | `#B9AEFF` | `#E7D6FF` | `#FFF6FB` | `#9AD8FF` | `#FFC2E4` | `#8E7CE0` | `#FF5FA2` | `#7BE0E0` |
| **Taco Night** | `#FFC46B` | `#5E2751` | `#B4664F` | `#FFE3B0` | `#7A9FD4` | `#FFB03A` | `#3E1A36` | `#F2542D` | `#4CB944` |
| **Breakfast Rush** | `#FFF3D6` | `#FFA65C` | `#FFDCA8` | `#FFFAF0` | `#A8CBEE` | `#FFCE7A` | `#C97B3C` | `#FF8C42` | `#6FCF97` |
| **Pizza Piazza** | `#FFE9C7` | `#8C3B3B` | `#D99A72` | `#FFF3DE` | `#86A8C9` | `#FFC17A` | `#5C2626` | `#C1272D` | `#5E9B47` |

### Theme content

| Theme | Price | Tagline | Ingredient run (in order) |
|---|---|---|---|
| **Classic Diner** | Free | Burgers, syrup, the cozy default. | sesame bun crown, beef patty, cheddar slice, tomato, lettuce ruffle, pickle chips, bacon rashers, bottom bun |
| **Sushi Tower** | $1.99 | Rice, salmon, nori, wasabi pop. | pressed rice, salmon nigiri, nori band, tamago, avocado fan, tobiko, cucumber, wasabi dab |
| **Candy Stack** | $1.99 | Macarons, gummies, pastel dream. | macaron shell, gummy slab, marshmallow, chocolate bar, wafer, sprinkle icing, lollipop disc, nougat |
| **Taco Night** | $1.99 | Shells, guac, salsa, all the fixings. | folded shell, seasoned beef, guacamole, pico salsa, queso pour, black beans, jalapeño ring, lime crema |
| **Breakfast Rush** | $1.99 | Pancakes, bacon, and a lake of syrup. | pancake, syrup pool, butter pat, crisp bacon, fried egg, hash brown, blueberry scatter, waffle |
| **Pizza Piazza** | $1.99 | Deep dish, thin crust, endless cheese. | dough base, tomato sauce, mozzarella, pepperoni, basil leaves, olives, bell pepper, parmesan dust |
| **Full Menu bundle** | $4.99 | Every theme, forever. | — grants all five paid themes, badged *Best value* |

---

## 4. UI direction — "Apple level"

**Principle:** the UI is a thin, confident layer of glass over the game. It never competes with the food.

- **Type:** system stack — `-apple-system, "SF Pro Display", "Segoe UI Variable", Inter, system-ui, sans-serif`. Numerals are always `font-variant-numeric: tabular-nums` so scores don't jitter. Score display uses tight tracking (-0.03em) at large optical sizes.
- **Scale:** 8pt grid. Type ramp 12 / 14 / 17 / 22 / 34 / 56 / 88.
- **Materials:** `backdrop-filter: blur(30px) saturate(180%)` over a 12–20% white/black scrim. Hairline 0.5px borders at 18% white. Radii: 14 (control), 22 (card), 30 (sheet).
- **Buttons:** minimum 56px tall, 44px hit target absolute floor. Primary is a single filled accent pill with a subtle inner top highlight. Press = scale 0.96 + brightness dip in 90ms, release springs back.
- **Motion:** everything uses `cubic-bezier(0.32, 0.72, 0, 1)` (the iOS sheet curve) at 320–420ms. Sheets slide from the bottom with a rubber-band settle. Nothing fades in from nothing — things *arrive*.
- **Safe areas:** `env(safe-area-inset-*)` respected on every screen. Nothing within 16px of a screen edge.
- **Score HUD:** giant, centred, semi-transparent, sitting *behind* the tower conceptually — it's a scoreboard, not a widget. Score pops 1.12× and settles on every increment.
- **Restraint:** no gradients on text, no drop shadows on drop shadows, no more than one accent colour on screen, no emoji in primary chrome (glyphs are allowed on shop cards only).
- **Reduced motion:** honour `prefers-reduced-motion` — cut shake, parallax and confetti, keep functional transitions.
- **Never:** a browser `alert()`, a layout that scrolls horizontally, text smaller than 12px, or a tap target under 44px.

---

## 5. Audio direction

Fully procedural WebAudio — zero downloads, instant start, tiny bundle.

- **SFX:** soft, foley-adjacent, never beepy. A drop is a muted wooden *thock* with a short body resonance. A slice is a filtered noise *shk*. A perfect is a bell partial plus a tiny air sparkle.
- **Combo ladder:** perfect drops walk up a **major pentatonic** scale (C D E G A) across two octaves, resetting on break. This is the single most addictive sound in the genre — it must be exactly right.
- **Music:** adaptive, key-locked to the theme. Layers enter as intensity rises with tower height. Low-pass filter opens as you climb. Ducks under stings.
- **Mix:** master limiter, everything under -1 dBFS. SFX bus sidechains music by ~3dB on impacts.
- **Respect the mute switch:** audio starts only after a user gesture, suspends on `visibilitychange`.

---

## 6. Technical rules

- Target **60fps on an iPhone 11 / mid-range Android**. Frame governor drops quality tier automatically after sustained slow frames.
- Cap DPR at 2.0 (1.5 on low tier). Fill rate is the #1 mobile cost.
- **Share materials and geometry aggressively** via `MaterialLibrary`. A 60-layer tower must not mean 60 shader programs.
- Objects that fall off-screen are pooled and reused, never leaked.
- No external asset downloads. All geometry is procedural; all textures are painted to canvas at boot.
- Everything disposes: geometries, materials, textures, audio nodes, DOM listeners.
- Strict TypeScript, no `any` in exported signatures.

---

## 7. Ownership map (parallel build)

| Directory | Owner | Must not touch |
|---|---|---|
| `src/core/**`, `src/game/**`, `src/main.ts` | integrator | — |
| `src/render/**` | render agent | everything else |
| `src/content/**` | content agent | everything else |
| `src/ui/**`, `src/styles/**` | UI agent | everything else |
| `src/audio/**` | audio agent | everything else |
| `src/vfx/**` | vfx agent | everything else |
| `src/meta/**` | meta agent | everything else |

Contracts live in each directory's `api.ts` and are **frozen**. Implement against them exactly.

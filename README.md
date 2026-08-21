<div align="center">

# Snackery

**Stack the snack.**

A premium 3D food-stacking game for phones. One thumb, infinite tower, zero friction.

</div>

---

## The game

A food layer slides above your tower. Tap. The overlap stays, the overhang is
sliced off and tumbles away. Land it dead centre and you get a **perfect** —
nothing is lost, the plate grows back a little, the combo climbs, and the next
note in the pentatonic ladder rings out. Miss entirely and the run is over.

Every layer is a real food item — a browned patty, a drooping slice of cheddar,
a salmon fillet with fat striations, a gummy you can see light through. When a
layer is cut, the food is **rebuilt at its new size** rather than boolean-sliced,
so a narrow cut reads as a genuine cross-section instead of a clipped box.

Six themes ship as content packs: Classic Diner (free), Sushi Tower, Candy Stack,
Taco Night, Breakfast Rush and Pizza Piazza — each with its own eight-ingredient
run, palette, plate, and musical key.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the built bundle on :4173
npm test           # slice-geometry test suite
npm run shots      # drive the built game in headless Chromium, write PNGs
npm run icons      # regenerate app icons from tools/make-icons.mjs
```

No asset pipeline, no downloads: every mesh, texture and sound is generated at
runtime. The whole game is the JS bundle.

## Architecture

```
src/
├── core/        rng · typed emitter · storage · device profile · haptics ·
│                easing/damping math · rAF ticker with a frame governor
├── game/        the loop: StackGame · slice.ts (pure cut maths) · CameraRig ·
│                Offcuts (ballistic debris) · scoring · tuning constants
├── render/      SceneKit: renderer, three-point studio rig, procedural PMREM
│                environment, gradient cyclorama, bloom/vignette/grain, shake
├── content/     kit.ts (procedural food geometry) + one module per theme
├── vfx/         instanced GPU particles: crumbs, sparkles, splashes, rings,
│                confetti, world-space pop text
├── audio/       WebAudio synthesis: foley SFX, the combo ladder, adaptive
│                layered music keyed per theme
├── ui/          vanilla-DOM screens, glass components, motion system
├── meta/        save/migration, SKU catalog, billing seam, progression
└── main.ts      app shell: state machine and subsystem wiring
```

Each subsystem is built against a **frozen contract** in its own `api.ts`.
Nothing imports another subsystem's internals, so any one of them can be
replaced wholesale without touching the rest.

### Design decisions worth knowing

**Regenerate, don't boolean-slice.** `FoodDef.build(ctx)` is parametric in
width/depth and gets called at every size from the full 2.4-unit footprint down
to a 0.15-unit sliver. Cutting a layer means building two new meshes at the kept
and scrap sizes. This is why a cut burger looks like a cut burger.

**The cut is pure maths.** `src/game/slice.ts` holds the one piece of logic the
entire game rests on, with no Three.js or DOM dependency, covered by 2,640
assertions in `tests/`: kept + scrap must exactly reconstruct the sliding layer,
kept must be the true intersection, and a run of perfects must regrow a narrow
tower back toward the base footprint.

**The camera fits itself to the phone.** Portrait screens are narrow, so
`CameraRig` derives its distance from the viewport aspect such that the sliding
layer is always fully visible, and hands back only as much travel amplitude as
actually fits. No hard-coded framing that breaks on a different device.

**Everything shares.** A sixty-layer tower must not mean sixty shader programs,
so all materials, textures and cached geometry come from a keyed
`MaterialLibrary`. Particles are instanced and pooled with zero per-frame
allocation. A frame governor watches the rolling FPS and sheds quality tiers
live.

**Purchases are a seam, not a fake.** There is no web billing SDK, so
`src/meta/purchase.ts` defines a `BillingAdapter` and ships a clearly-named
`SimulatedBilling` implementation. It moves no money and is not dressed up as a
payment sheet; swapping in StoreKit or Play Billing is a one-line change. Every
theme is also unlockable with coins earned by playing.

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — the design bible: positioning, the core
  loop and its authoritative tuning constants, art direction, exact theme
  palettes, UI rules, audio direction, and technical constraints. It is the
  single source of truth; code follows it, not the other way round.

# Snackery — Suno prompts for theme music

Each theme's in-game score is synthesised at runtime in a **fixed key**, and the
perfect-drop combo chime walks a pentatonic ladder in that same key. A backing
track in a different key will fight every combo note in the game.

**So the key and tempo below are not suggestions — they are constraints.**
They come straight out of `src/audio/theory.ts`.

| Theme | Key | Scale | BPM | Swing |
|---|---|---|---|---|
| Classic Diner | **F major** | F major pentatonic | **96** | 0.16 |
| Sushi Tower | **D minor** | D minor pentatonic + dorian 6th | **76** | 0 |
| Candy Stack | **A major** | A major pentatonic | **124** | 0 |
| Taco Night | **E mixolydian** | E mixolydian pentatonic | **108** | 0.08 |
| Breakfast Rush | **C lydian** | C lydian pentatonic | **88** | 0.12 |
| Pizza Piazza | **G major** | G major pentatonic | **112** | 0.05 |

## Rules that apply to every track

Put these in the style field or keep them in mind when picking takes:

- **Instrumental. No vocals, no vocal chops, no spoken word.** A voice pulls
  focus from a game the player stares at for 40 seconds at a time.
- **Seamless loop, no intro build, no ending.** Start in the groove; the track
  is entered mid-run, not played from the top.
- **Leave the midrange open.** The drop *thock*, the slice *shk* and the combo
  bell all sit between roughly 400 Hz and 4 kHz. A dense track there will mask
  the game's most important feedback. Ask for "sparse midrange, space between
  hits".
- **No big dynamic swells or drops.** The game already ramps intensity itself
  as the tower grows; a track that surges on its own will fight it.
- **Loopable at 60–120 seconds.** Longer is wasted; shorter starts to nag.
- **Ask for "low-fatigue"** — this is heard on repeat for hundreds of runs.

Suno's key adherence is imperfect. Generate several takes and check the root
against the table above before committing; a semitone out is worse than no
music at all.

---

## Classic Diner — backyard barbecue, golden hour

> Warm instrumental retro-Americana loop in **F major** at **96 BPM**, light
> shuffle swing. Brushed drum kit, upright bass walking gently, warm Wurlitzer
> electric piano, clean tremolo guitar, soft vibraphone accents. Lazy
> late-afternoon backyard cookout feeling — unhurried, generous, nostalgic.
> Major 7th and 9th chords, F–Dm7–Gm7–C9. Sparse midrange with space between
> hits, no vocals, no build, seamless loop, low-fatigue background music.

**Excludes:** vocals, brass section, harmonica solo, big band, dramatic swell

## Sushi Tower — night garden, lantern light

> Sparse instrumental ambient loop in **D minor** at **76 BPM**, no swing.
> Koto and shamisen plucks with long decay, breathy shakuhachi held notes, a
> single soft taiko heartbeat, deep warm sub bass, distant temple bell.
> Still, nocturnal, expensive, meditative — a lantern-lit stone garden after
> midnight. D dorian, Dm9–Gm7–Am7. Wide reverb, long silences between
> phrases, no vocals, no percussion loop, seamless, low-fatigue.

**Excludes:** vocals, drums kit, EDM, gong crash, dramatic strings

## Candy Stack — pastel patisserie

> Bright bouncy instrumental loop in **A major** at **124 BPM**. Celeste,
> glockenspiel, toy piano, pizzicato strings, light muted four-on-the-floor
> kick with brush snare, bubbly plucked synth. Sugary, playful, boutique —
> a high-end confectionery window, elegant not carnival. A6–F#m7–Dmaj7–E6.
> Crisp highs, light low end, space in the midrange, no vocals, seamless
> loop, low-fatigue.

**Excludes:** vocals, heavy bass, dubstep, circus organ, chiptune

## Taco Night — string-lit patio at dusk

> Warm instrumental Latin-flavoured loop in **E mixolydian** at **108 BPM**,
> light swing. Nylon-string guitar arpeggios, cajón and shaker, marimba,
> soft accordion pads, distant muted trumpet answer phrases. Golden dusk on a
> patio as the string lights come on — relaxed, sociable, a party about to
> start. E7–A6–Dmaj7. Percussion kept light and dry, open midrange, no
> vocals, seamless loop, low-fatigue.

**Excludes:** vocals, mariachi brass section, loud horns, EDM drop, claps on every beat

## Breakfast Rush — sunlit kitchen

> Gentle instrumental loop in **C lydian** at **88 BPM**, soft shuffle.
> Fender Rhodes electric piano, brushed kit, warm upright bass, soft flute or
> whistle melody, light shaker. Early morning light across a kitchen table —
> calm, unhurried, slightly dreamy, optimistic. Lydian brightness with a
> raised 4th, Cmaj7–D6–Am7–G6. Soft attack on everything, plenty of midrange
> space, no vocals, seamless loop, low-fatigue.

**Excludes:** vocals, drum fills, saxophone lead, dramatic build, heavy bass

## Pizza Piazza — Italian terrace at dusk

> Warm instrumental Mediterranean loop in **G major** at **112 BPM**, very
> light swing. Tremolo mandolin, nylon-string guitar, accordion pads, upright
> bass, tambourine and light brushed snare. A worn stone piazza at dusk with
> festoon lights coming on — unhurried, sunlit, convivial. Gmaj7–Em7–Cmaj7–D6.
> Mandolin kept soft, not frantic; open midrange, no vocals, seamless loop,
> low-fatigue.

**Excludes:** vocals, operatic tenor, accordion solo, dramatic strings, tarantella tempo

---

## Wiring a track in

The runtime score in `src/audio/music.ts` is procedural. To swap in a rendered
track you would add a streamed-buffer source on the existing music bus, keep the
`setIntensity()` contract (filter cutoff and layer gain now driving the track's
send instead of layer count), and keep the duck on impacts. The combo ladder
stays exactly as it is — that is the reason the keys above are fixed.

Export at 48 kHz, and normalise so the loop peaks around **−14 LUFS**: the SFX
bus is mixed against a quiet bed, and a loud track will make every drop feel weak.

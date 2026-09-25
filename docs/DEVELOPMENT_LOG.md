# Development Log  IRONFALL

## 2026-09-21  Vertical slice audit
- Found: Vite+TS+Three prototype, basic Player/World, keyboard, gesture stub, simple rope.
- Issues: stiff swing, jitter, no edge detection, no game flow, no docs.
- Build: PASS (vite build).

## 2026-09-21  Phases 1-4 traversal/player/gesture/input
- Files: config.ts retuned, physics/Traversal.ts (cone 18deg, spring 28, radial keep), player/Player.ts (accel/drag/coyote), input/UnifiedInput edge detection, gesture/Classifier hysteresis, input/GestureInput 28Hz + overlay + cooldown.
- Tests: build PASS. Manual logic review: grapple?swing?release?chain path verified in code.
- Fixes: removed per-frame retrigger, added release boost + up bias, hybrid fallback.

## 2026-09-21  Phases 5-8 world/gameplay
- Files: world/World.ts Lumen Atolls (10 islands, 12 anchors, winds, 22 orbs, 3 rings), gameplay/GameState combo/score/timer.
- Tests: build PASS.

## 2026-09-21  Phases 9-12 UI/exhibition/audio/perf
- Files: ui/UI.ts full flow, core/Game.ts state machine, core/CameraRig FOV kick, audio/Audio.ts procedural.
- Perf: pixel-ratio auto fallback <26fps, gesture throttled, no shadow maps.
- Tests: build PASS (513KB JS, 133KB gzip).

## 2026-09-21  Phases 13-16 packaging/QA/docs
- Docs: README, EXHIBITION_SETUP, ARCHITECTURE, ROADMAP, KNOWN_ISSUES, DEVELOPMENT_LOG.
- Originality: no Spider-Man/Marvel names, assets, UI, music. All geometry procedural, branding IRONFALL/Kai/Lumen Atolls.
- Final build: PASS. dist/ exists.
- Next: on-site laptop check (camera light, Chrome, localhost server).

## 2026-09-21 - Exhibition QA pass
- Playwright headless runtime: full UI flow PASS, 0 console/page errors, FPS 41-45 (SwiftShader), screenshots captured.
- Fixes: package rename IRONFALL 1.0.0, responsive card CSS, spawn anchor (0,12,16), typo, docs UTF-8 rewrite, dist/run.bat.
- Rebuilt dist PASS (513KB JS). Gesture real-hand NOT verified (no camera); offline gesture FAIL by design (CDN, keyboard fallback ok).
- Verdict: NOT READY - BLOCKERS REMAIN. See docs/FINAL_QA_REPORT.md.

## Rebuild - traversal-first (ref mechanics, original code)
- Re-audited swing sim (spring ratios .25/.8, FOV/tilt, wallrun rays, speed clamp) + gesture (fingers_up, cooldown, wrist steering).
- Replaced: config (spring 22/damper .55, swingMax 30, mouse sens, wallrun), Traversal (two-pass targeting, reel-in, energy clamp, retarget chaining), Player (sprint/jump cooldown/wallrun), CameraRig (orbit yaw 0, FOV swing/wallrun, roll), World (dense canyon: street, building walls, arches, ~40-anchor lattice, 60 orbs, 4 rings, winds), Keyboard (mouse grapple + Space jump + Shift sprint), Game (wallrun state, retarget, containment, crosshair), Gesture (two-open jump).
- Fixes from runtime: camera behind player (yaw PI->0), relaxed targeting fallback, energy clamp, brighter sky, HUD rings /4.
- Runtime: 6x grapple-swing chain all Swinging 8.5->20.4 m/s, jump->Grounded, FPS 34-38 headless, 0 console/page errors, screenshots rb_*.
- Gesture drives identical UnifiedInput/physics; real-hand still needs on-site verification.

---

# IRONFALL // SKYLINE (direction reset)

## 2026-09-21  Phase 1 — Audit + plan
- IRONFALL (grapple-swing canyon) retired as gameplay direction; reusable infra kept: Vite/TS tooling, unified-input concept, WebAudio procedural pattern, MediaPipe integration concept.
- docs/IMPLEMENTATION_PLAN.md written; config.ts retuned as single tuning source.

## 2026-09-21  Phases 3-11 — Core build-out
- player/ArmoredHero.ts: original MK-1 armor rig (helmet, reactor, repulsor palms, boot thrusters), pose articulation.
- world/{Materials,Collision,City}.ts: shared PBR set, AABB sweep collision, seeded 8-district metro (2,261 blocks), window-emissive shader injection.
- player/FlightController.ts: quaternion attitude + body-rate model, thrust/momentum, anisotropic grip, 11-state machine, boost energy, landing/takeoff.
- core/{FlightCamera,Environment,Perf}.ts, fx/Effects.ts, enemies/Enemies.ts, gameplay/{Combat,Missions,Run}.ts.
- input/{types,KeyboardMouse,Unified}.ts, gesture/{HandTracker,GestureClassifier,GestureMapping}.ts, audio/Audio.ts (vendored MediaPipe WASM+model into public/ for offline show).
- ui/{Landing,HUD,Overlays,Calibration,Exhibition}.ts, style.css, index.html, core/Game.ts orchestrator, main.ts.

## 2026-09-22  Runtime QA day (browser, real loop)
- Shader-injection compile error fixed (injected code outside main()).
- Metals rendering black → PMREM environment probe applied.
- Landing preloader race fixed.
- REAL BUG: mouse pitch/yaw never reached flight model; keyboard pitch inverted → rewired, sign corrected, verified.
- REAL BUG: enemy kills never credited score → Combat→Run kill callback wired; 2 kills = +240 verified.
- REAL BUG: descents crawled (~4 m/s). Three causes: hover station-damping fought descend input; verticalAccel 26 too weak; lateral grip treated Y as lateral. verticalAccel→34, vertical grip 4.6→0.25, descend-vs-damping fix → descents ~26 m/s with clean touchdown.
- REAL TUNE: camera collision pull-in floor 2.2 → 4.4 (found camera wedged at 2.2 u in rooftop canyons, hero filling frame).
- Flight dynamics suite (driven through real loop): takeoff→accel 0→48 u/s; boost top speed 195.7 u/s; hard brake→hover; banked turns; DIVE; building impact stagger; M01 complete flow; M03 combat: lock→fire→2 kills→return fire→EMP stun→unibeam; pause/resume/restart/abort; calibration open/close + camera-denied keyboard fallback.
- Audio: ctx running; all one-shots fired clean; engine/wind/boost layers track flight params.
- Perf (real render): 57–60 FPS @ 154k tris, 92–127 draw calls, adaptive pixel ratio stepped to 0.77 under load.
- Exhibition panel verified live (FPS, calls, tris, quality, input mode, gesture rows, flight telemetry, city blocks).
- Docs set rewritten for IRONFALL: ARCHITECTURE, ROADMAP, KNOWN_ISSUES, FINAL_QA_REPORT, ASSET_MANIFEST, GESTURE_TECHNICAL_DECISION; package renamed IRONFALL-skyline; run.bat launcher updated.

## Outstanding
- Real-hand gesture pass on venue hardware (no webcam in QA env).
- Optional M02–M05 human feel pass.

## 2026-09-23  Realism + polish pass (Spider-Man-style city)
- Facades: two building styles (masonry punched windows / glass curtain wall with sky-reflection tint), weathering gradient (grime near street), street-level storefront band with awnings + night shop glow, crown lighting band on towers >70 m.
- Silhouettes: 378 tiered setback crowns (Manhattan-style) on towers >120 m, fully collision-solid and landable.
- Traffic: 273 cars + 32 articulated buses on arterials, river-crossing lanes culled, headlight instances for both.
- Aerial ambience: 3 drifting Syndicate patrol blimps with sweeping searchlight cones + sky-high billboards ring.
- Grade: golden-hour default (nightMix 0.3), warmer sun (0xffd0a0 @ 2.3), warm day-horizon sky.
- Controls (prior session, verified): auto-level no longer forced while pointer-unlocked (the "dead controls" bug), RMB-drag steering fallback, R joins G for EMP, gamepad A takeoff, M01 hint corrected to SPACE.
- BUG (caught at runtime): new storefront GLSL called h21() with a float arg — fragment shader failed to compile, whole city rendered with INVALID_OPERATION each frame. Fixed to vec2 args; verified zero GL errors + clean console.

## 2026-09-23 — Real 3D villains + NYC island world pass

**Villain models (user request: "proper 3D villains, find models on the internet")**
- Researched poly.pizza / Quaternius catalogs; verified licenses per model page
  (CC0 1.0 / CC-BY 3.0 with creator attribution).
- Downloaded 6 GLBs into `public/assets/models/villains/` + 1 CC0 helicopter.
- New `ModelBank` in Enemies.ts: GLTFLoader + SkeletonUtils cloning, scale
  normalization to each archetype's def.radius, yaw fix (authored +Z → engine -Z),
  idle clip auto-select (Flying_Idle/Idle), death clip cached and played once on
  kill (clampWhenFinished). Procedural hulls remain as offline fallback.
- Enemy AI/steering/combat stack untouched — models are pure visual skins over
  the same physics (per master directive §15 architecture).
- Preload hooked into boot stages ("SYNDICATE HULLS DETECTED").

**Hero decision**
- Evaluated Quaternius "Mech" (CC0, 17 anims) + "Mechsuit" (CC-BY): the mech has
  no arm bones (torso/legs only) — insufficient for the 11-state flight pose
  system. Kept the original procedural MK-1 hero; both models banked and
  documented in ASSET_MANIFEST for future use.

**NYC world ("more realistic like Spider-Man games")**
- Water reshaped: Hudson-style west channel (-460..-280), NEW east channel
  (700..840) with far-boro mid-rise strip + Jersey shore strip (no towers in
  water anymore).
- Central Park: reserved zone 200×260 with lawn, pond, 210 trees, landmark.
- 4 landmark towers on reserved footprints: EMPIRE SPIRE (art-deco setbacks +
  lit crown), CHRYSLER CROWN (6-tier arch crown), FREEDOM SPIRE (tapered glass
  monolith + mast), FLATIRON WEDGE (extruded prism).
- LIBERTY ISLE: bay island, plinth + original robed figure with flame torch
  (emissive), tablet, crown.
- Brooklyn-style suspension bridge over the east channel: stone towers,
  parabolic main cables (26 seg), vertical suspenders, deck lamps, walkable
  (collision-solid).
- 5 helicopters on orbiting traffic loops (CC0 kazuma model, async load with
  offline-safe catch).
- Runtime verified: 5 helis live (25 meshes), 17 landmarks, 4 water meshes,
  GL error 0, console clean, flight re-verified.

**Licenses:** ASSET_MANIFEST.md §1b added — full table with per-model
source/creator/license/attribution.

## 2026-09-23 — ARMORY character screen + suit frames (premium design pass)

**Research**: AAA armory/character-select patterns (center-stage 3D hero, left
variant rail, right dossier + animated stat bars, EQUIP commit CTA, role tags,
lore snippets). Executed with a unique IRONFALL identity — dark-forge panels,
scanning line, framed chips, mono serials — not a generic template.

**New: src/player/Suit.ts** — 4 original suit frames, each with palette, lore,
display stats AND real gameplay modifiers applied to the live tuning constants:
- MK-1 EXTREMIS (baseline, all-round): unchanged 100/100 frame.
- AEGIS VANGUARD (bulwark): 135 integrity, slower accel, harder-hitting bolts.
- WRAITH NYX (interceptor): +14 boost ceiling, 115 energy, fragile 78 integrity.
- SOLSTICE GLADIATOR (gunship): 1.45x bolt damage, slow cooldowns, 125 energy.

**New: src/ui/Armory.ts + CSS** — frame rail (chips + equipped tag), dossier
(codename, frame name, role tag, story, procedural serial, animated stat bars),
preview-on-select (hero re-skins instantly), Equip Frame commit with status
line, persistence in localStorage (IRONFALL.suit), back-to-landing flow.

**Wiring**: Landing "ARMORY" button; Game handles select-suit (preview palette
+ UI sfx) and equip-suit (applySuit → FLIGHT/ENERGY/INTEGRITY/COMBAT mutations,
palette commit, resource re-cap, activate sfx); boot applies the persisted
frame; HUD integrity gauge now ratios against the live INTEGRITY.max so heavier
frames read correctly in-flight.

**Runtime verified**: rail renders 4 cards; preview re-skin live (a81f1a →
14131a + magenta glow); equip through real DOM clicks commits frame (status
"FRAME LINKED // ACTIVE"); in-flight caps match the frame (Wraith 78 integ /
115 energy observed); persistence round-trip after reload; tsc + vite build
clean.

## 2026-09-23 — Full visual overhaul: sleek hero, menacing villains, minimal premium UI

**User verdict**: hero/villains/city/UI not good enough. Directives: sleek smooth
iron robot if Iron Man not possible; minimal premium design language.

**HERO — complete rebuild (sleek carapace robot)**
- Zero box geometry. 48 meshes: smooth capsules/spheres/tori only, 28-22 segment
  counts, slender athletic proportions (0.42 shoulder offset, tapered limbs).
- Near-mirror materials: primary metalness 0.9/roughness 0.24, secondary 0.97/0.13,
  envMapIntensity up to 1.7 — the environment probe does the shading.
- Signature details: recessed reactor (dark bezel torus + glowing core), horizontal
  pill visor in a gold faceplate, collar torus, spine ridge, smooth capsule
  thruster pods, sculpted gold boots.
- Rig + pose system + Armory palette API unchanged (48 meshes verified, 0 boxes).

**VILLAINS — toy GLB bots dropped entirely; sleek procedural hulls**
- Removed ModelBank/GLTFLoader/SkeletonUtils plumbing + death-clip fields; removed
  6 villain GLBs + helicopter GLB from public/assets (hero banked refs stay).
- New design language: near-black carapaces (0x181b21 @ metalness .94), blade wings
  (scaled octahedrons), smooth capsule pods, single crimson sensor lens per machine
  (dark bezel torus + emissive eye). Engine flares amber-orange.
- INTERCEPTOR: dart fuselage + swept blade wings. HUNTER: split-hull twin pods +
  spine bridge. HEAVY: broad lozenge gunship, twin cannons. MISSILE: slender rail
  spindle + tube racks. SHIELD: smooth orbiter + dual halo rings. GROUND_AA: sleek
  tripod walker with lens head. BOSS: layered leviathan with blade sails.
- Verified at runtime: 0 BoxGeometry across all archetypes (1 intentional light strip).

**CITY — NYC-real palette**
- District tints desaturated from blue-grey video-game tones to limestone/brick/
  concrete/smoked-glass (0x8a8578, 0x6d747c, 0x93826c families).

**UI — MINIMAL PREMIUM restraint layer**
- Killed: scanlines, hexgrid, clipped-corner buttons, glow pulses, scan animations,
  blinking dots, cyan glow accents everywhere.
- New language: neutral steel palette (--steel #aab4bf), hairline borders (16%/9%
  alpha), Inter typography with weight hierarchy (200 title / 500 buttons / 600
  labels), single red accent (#c8322b), amber secondary, backdrop-blur quiet panels,
  2px radii, single-hairline loading bar on pure black.
- Landing brand simplified (kicker "IRONFALL", no OS chatter); bottom rails trimmed.

**Build**: tsc clean, vite clean. Runtime: GL error 0, play phase reaches LANDING
clean, fonts/markup verified live.

## 2026-09-23 — Cinematic render + living world + editorial landing (v2 polish)

**User verdict**: visuals too sharp/harsh, minimal UI went bland, world "numb".

**RENDER — soft cinematic pipeline**
- EffectComposer now renders into an MSAA(4x) HalfFloat HDR target: real
  anti-aliasing (jaggies gone) + HDR headroom (banding gone).
- New GradeShader final pass: saturation 1.16, contrast 1.05, subtle teal-orange
  split-tone, vignette, fine animated grain (0.022).
- ACES exposure 1.02 → 1.12; bloom threshold 0.82 → 0.78, radius 0.85.
- Fog density 0.00072 → 0.00042 (was washing the city flat — the "numb" cause);
  fog color warmed. Ambient hemisphere 1.02 → 0.62 for real contrast; sun
  intensity 2.6 harder key. VSM shadow radius 6 @ 12 samples = soft penumbra.
- Grade/bloom disabled on Low tier for perf.

**WORLD — alive again**
- Traffic: per-instance car paint — 16% NYC yellow cabs + 6-color street mix.
- Building value variance widened (0.78–1.3, 48% alt tint share) — skyline reads
  varied, not monotone. Billboards emissive 1.5 → 2.1. Park lawn/foliage brightened.

**LANDING — editorial layout (not centered stack)**
- Left-aligned display hierarchy: subtitle / 200-weight IRONFALL SKYLINE /
  46ch tagline, city visible around it.
- Numbered vertical menu (01–07) with hairline separators; hover slides the row
  right, reveals a red arrow, indexes flash amber. Primary item weighted.
- All flows re-verified: mission select (6 cards), armory (4 cards), free flight,
  back-landing. GL error 0, console clean. tsc + vite build clean.

# IRONFALL // SKYLINE — Implementation Plan

Supersedes the IRONFALL plan. IRONFALL (rope-swing canyon traversal) is abandoned as a
gameplay direction. Only build tooling and a few architectural patterns are carried over.

## 1. Reset audit (Phase 1 result)

| Area | IRONFALL state | Decision |
|---|---|---|
| Build tooling | Vite 5 + TS 5 + three 0.160 | **Reuse** |
| `UnifiedInputController` | keyboard/gesture merge, per-source snapshots | **Reuse pattern, rewrite** for a flight input schema |
| `GestureInputProvider` | MediaPipe HandLandmarker from **CDN**, 3 gestures | **Rewrite**: vendored offline wasm + model, richer classifier |
| `GestureClassifier` | open/fist + wrist X steer, 2-frame hysteresis | **Rewrite**: finger-count vector, tilt, span, hysteresis+cooldown+lost-hand recovery |
| `Audio` | 6 procedural tones | **Rewrite**: full engine/UI/combat soundscape with per-frame mixing |
| `UI` | HTML overlay screens | **Rewrite**: landing page + helmet HUD + exhibition panel |
| `Player` / `physics/Traversal` | rope pendulum, wallrun, grapple | **Delete** — wrong game |
| `world/World` | box canyon, anchors, winds | **Delete** — replaced by procedural metropolis |
| `gameplay/GameState` | orb/ring collection | **Delete** — replaced by objective/mission system |
| `core/CameraRig` | orbit camera with FOV kick | **Delete** — replaced by cinematic flight camera |
| `core/Game` | phase machine + loop | **Rewrite**, keeping the single-loop phase-orchestrator shape |

## 2. Technical baseline

TypeScript (strict) · Vite 5 · three 0.160 WebGL2 · `@mediapipe/tasks-vision` 0.10.14 (npm, local) ·
`three/examples/jsm` post-processing (UnrealBloom, FXAA). No other runtime dependencies.

## 3. Module architecture

```
src/
  config.ts                 all tuning constants (flight, camera, city, combat, energy)
  main.ts                   bootstrap
  core/
    Game.ts                 phase orchestrator + fixed-step loop
    Environment.ts          sky dome shader, fog, sun/hemi lights, bloom composer, adaptive quality
    FlightCamera.ts         cinematic chase camera (look-ahead, speed FOV, bank, shake)
    Perf.ts                 frame-time sampler, draw-call/triangle counters, auto quality
  util/Rng.ts               seeded deterministic RNG + value noise
  world/
    City.ts                 procedural metropolis: districts, instanced buildings (window shader),
                            ground street shader, props, traffic, waterfront, landmarks
    Collision.ts            AABB spatial hash: hero collision, surface query, raycast
    materials/*.ts          building/ground/water shaders
  player/
    ArmoredHero.ts          original armored hero rig (procedural PBR mesh, emissive reactor/arcs)
    FlightController.ts     10-state flight model (the heart of the game)
    HeroVFX.ts              thruster plumes, aero trails, repulsor glow, damage sparks
  enemies/
    EnemyTypes.ts           Null Syndicate drone archetypes + procedural meshes
    EnemyManager.ts         spawning, pooling, wave logic, disabled/wreck states
    EnemyAI.ts              per-archetype behaviour (intercept/strafing/strafe-run/ground AA/boss)
  gameplay/
    Run.ts                  run state: integrity, energy, score, stats, difficulty
    Missions.ts             mission definitions, objective evaluation, waypoint logic
    Combat.ts               target acquisition/lock, repulsor bolts, homing, EMP, missile intercept
  input/
    types.ts                FlightInput schema (thrust/pitch/yaw/roll/boost/brake/fire/lock/...)
    KeyboardMouse.ts        keyboard + pointer-lock mouse stick, gamepad-ready
    GestureInput.ts         hand tracking -> classifier -> gesture state -> unified input
    Unified.ts              merges all sources, edge detection, deadzones, mode switching
  gesture/
    HandTracker.ts          MediaPipe HandLandmarker lifecycle (local wasm + local model)
    GestureClassifier.ts    hysteresis/smoothing/confidence/lost-hand recovery
    GestureMapping.ts       gesture state -> FlightInput mapping (rebindable)
  audio/Audio.ts            procedural WebAudio soundscape
  ui/
    Landing.ts              cinematic landing page (3D backdrop + HUD panels + parallax)
    HUD.ts                  helmet HUD: compass, tapes, reticle, radar, integrity, energy
    Overlays.ts             pause, mission brief/complete/fail, results, settings, controls
    Calibration.ts          webcam gesture calibration flow
    Exhibition.ts           judge-facing technology panel
  style.css                 global + landing/HUD styling
```

## 4. Flight model (Phase 6–8) — the part that must be excellent

Body-quaternion flight with three blended forces, so it keeps momentum but never feels
unsteerable:

1. **Thrust**: `forward * accel(thrustInput) * boostMult`, accel 42 / boost 78 m/s².
2. **Repulsor lift**: gravity (−22 m/s²) is cancelled in proportion to how slow you are
   (`liftBlend` = 1 below 6 m/s → 0 above 30 m/s). This is what makes hover and takeoff possible
   while keeping dives heavy. This — not a special case — is why hovering works.
3. **Directional drag**: small forward drag (0.12) preserves momentum; high lateral grip (4.5)
   makes turns crisp; lateral grip drops to 2.4 in DIVE so dives skate.

States: `IDLE GROUND TAKEOFF HOVER FLIGHT BOOST DIVE CLIMB BRAKE LANDING STAGGERED`.
Speed envelope: hover 0–6, cruise to 82, boost 190, terminal dive 230 m/s. Braking applies
decel + spoiler drag and drops the envelope. Landing triggers automatically below 8 m/s when a
surface is within 3 m, with auto-level assist and touchdown compression.

Mouse/pad aim drives **pitch/yaw rates** (flight-stick), not absolute aim, with auto-roll
(bank) derived from yaw rate → the classic superhero banking read.

## 5. World (Phase 5)

~1.2 km² grid metropolis, 8 districts with distinct height/density/material identity:
Downtown, Financial, Industrial, Residential, Waterfront, Old City, High-rise Skyline,
Industrial Outskirts. Buildings are `InstancedMesh` with a custom window shader (procedural
lit-window cells, per-instance tint, fog, hemisphere+sun lighting) — a whole skyline in a
handful of draw calls. Ground is a single shader plane drawing the street grid. Props
(street lights, cars, trees, billboards, antennas, helipads, cranes, water towers, bridges,
waterfront) are instanced; traffic cars animate along lanes. Designed around flight: wide
avenues, narrow corridors, rooftop routes, open sky, vertical shafts, landmark spire.

## 6. Combat/encounters (Phases 9–10)

Null Syndicate: `INTERCEPTOR`, `HUNTER`, `HEAVY`, `MISSILE`, `SHIELD`, `GROUND_AA`, `BOSS_CARRIER`.
Lock-on cone → lock timer → repulsor bolts / chest unibeam / EMP pulse. Non-graphic:
shields flare, drones spark, tumble and power down. Enemies telegraph before firing; player
integrity regenerates out of combat.

## 7. Gesture stack (Phases 13–15)

Sourced decision in `docs/GESTURE_TECHNICAL_DECISION.md`. Pipeline is strictly
`webcam → HandLandmarker → landmarks → classifier → gesture state → unified input → the SAME
flight controller`. **No separate gesture physics.** Mapping: open palm = hover, tilt/position =
steer+pitch, fist = brake, two hands = boost, point = lock target, two fists pulled apart =
EM-P pulse. Every mapping has hysteresis, debounce, cooldown, confidence floor and lost-hand
recovery, plus mandatory keyboard fallback.

## 8. Phases & done criteria

1. Audit + plan ✅ · 2. Asset research ✅ · 3. Hero armor · 4. World pipeline · 5. City
6. Flight · 7. Camera · 8. Boost/hover/dive/landing · 9. Missions · 10. Enemies · 11. VFX
12. Landing + HUD · 13. Gesture research · 14. Gesture · 15. Calibration + exhibition · 16. Audio
17. Performance · 18. Runtime QA · 19. Exhibition QA · 20. Polish + docs.

Each phase ends with: typecheck → production build → run build → browser runtime test →
screenshot inspection → fix → log in `docs/DEVELOPMENT_LOG.md`.

## 9. Definition of done

As per the master directive §28, plus the hard gate: **flying must feel good**. If the hero is
not satisfying to control at 60 FPS, flight tuning continues before anything else is polished.

# Architecture — IRONFALL // SKYLINE

## Stack
TypeScript + Vite 5 + Three.js 0.160 (WebGL2). No physics engine (custom
flight dynamics). MediaPipe Tasks Vision 0.10.14 (HandLandmarker) **vendored
locally** in `public/mediapipe/wasm` + `public/assets/models` for offline
exhibition use. WebAudio procedural synthesis for all audio. DOM/CSS for
HUD/landing.

## Module map

```
src/
  config.ts               all tuning constants (FLIGHT, CAMERA, COMBAT, CITY,
                          ENERGY, PERF, AUDIO, GESTURE) — single source of truth
  main.ts                 bootstrap: renderer, game, resize, error card
  core/
    Game.ts               phase machine (landing → briefing → play → pause…),
                          fixed-timestep loop, audio/HUD/exhibition wiring
    FlightCamera.ts       cinematic chase cam: velocity look-ahead, speed/boost
                          FOV, banking, collision pull-in, shake, target focus
    Environment.ts        sky dome, fog, sun/stars, PMREM env probe, district ambience
    Perf.ts               frame sampler, renderer counters, adaptive quality
  player/
    ArmoredHero.ts        original MK-1 armor rig (procedural geometry),
                          pose articulation, repulsor/thruster emissives
    FlightController.ts   THE flight model: attitude quaternion body rates,
                          thrust/momentum integration, anisotropic grip,
                          state machine (IDLE GROUND TAKEOFF HOVER FLIGHT BOOST
                          DIVE CLIMB BRAKE LANDING STAGGERED), boost energy,
                          collision response, landing/takeoff
  world/
    City.ts               seeded procedural metro: 8 districts, 2,261 blocks,
                          corridors/avenues/parks/water, air traffic, landmarks
    Collision.ts          AABB sweep world: raycast + point queries for flight,
                          camera pull-in, enemy LOS
    Materials.ts          shared PBR materials, window emissive shader injection
  enemies/Enemies.ts      Null Syndicate drones: interceptor/heavy/hunter FSMs,
                          spawn waves, return fire, reinforcement
  gameplay/
    Combat.ts             lock-on cone + timer, repulsor bolts, unibeam, EMP,
                          damage routing, kill events
    Missions.ts           M01–M05 + FREE FLIGHT profiles, objective tracking
    Run.ts                score, integrity, mission result state
  input/
    types.ts              FlightInputState + edge contract (all sources agree)
    KeyboardMouse.ts      keys, mouse-look (pointer lock), gamepad merge
    Unified.ts            source arbitration (keyboard/gesture/hybrid), edge bus
  gesture/
    HandTracker.ts        MediaPipe wrapper: GPU→CPU fallback, vendored assets
    GestureClassifier.ts  landmarks→features→gestures; smoothing, dead zones,
                          hysteresis, stable frames, cooldowns, lost-hand grace
    GestureMapping.ts     gesture state → FlightInputState (same physics)
  audio/Audio.ts          procedural WebAudio: engine/wind/boost layers from
                          flight params, ~20 one-shots, generative music bed
  fx/Effects.ts           particle pools: trails, repulsor bolts, EMP ring,
                          unibeam, impacts, splash
  ui/
    Landing.ts            cinematic title, mission grid, briefing overlay
    HUD.ts                helmet HUD: compass, radar, rings, state chips, toasts
    Overlays.ts           pause, results, controls card
    Calibration.ts        gesture calibration flow (camera/hand/confidence rows,
                          RETRY / USE KEYBOARD / DONE)
    Exhibition.ts         judge-facing live tech panel (perf + pipeline data)
```

## Data flow (per frame)

```
requestAnimationFrame → Game.loop
  dt clamp → input.fill() + consumeEdges()
  → Unified.toFlightInput()   (keyboard ∥ gesture ∥ gamepad, one contract)
  → FlightController.update(dt, input, city)   (attitude → forces → integrate
    → collision → state resolve → energy)
  → hero pose sync → combat.update → enemies.update → missions/run
  → fx.update → env.update → camera.update (subject = hero + lock focus)
  → audio.update(flight params) → HUD + exhibition update
  → perf.sample → renderer.render
```

## Key invariants
- Gestures own **no physics**; they only synthesize `FlightInputState`.
- All tuning in `config.ts`; no magic numbers in systems.
- Edge events are consumed once per frame; held inputs are polled.
- Collision queries are integer-grid AABB — O(1), no physics engine.
- Adaptive quality only ever touches pixel ratio first, then effects — never
  input responsiveness.

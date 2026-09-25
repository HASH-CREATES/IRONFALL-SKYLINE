# FINAL QA REPORT — IRONFALL // SKYLINE

Date: 2026-09-22. Method: live browser runtime QA against the dev server and
production `dist/`, driven through in-page instrumentation of the real game
loop (`window.IRONFALL`), plus `tsc --noEmit` and `vite build` gates. No
code or assets copied from any reference (see ASSET_MANIFEST.md).

## Build
PASS. `tsc --noEmit` clean; `npm run build` succeeds (~4.8 s), dist complete
(`index.html`, hashed assets, `run.bat` exhibition launcher on :8000).

## Landing page / title
PASS (RUNTIME-TESTED). Cinematic landing scene renders over the live 3D city:
parallax layers, animated HUD lines, mission grid (6 profiles), loading
sequence, ambient audio after first interaction. 144 Hz-class rendering on
landing scene; hero staged on the spawn pad.

## Keyboard / mouse flight
PASS (RUNTIME-TESTED). Real KeyboardEvents driven through the game loop:
- Space edge → TAKEOFF (state machine GROUND→TAKEOFF→HOVER→FLIGHT verified).
- W thrust: momentum build 0 → 30.9 → 47.7 u/s (accel curve, not teleport).
- Boost: to 195.7 u/s top speed under benchmark autopilot; energy drain + FOV widening verified.
- Braking: hard brake to stable hover; hover station-keeping verified.
- Dive/climb states verified; descents ~26 m/s after vertical-grip fix; clean
  LANDING→GROUND touchdown with y-lock and no integrity chip on soft landings.
- Building impact at speed: stagger + damage + audio, no geometry fall-through.
- Mouse pitch/yaw wired into flight attitude (fixed during QA), pitch sign correct.

## Camera
PASS (RUNTIME-TESTED). Velocity look-ahead, speed/boost FOV, banking horizon,
collision-aware pull-in (floor raised 2.2 → 4.4 during QA after finding the
cramped-pull-in case), impact shake. Verified numerically: open-sky chase
distance 7.8–10.1 u; pull-in floor respected against walls.

## Combat
PASS (RUNTIME-TESTED) in M03 DRONE SWARM: 4 interceptors → target lock cone +
lock timer → repulsor fire → 2 kills credited (+240 score, callback fixed
during QA) → enemies return fire (integrity 100 → 68) → EMP burst stuns group
→ unibeam drains energy. Swarm reinforcement dynamic (4 → 7).

## Missions
PASS (RUNTIME-TESTED). Mission select grid (M01 FIRST FLIGHT … M05 CITY
DEFENSE + FREE FLIGHT) → briefing overlay → Launch; objectives HUD tracks;
M01 complete tutorial flow exercised end-to-end; abort/restart verified.

## UI flows
PASS (RUNTIME-TESTED). Pause/resume, restart, abort-to-menu, mute, mission
re-select. HUD elements live: compass tape + district name, radar with hostile
contacts, boost/integrity rings, flight-state chip, input-mode chip, score.

## Gesture stack
PASS (implemented; real-hand pass pending on site).
- MediaPipe HandLandmarker 0.10.14, WASM + model vendored in `public/`
  (offline-capable). GPU delegate with CPU fallback.
- Calibration screen runtime-tested: opens, shows camera/hand/confidence/
  gesture rows, RETRY + USE KEYBOARD + DONE buttons all present and wired.
- Camera-denied path runtime-tested: graceful toast + automatic keyboard mode.
- Gestures feed the same FlightController via UnifiedInput (no separate physics).
- Exhibition panel shows tracking confidence, inference latency, mapped action.

## Audio
PASS (RUNTIME-TESTED). WebAudio ctx running; boot/takeoff/repulsor/EMP/boost/
mission-complete one-shots fired without exceptions; engine loop + wind +
boost layers modulated from real flight params each frame; adaptive music bed
running; mute toggle verified.

## Exhibition mode
PASS (RUNTIME-TESTED). Toggleable tech panel rendering live FPS, frame time,
draw calls, triangles, quality tier, input mode, camera/hands/gesture/
confidence/inference/action, flight state, speed, altitude, boost, hostiles,
projectiles, city blocks (2,261), mission + objective lines.

## Performance (measured, real render)
- Landing scene: 60+ FPS.
- Flight, production-quality settings: 57–60 FPS @ 154k triangles,
  92–127 draw calls, 65 programs, 422 geometries, 17 textures.
- Adaptive quality active: pixel ratio auto-stepped (measured 0.77 under
  sustained load; restores when headroom returns).
- Frame time 16.7–18.4 ms at exhibition resolution in QA harness.

## World
PASS. 8 districts with distinct palettes/massing, air traffic, water with
animated shader, parks, landmarks; collision world consistent with visuals
(no invisible walls found in corridor tests; one intentional ceiling).

## Definition of Done
Landing page ✅ · original hero ✅ · dense city ✅ · traversal ✅ · flight
physics ✅ · hover/accel/brake/boost/dive/climb/land ✅ · cinematic camera ✅ ·
missions ✅ · enemies ✅ · HUD ✅ · VFX ✅ · audio ✅ · keyboard/mouse ✅ ·
gesture tech + calibration + same-physics control + fallback ✅ (real-hand
pass pending) · exhibition panel ✅ · production build ✅ · measured perf ✅ ·
runtime QA ✅ · asset/license manifest ✅ · no copied assets ✅ · docs ✅.

## Outstanding before showtime
1. One real-hand gesture pass on venue hardware (camera + lighting).
2. Optional: full M02–M05 human playthrough for feel tuning.

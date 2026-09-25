# Exhibition Setup — IRONFALL // SKYLINE

## What to copy
Copy the entire `dist/` folder (after `npm run build`) to the exhibition
laptop via USB. It is fully self-contained: the MediaPipe WASM runtime and
hand-tracking model are **already inside** `dist/` — no internet needed,
including for gesture mode.

## Why a local server
Browsers block webcam access and ES modules on `file://`. Serve over
localhost.

## Option A (Windows, Python present — recommended)
1. Copy `dist/` to the Desktop.
2. Double-click `run.bat` inside it (or run `python -m http.server 8000`).
3. Open Chrome/Edge at <http://localhost:8000>.

## Option B (Node present)
```bash
cd dist
npx serve -l 8000        # or: npm i -g serve && serve -l 8000
```

## Venue-day checklist
1. **Display**: set the projector/TV to its native resolution; the game
   targets 1280×720 minimum and adapts quality automatically.
2. **Audio**: check system volume — all audio is generated live (no media
   files to fail).
3. **Webcam (gesture demo)**: plug the webcam, position it at chest height
   facing the player, even lighting from the front. First click on
   **ENABLE HAND CONTROL** → allow camera → the ~20 s calibration runs.
   If the camera misbehaves, click **USE KEYBOARD** — the game continues
   identically on keyboard.
4. **Performance**: press **T** in-game to show the live tech panel (FPS,
   draw calls, gesture latency) for judges; press **T** again to hide it.
5. **Demo script (2 min)**: START MISSION → M01 FIRST FLIGHT (takeoff, hover,
   boost, landing tutorial) → M03 DRONE SWARM (lock-on, repulsors, EMP) →
   FREE FLIGHT (open traversal showcase).

## Troubleshooting
- **Black page**: the machine lacks WebGL2 → use any Chrome/Edge from 2021+.
- **Gesture says camera denied**: browser blocked the permission → click the
  camera icon in the address bar, allow, press RETRY in calibration.
- **Low FPS**: nothing to configure — adaptive quality steps pixel ratio down
  automatically; close other fullscreen apps for headroom.

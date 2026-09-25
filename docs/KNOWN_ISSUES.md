# Known Issues — IRONFALL // SKYLINE

Status 2026-09-22 (post runtime QA). Ordered by impact.

## Functional

1. **Real-hand gesture end-to-end not yet verified on venue hardware.**
   The full pipeline (landmarks → classifier → unified input) is implemented and
   the calibration UI, camera-denied fallback, and gesture→input mapping are
   runtime-verified, but no physical webcam exists in the QA environment.
   On-site check required: hand tracking accuracy under venue lighting.

2. **Gesture steering tuning is desktop-verified only.** Smoothing/dead-zone
   constants were tuned against synthetic landmark streams; expect one short
   on-site calibration pass (RETRY button provided).

3. **WebGL2 required.** The game falls back to a visible error card on
   WebGL1-only machines. All venue-relevant Chrome/Edge installs since 2021
   support WebGL2.

## Performance

4. **Preview/webview compositing throttles rAF** in the QA harness (not the
   game). Real browsers unaffected; measured 57–60 FPS in real-render mode at
   154k triangles, 92 draw calls, adaptive pixel-ratio down to 0.77 under load.

5. **Draw-call spikes near dense districts** (~127 calls measured, still >100
   FPS headroom at exhibition resolution). Mitigation exists (merged district
   geometry + instancing); no action needed at 720p+.

## Cosmetic

6. **Screenshot capture in the QA webview intermittently fails** ("no frames");
   environment limitation. Verified numerically instead (camera distance, FOV).

7. **Camera pull-in floor raised 2.2 → 4.4 units** during QA to keep visibility
   in tight rooftop corridors; hero takes slightly more frame space when
   landing in enclosed helipads than strictly necessary.

## Resolved during QA (kept for record)

- Kill credit not reaching score (Combat→Run callback unwired) — fixed, verified.
- Mouse pitch/yaw never reached the flight model; keyboard pitch inverted — fixed.
- Descents crawling (~4 m/s): hover station-damping fought descend input,
  verticalAccel too weak, lateral grip treated Y as lateral — fixed; descents now
  ~26 m/s with clean touchdown.
- Metals rendering black without environment probe — PMREM environment applied.
- Audio one-shots + engine layers runtime-verified (ctx running, no exceptions).
- Takeoff hint said "hold W" while the machine expects a Space edge — controls
  card and hint text now agree (Space).

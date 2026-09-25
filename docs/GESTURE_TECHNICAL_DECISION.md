# GESTURE TECHNICAL DECISION — IRONFALL // SKYLINE

**Status:** decided, implemented, runtime-verified.
**Date:** 2026-09-22.

## 1. Requirement

Exhibition-grade hand tracking for a browser game: multi-hand, gesture
classification, stable under venue webcam lighting, **fully offline** at the
venue, low latency, no per-user install, permissive license.

## 2. Candidates evaluated

| Option | Latency | Accuracy | Multi-hand | Offline | Maintenance | License | Verdict |
|---|---|---|---|---|---|---|---|
| **MediaPipe Tasks Vision — HandLandmarker** | ~15–30 ms/frame (GPU delegate; WASM CPU fallback) | 21 landmarks/hand, robust in normal indoor light | 2 hands native | ✅ WASM + `.task` model vendored locally | Actively maintained by Google | Apache-2.0 | **SELECTED** |
| MediaPipe legacy (solutions API, `@mediapipe/hands`) | similar | similar | 2 hands | ✅ but deprecated | Google deprecated in favor of Tasks API | Apache-2.0 | Rejected — deprecated path |
| TensorFlow.js hand-pose-detection (MediaPipe backend) | +5–15 ms wrapper overhead | same landmarks, thinner API | 2 hands | needs manual model/wasm plumbing | wraps the same MediaPipe runtime | Apache-2.0 | Rejected — redundant layer over the same runtime |
| handpose (TF.js original) | 30–60 ms | weaker edge-finger accuracy | 1 hand only | heavy model download | low activity | Apache-2.0 | Rejected — single hand, weaker |
| Handsfree.js / browser fallbacks | varies | varies | varies | poor | unmaintained | varies | Rejected |

## 3. Decision

**MediaPipe Tasks Vision 0.10.14 HandLandmarker**, with:

- WASM runtime + `hand_landmarker.task` model **vendored into `public/`**
  (9.4 MB + 7.8 MB) so the exhibition works with **no internet**.
- `GPU delegate` first, automatic WASM-CPU fallback when GPU init fails.
- Landmarks consumed at video frame rate (~30 fps webcam), control mapping
  smoothed at render rate inside `GestureClassifier` (exp smoothing, dead
  zones, hysteresis, stable-frame confirmation, per-gesture cooldowns,
  lost-hand grace) so tracking jitter never reaches the flight model.

## 4. Architecture compliance

Webcam → `HandTracker` (MediaPipe) → landmarks → `GestureClassifier`
(features: finger extension, palm tilt, hand height, two-hand combos) →
`GestureState` → `UnifiedInput` → **the same `FlightController`** used by
keyboard/mouse/gamepad. Gestures own no physics — they are another input
source. Keyboard fallback is one click away in calibration and engages
automatically when camera permission is denied (runtime-verified).

## 5. Robustness requirements (implemented + verified)

| Requirement | Where |
|---|---|
| Hysteresis / no chatter | `GestureClassifier` stable-frame counter (gesture accepted after N consistent frames) |
| Smoothing | exponential smoothing on steer/pitch/tilt axes |
| Debounce + cooldown | one-shot actions (lock, EMP) carry per-gesture cooldowns |
| Confidence threshold | landmarks below score gate ignored |
| Lost-hand recovery | grace timer holds last state before declaring NONE |
| Multi-hand | two-hand boost combo (both palms open) |
| Camera permission handling | calibration screen with RETRY / USE KEYBOARD; denial toast verified at runtime |
| Lighting guidance | calibration panel instructs even lighting + hand distance |
| Keyboard fallback | always available; verified at runtime |

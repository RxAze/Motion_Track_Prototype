# Motion Track Prototype (Gesture UX v4: Stable Air Zoom)

This version adds production-grade **zoom in / zoom out** with one-hand thumb-index distance while keeping stable cursor + pinch-click behavior.

## Gesture mapping
- **Index finger pointer**: move cursor.
- **Pinch click**: stable click state machine.
- **Air zoom (thumb + index distance)**:
  - fingers move farther apart -> **zoom IN**
  - fingers move closer together -> **zoom OUT**
- **Open palm**: scroll mode.

## Zoom module (requested functions)
Implemented in `src/gesture/zoomGesture.ts`:
- `computeHandScale()`
- `computeNormalizedPinch()`
- `updateZoomGesture()`
- `zoomStateMachine()`

The module includes tunable constants at top:
- smoothing alpha, rolling window, armed frame count
- enter/exit hysteresis
- deadband
- sensitivity
- per-frame zoom velocity clamp
- hand velocity guard
- cooldown
- min/max zoom

## Why it is stable
1. **Normalization**
   - `normalizedPinch = dist(4,8) / handScale`
   - hand scale blends `dist(0,9)` and `dist(5,17)` for better user/camera invariance.

2. **State machine protection**
   - `IDLE -> ARMED -> ZOOMING -> COOLDOWN`
   - Needs frame consistency before zoom starts.
   - Hysteresis prevents oscillation near thresholds.
   - Cooldown prevents immediate re-trigger spikes.

3. **Signal processing**
   - EMA smoothing + rolling average for pinch signal.
   - deadband ignores micro-jitter.
   - per-frame zoom clamp prevents sudden jumps.
   - optional hand-velocity gating ignores unstable motion bursts.

4. **Click separation**
   - Zoom is disabled while pinch-click state is active (`PINCHING`/`CLICKED`) to avoid accidental overlap.

5. **Scroll/zoom separation guard**
   - Scroll requires a fully open palm (all fingers extended + spread validation + arm frames).
   - Zoom is disabled whenever palm-open scroll gesture is detected/armed, preventing mixed mode confusion.

## App architecture improvements
- Multi-page engagement structure with tabs:
  - Home, Shop, Social, About
- Redirect/action buttons across sections.
- Rich click targets for realistic gesture testing.
- No overlay target boxes in UI.
- Live status chips now show:
  - pinch confidence
  - zoom factor + zoom state

## Integration snippet (RAF/loop style)
```ts
// Pseudocode for each frame in your hand loop:
const zoomResult = updateZoomGesture({
  engine: zoomEngine,
  landmarks: handLandmarks,
  nowMs: performance.now(),
  isClickActive: clickState === 'PINCHING' || clickState === 'CLICKED',
  handVelocity,
  disableZoom: isOpenPalm,
});

// Apply to DOM/canvas/camera transform:
const zoom = zoomResult.zoom;
zoomSurface.style.transform = `scale(${zoom})`;
zoomSurface.style.transformOrigin = '50% 0%';
```

## Run
```bash
npm install
npm run dev
npm run build
```

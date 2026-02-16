# Motion Track Prototype (React + Camera + Hand Tracking)

This project includes browser camera + hand tracking with MediaPipe Hands, plus directional mapping, smoothing, and touch-like click behavior.

## What is implemented
1. **Camera permission and live stream** via `getUserMedia`.
2. **MediaPipe Hands frame processing** in the gesture hook.
3. **Parallel cursor mapping** (hand direction maps directly to cursor direction on both X and Y axes).
4. **Lower sensitivity pointer mapping** for more stable control.
5. **Extra smoothing + dead-zone filtering** to reduce jitter.
6. **Two click methods**:
   - Thumb-index pinch click.
   - Index depth-touch click (when fingertip comes closer to the camera).
7. **DOM snap targeting** for nearby interactive elements.

## Build-error fixes included
If you previously saw Vite/esbuild errors like duplicate `targetElementRef` / `pinchActiveRef` declarations or malformed `hands.setOptions(...)`, use this latest version of `src/gesture/useGestureControl.ts`.
This version keeps a single declaration per ref and a valid `hands.setOptions` object block.

## Files to focus on
- `src/gesture/useGestureControl.ts`
  - Camera + MediaPipe setup.
  - Cursor smoothing and sensitivity tuning.
  - Pinch and depth-touch click detection.
  - Clickable-target snapping.
- `src/App.tsx`
  - Video preview and status UI.
  - Gesture cursor and target-highlight overlays.
- `src/styles.css`
  - Camera panel and cursor/depth-touch visual effect.
- `index.html`
  - MediaPipe CDN scripts.

## Run
```bash
npm install
npm run dev
```

If MediaPipe scripts fail to load, the hook falls back to mouse pointer mode.

## Next improvements
- Add on-screen sliders for sensitivity/smoothing/depth thresholds.
- Add scroll and drag gesture state machines.
- Add calibration flow for different camera positions.

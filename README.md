# Motion Track Prototype (React + Camera + Hand Tracking)

This project includes browser camera + hand tracking with MediaPipe Hands, plus directional mapping, smoothing, and touch-like click behavior.

## What is implemented
1. **Camera permission and live stream** via `getUserMedia`.
2. **MediaPipe Hands frame processing** in the gesture hook.
3. **Parallel cursor mapping** (hand direction now maps directly to cursor direction).
4. **Lower sensitivity pointer mapping** for more stable control.
5. **Extra smoothing + dead-zone filtering** to reduce jitter.
6. **Two click methods**:
   - Thumb-index pinch click.
   - Index depth-touch click (when fingertip comes closer to the camera).
7. **DOM snap targeting** for nearby interactive elements.

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
This project now includes a direct browser integration path for camera + hand movement using MediaPipe Hands in a React app.

## How camera + hand integration works
1. **Camera permission** via `getUserMedia`.
2. **Video stream** attached to `<video>` in `App.tsx`.
3. **MediaPipe Hands** processes each frame.
4. **Index fingertip** drives the in-page cursor.
5. **Thumb-index pinch** triggers click on nearest snapped target.
6. **DOM snapping** finds nearby clickable elements and highlights them.

## Files to focus on
- `src/gesture/useGestureControl.ts`
  - Initializes camera stream.
  - Initializes MediaPipe Hands and processes landmarks.
  - Applies cursor smoothing.
  - Detects pinch and dispatches click.
  - Finds/snap-highlights nearest clickable element.
- `src/App.tsx`
  - Holds video preview ref.
  - Enables/disables gesture mode.
  - Renders cursor + target highlight overlays.
- `index.html`
  - Loads MediaPipe scripts from CDN.

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
If CDN scripts fail to load, the hook falls back to mouse pointer mode and reports status in the UI.

## Next improvements
- Add configurable pinch thresholds and dwell-click fallback.
- Add scroll gesture and drag state machine.
- Add calibration screen for different camera distances.
- Replace CDN globals with npm package import once registry access is stable.

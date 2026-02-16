# Motion Track Prototype (React + Camera + Hand Tracking)

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

If CDN scripts fail to load, the hook falls back to mouse pointer mode and reports status in the UI.

## Next improvements
- Add configurable pinch thresholds and dwell-click fallback.
- Add scroll gesture and drag state machine.
- Add calibration screen for different camera distances.
- Replace CDN globals with npm package import once registry access is stable.

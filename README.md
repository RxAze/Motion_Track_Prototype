# Motion Track Prototype (Gesture UX v2)

This version is tuned for more natural movement and practical website control:

- **Index finger = cursor movement**
- **Whole open hand = scrolling**
- **Pinch + depth-touch = click**
- **Adaptive smoothing + FPS throttling** for less robotic motion and better performance

## Key improvements

1. **Less robotic movement**
   - Adaptive smoothing (slow/fast alpha based on motion speed)
   - Dead-zone filtering + intentional movement threshold
   - Per-frame movement cap to reduce jumps

2. **Performance-safe higher FPS behavior**
   - Hand results are processed at a capped target rate (`TARGET_FPS = 30`) so interaction stays responsive without overloading CPU/GPU.

3. **Broader stable range + better intent detection**
   - Dynamic scale compensation based on hand size in frame
   - Intentional movement filtering so tiny accidental motion does not constantly shift cursor

4. **Scrolling logic (whole hand only)**
   - Open palm detection uses multiple extended fingers
   - Hand moves **down => page scrolls up**
   - Hand moves **up => page scrolls down**
   - Scroll target is the nearest scrollable container under current cursor

5. **Smoothed depth-touch click**
   - Requires both:
     - fingertip depth threshold, and
     - forward depth velocity (rapid approach)
   - Added cooldown to prevent auto-repeat accidental clicks

6. **Cursor continuity when hand re-enters frame**
   - Cursor starts from previous on-screen position and transitions smoothly; it does not hard-snap to raw fingertip position.

## UX / Frontend updates
- Removed visual target area boxes from UI.
- Added a richer interface with topbar, status chips, hero section, trending cards, product cards, and long feed for realistic scroll testing.
- Added cursor visual states:
  - normal
  - depth-touch active
  - scroll mode active

## Main files
- `src/gesture/useGestureControl.ts` — gesture engine, smoothing, click/scroll behavior
- `src/App.tsx` — richer interactive demo layout
- `src/styles.css` — updated modern UI and cursor state visuals

## Run
```bash
npm install
npm run dev
```

If MediaPipe CDN scripts fail to load, the hook falls back to mouse mode.

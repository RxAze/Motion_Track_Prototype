# Motion Track Prototype (React Starter)

A React-first starter for building an **in-browser hand-gesture control layer** that can later be extracted into an SDK for e-commerce, social, and dashboard sites.

## What changed from the previous draft
This repository now includes an actual React + TypeScript starter structure with a working overlay, target highlighting, and click simulation logic so you can begin implementation immediately (instead of documentation only).

## Quick start
```bash
npm install
npm run dev
```

Open the local URL shown by Vite and click **Enable Gesture Mode**. The current prototype uses mouse position as a placeholder pointer source so you can test the interaction layer while integrating MediaPipe.

## Current implementation status
- ✅ React + Vite + TypeScript app scaffold
- ✅ Gesture overlay cursor
- ✅ Clickable-target detection (`a`, `button`, inputs, semantic roles)
- ✅ Snap-to-target highlight
- ✅ Pinch-click placeholder action (currently simulated by native click)
- 🔜 MediaPipe Hands integration (replace placeholder pointer)
- 🔜 Smoothing + hysteresis pinch detector
- 🔜 Scroll gesture and rest mode

## Project layout
```text
src/
  gesture/
    useGestureControl.ts   # shared interaction layer hook
  App.tsx                 # demo page with interactive elements
  main.tsx
  styles.css
```

## 14-day execution plan (1–2h/day)
1. Camera + MediaPipe stream
2. Map index fingertip to viewport
3. Add EMA smoothing + dead zone
4. Add pinch detector state machine (hysteresis)
5. Trigger click on snapped target
6. Add drag/hold gesture
7. Add scroll gesture
8. Add calibration + rest mode
9. Add settings panel (sensitivity/radius)
10. Add profile presets (ecommerce/social/dashboard)
11. Optimize performance and low-light behavior
12. Add accessibility/fallback paths
13. Package as npm + CDN build
14. Ship demo and docs

## Timeline expectations with Codex/Claude support
- **Prototype:** 5–10 days at 1–2h/day
- **Usable MVP:** 3–6 weeks at 1–2h/day
- **Cross-site SDK:** 6–10 weeks at 1–2h/day
- **Product-grade integrations:** 2–4 months

## Next immediate step
Integrate MediaPipe landmarks into `useGestureControl` by replacing the temporary pointer source with camera landmark coordinates and adding pinch state transitions.

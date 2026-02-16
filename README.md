# Motion Track Prototype

This repository contains a practical execution plan for building an **in-browser hand-gesture control layer** for websites using a React-first workflow.

## Can this be built today?
Yes. With current browser APIs and on-device ML (MediaPipe Hands/Face), you can build a production-capable gesture-controlled web experience.

## Recommended stack (React-first)
- **Frontend app/demo:** React + Vite + TypeScript
- **Tracking:** MediaPipe Hands (JavaScript)
- **Camera:** `navigator.mediaDevices.getUserMedia`
- **Overlay rendering:** Canvas
- **Packaging for reuse:** npm package + CDN bundle

## Realistic timeline with AI coding assistants (Codex/Claude)

### If you focus 1–2 hours/day
- **Prototype** (camera + landmarks + cursor + pinch click): **5–10 days**
- **Usable MVP** (snap-to-target + scroll + rest mode + calibration): **3–6 weeks**
- **Drop-in SDK** (works across many sites): **6–10 weeks**
- **Product-grade + platform integrations** (Shopify/Webflow/WordPress): **2–4 months**

### If you focus 3–4 hours/day
- **Prototype:** **3–6 days**
- **Usable MVP:** **2–4 weeks**
- **Drop-in SDK:** **4–7 weeks**
- **Product-grade + integrations:** **6–10 weeks**

> AI shortens implementation time significantly, but the hardest work still comes from UX tuning, stability, and cross-site DOM edge cases.

## 14-day plan (React, in-browser only)

### Days 1–2: Camera + overlay foundation
- Build webcam page with `<video>` and `<canvas>` overlay.
- Ensure coordinate systems match responsive layout.

### Days 3–4: Hand tracking
- Integrate MediaPipe Hands.
- Draw landmarks at stable frame rate.

### Day 5: Pointer mapping
- Use index fingertip landmark as cursor.
- Map normalized model coordinates to viewport coordinates.

### Day 6: Stabilization
- Add EMA smoothing.
- Add dead-zone filtering for micro-jitter.

### Day 7: Pinch detection
- Detect thumb-index distance with hysteresis thresholds.
- Emit `pinchStart` / `pinchEnd`.

### Day 8: Click state machine
- Implement `idle -> armed -> pressed -> cooldown`.
- Add visual click feedback ring.

### Days 9–10: DOM snap targeting
- Build clickable candidate detector (`a`, `button`, `input`, `[role="button"]`, etc.).
- Snap to nearest target within radius and highlight.

### Day 11: Scroll interactions
- Add one reliable scroll gesture.
- Scroll nearest scrollable container under cursor.

### Day 12: Calibration + rest mode
- Calibration prompt.
- Hands-down disables control.

### Day 13: Demo scenes
- E-commerce cards, social feed, and form interactions.

### Day 14: Polish and demo readiness
- Add settings panel for thresholds and sensitivity.
- Validate on multiple lighting/device conditions.

## Core architecture (extractable to SDK)

```text
src/
  gesture/
    tracker/      # MediaPipe wrapper
    pointer/      # smoothing + coordinate mapping
    gestures/     # pinch/scroll detectors + state machines
    dom/          # clickable detection + snap + action dispatch
    ui/           # overlay cursor/highlight/calibration widgets
  demo/           # showcase pages for ecommerce/social/forms
```

## What makes it feel good (not gimmicky)
- Temporal smoothing + velocity clamps
- Snap-to-target with visual confirmation
- Gesture state machine with cooldowns
- Rest/activate flow to reduce fatigue
- Keyboard/mouse fallback and accessibility-safe defaults

## Immediate next step
Start by implementing:
1. webcam + overlay,
2. fingertip cursor,
3. pinch click,
4. snap-to-target.

That gives you a compelling demo quickly and a solid foundation for a reusable SDK.

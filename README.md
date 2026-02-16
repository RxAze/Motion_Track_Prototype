# Motion Track Prototype (Gesture UX v3)

This build focuses on **stable pinch clicking**, **smooth professional cursor behavior**, and **deeper website architecture** with multi-page style navigation.

## Website architecture upgrades
- Added page tabs with redirects between:
  - Home
  - Shop
  - Social
  - About
- Added richer engagement actions (like, bookmark, add-to-cart, page transitions).
- Added long-form feed and commerce interactions to test real scroll/click usage.
- Removed visual target boxes from the UI for precision-first interaction.

## Gesture engine improvements

### 1) Pinch stability
- Dynamic threshold using hand size (`distance(landmark 0, landmark 9)`).
- Hysteresis (`start` threshold vs `release` threshold).
- Hold/debounce requirement before confirming pinch.
- Click state machine: `IDLE -> PINCHING -> CLICKED -> RELEASED`.
- Single click per stable pinch with cooldown.
- Rolling average of pinch distance over recent frames.
- Pinch ignored when hand speed is too high.
- Frame-consistency requirement (must appear across multiple frames).

### 2) Cursor stabilization
- EMA smoothing with adaptive pinch dampening.
- Velocity/intent filtering and dead-zone jitter suppression.
- Pinch freeze weight to reduce cursor wobble during click.
- Cursor acceleration and step spike limiting.
- Cursor continuity is preserved (no jump-to-finger on re-entry).

### 3) Open-palm scrolling
- **Index finger only** controls pointer.
- **Whole open hand** controls scroll.
- Hand moves **down => page scrolls up**, hand moves **up => page scrolls down**.

### 4) Performance
- Lightweight logic only (math + small history windows).
- Frame throttling target set to 45 FPS processing budget.
- Works with requestAnimationFrame and MediaPipe callbacks in browser.

## Core requested modular functions
Defined in `src/gesture/useGestureControl.ts`:
- `calculatePinchStrength()`
- `updateCursorPosition()`
- `detectStablePinch()`
- `clickStateMachine()`

## Run
```bash
npm install
npm run dev
```

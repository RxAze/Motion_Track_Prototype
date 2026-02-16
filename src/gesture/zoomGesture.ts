export type Landmark = { x: number; y: number; z: number };

export type ZoomGestureState = 'IDLE' | 'ARMED' | 'ZOOMING' | 'COOLDOWN';

export type ZoomEngine = {
  state: ZoomGestureState;
  zoom: number;
  emaPinch: number | null;
  baselinePinch: number | null;
  pinchHistory: number[];
  consistentFrames: number;
  cooldownUntil: number;
};

// ============================
// Tunable constants
// ============================
export const ZOOM_CONSTANTS = {
  EMA_ALPHA: 0.22,
  ROLLING_WINDOW: 6,
  ARMED_FRAMES: 4,
  ENTER_DELTA: 0.018,
  EXIT_DELTA: 0.009,
  DEAD_BAND: 0.004,
  ZOOM_SENSITIVITY: 1.8,
  MAX_FRAME_ZOOM_STEP: 0.04,
  HAND_VELOCITY_LIMIT: 0.18,
  COOLDOWN_MS: 180,
  DISABLE_RESET_MS: 120,
  MIN_ZOOM: 0.6,
  MAX_ZOOM: 2.2,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Hand-size invariant scale term for normalization.
 * Uses a blend of wrist->middle MCP and index MCP->pinky MCP.
 */
export function computeHandScale(landmarks: Landmark[]): number {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  if (!wrist || !middleMcp || !indexMcp || !pinkyMcp) {
    return 0.12;
  }

  const scaleA = dist(wrist, middleMcp);
  const scaleB = dist(indexMcp, pinkyMcp);
  return Math.max(0.02, (scaleA + scaleB) / 2);
}

/**
 * normalizedPinch = dist(thumbTip, indexTip) / handScale
 */
export function computeNormalizedPinch(landmarks: Landmark[]): number {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  if (!thumbTip || !indexTip) {
    return 0;
  }

  const pinchDistance = dist(thumbTip, indexTip);
  const handScale = computeHandScale(landmarks);
  return pinchDistance / handScale;
}

function rollingAverage(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function zoomStateMachine(params: {
  engine: ZoomEngine;
  nowMs: number;
  smoothedPinch: number;
  stableDelta: number;
  isClickActive: boolean;
  handVelocity: number;
  disableZoom: boolean;
}) {
  const { engine, nowMs, smoothedPinch, stableDelta, isClickActive, handVelocity, disableZoom } = params;

  if (disableZoom || isClickActive || handVelocity > ZOOM_CONSTANTS.HAND_VELOCITY_LIMIT) {
    engine.state = 'IDLE';
    engine.consistentFrames = 0;
    engine.baselinePinch = smoothedPinch;
    return engine.state;
  }

  if (engine.state === 'COOLDOWN') {
    if (nowMs >= engine.cooldownUntil) {
      engine.state = 'IDLE';
    }
    return engine.state;
  }

  if (engine.state === 'IDLE') {
    engine.consistentFrames += 1;
    if (engine.consistentFrames >= ZOOM_CONSTANTS.ARMED_FRAMES) {
      engine.state = 'ARMED';
      engine.baselinePinch = smoothedPinch;
      engine.consistentFrames = 0;
    }
    return engine.state;
  }

  if (engine.state === 'ARMED') {
    if (Math.abs(stableDelta) >= ZOOM_CONSTANTS.ENTER_DELTA) {
      engine.state = 'ZOOMING';
    }
    return engine.state;
  }

  if (engine.state === 'ZOOMING') {
    if (Math.abs(stableDelta) <= ZOOM_CONSTANTS.EXIT_DELTA) {
      engine.state = 'COOLDOWN';
      engine.cooldownUntil = nowMs + ZOOM_CONSTANTS.COOLDOWN_MS;
    }
  }

  return engine.state;
}

/**
 * Update zoom gesture each frame.
 * Direction mapping (as requested):
 * - Fingers farther apart (delta +): zoom IN
 * - Fingers closer together (delta -): zoom OUT
 */
export function updateZoomGesture(params: {
  engine: ZoomEngine;
  landmarks: Landmark[];
  nowMs: number;
  isClickActive: boolean;
  handVelocity: number;
  disableZoom: boolean;
}) {
  const { engine, landmarks, nowMs, isClickActive, handVelocity, disableZoom } = params;

  const normalizedPinch = computeNormalizedPinch(landmarks);

  if (engine.emaPinch === null) {
    engine.emaPinch = normalizedPinch;
  } else {
    engine.emaPinch =
      ZOOM_CONSTANTS.EMA_ALPHA * normalizedPinch +
      (1 - ZOOM_CONSTANTS.EMA_ALPHA) * engine.emaPinch;
  }

  engine.pinchHistory.push(engine.emaPinch);
  if (engine.pinchHistory.length > ZOOM_CONSTANTS.ROLLING_WINDOW) {
    engine.pinchHistory.shift();
  }

  const stablePinch = rollingAverage(engine.pinchHistory);
  if (engine.baselinePinch === null) {
    engine.baselinePinch = stablePinch;
  }

  const stableDelta = stablePinch - engine.baselinePinch;

  zoomStateMachine({
    engine,
    nowMs,
    smoothedPinch: stablePinch,
    stableDelta,
    isClickActive,
    handVelocity,
    disableZoom,
  });

  if (engine.state !== 'ZOOMING') {
    return {
      zoom: engine.zoom,
      state: engine.state,
      stableDelta,
      normalizedPinch: stablePinch,
    };
  }

  if (Math.abs(stableDelta) < ZOOM_CONSTANTS.DEAD_BAND) {
    return {
      zoom: engine.zoom,
      state: engine.state,
      stableDelta,
      normalizedPinch: stablePinch,
    };
  }

  const rawStep = stableDelta * ZOOM_CONSTANTS.ZOOM_SENSITIVITY;
  const frameStep = clamp(rawStep, -ZOOM_CONSTANTS.MAX_FRAME_ZOOM_STEP, ZOOM_CONSTANTS.MAX_FRAME_ZOOM_STEP);
  engine.zoom = clamp(
    engine.zoom * (1 + frameStep),
    ZOOM_CONSTANTS.MIN_ZOOM,
    ZOOM_CONSTANTS.MAX_ZOOM,
  );

  return {
    zoom: engine.zoom,
    state: engine.state,
    stableDelta,
    normalizedPinch: stablePinch,
  };
}

export function createZoomEngine(initialZoom = 1): ZoomEngine {
  return {
    state: 'IDLE',
    zoom: initialZoom,
    emaPinch: null,
    baselinePinch: null,
    pinchHistory: [],
    consistentFrames: 0,
    cooldownUntil: 0,
  };
}

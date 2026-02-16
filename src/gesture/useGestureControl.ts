import { RefObject, useEffect, useMemo, useRef, useState } from 'react';

type Point = { x: number; y: number };
type TargetRect = { left: number; top: number; width: number; height: number };
type Landmark = { x: number; y: number; z: number };

type UseGestureControlOptions = {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  snapRadius?: number;
};

type UseGestureControlReturn = {
  cursor: Point;
  targetRect: TargetRect | null;
  cameraReady: boolean;
  status: string;
  depthTouchActive: boolean;
  scrollModeActive: boolean;
  pinchConfidence: number;
};

type HandResults = { multiHandLandmarks?: Landmark[][] };

type MediaPipeHands = {
  setOptions: (options: Record<string, number | boolean>) => void;
  onResults: (callback: (results: HandResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
};

type MediaPipeCamera = { start: () => Promise<void>; stop: () => void };

type MediaPipeCameraCtor = new (
  video: HTMLVideoElement,
  options: { onFrame: () => Promise<void>; width: number; height: number },
) => MediaPipeCamera;

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => MediaPipeHands;
    Camera?: MediaPipeCameraCtor;
  }
}

// ============================
// Tunable constants
// ============================
const CLICKABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const TARGET_FPS = 45;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

const BASE_SMOOTHING_ALPHA = 0.2;
const PINCH_SMOOTHING_ALPHA = 0.11;
const DEAD_ZONE_PX = 1.8;
const MAX_CURSOR_STEP_PER_FRAME = 36;
const MOVEMENT_SENSITIVITY = 0.95;
const ACCELERATION_CLAMP = 20;

const PINCH_RATIO_START = 0.3;
const PINCH_RATIO_END = 0.42;
const PINCH_HOLD_MS = 110;
const PINCH_DISTANCE_WINDOW = 5;
const PINCH_COOLDOWN_MS = 260;
const PINCH_MIN_CONFIDENCE = 0.6;
const PINCH_MAX_HAND_SPEED = 0.85;
const PINCH_STABLE_FRAMES = 3;

const DEPTH_TOUCH_START_Z = -0.15;
const DEPTH_TOUCH_END_Z = -0.12;
const DEPTH_TOUCH_VELOCITY_THRESHOLD = 0.022;
const DEPTH_TOUCH_COOLDOWN_MS = 700;

const SCROLL_PALM_DELTA_THRESHOLD = 0.007;
const SCROLL_GAIN = 760;
const SCROLL_COOLDOWN_MS = 12;

// ============================
// Helpers
// ============================
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToRectCenter(point: Point, rect: DOMRect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

function isFingerExtended(landmarks: Landmark[], tipIndex: number, pipIndex: number) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  return Boolean(tip && pip && tip.y < pip.y);
}

function isOpenPalm(landmarks: Landmark[]) {
  const extendedCount = [
    isFingerExtended(landmarks, 8, 6),
    isFingerExtended(landmarks, 12, 10),
    isFingerExtended(landmarks, 16, 14),
    isFingerExtended(landmarks, 20, 18),
  ].filter(Boolean).length;
  return extendedCount >= 3;
}

function getScrollContainerAtPoint(point: Point): HTMLElement | Window {
  const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
  let node: HTMLElement | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
    if (canScrollY) return node;
    node = node.parentElement;
  }
  return window;
}

function scrollByTarget(target: HTMLElement | Window, dy: number) {
  if (target === window) {
    window.scrollBy({ top: dy, behavior: 'auto' });
    return;
  }
  target.scrollBy({ top: dy, behavior: 'auto' });
}

// ============================
// Requested core functions
// ============================
export function calculatePinchStrength(
  landmarks: Landmark[],
  distanceHistory: number[],
): { strength: number; dynamicStart: number; dynamicEnd: number; avgDistance: number; handSpeedNorm: number } {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const indexMcp = landmarks[5];

  if (!thumb || !index || !wrist || !middleMcp || !indexMcp) {
    return { strength: 0, dynamicStart: PINCH_RATIO_START, dynamicEnd: PINCH_RATIO_END, avgDistance: 1, handSpeedNorm: 0 };
  }

  const pinchDist = distance(thumb, index);
  const handScale = Math.max(0.02, distance(wrist, middleMcp)); // dynamic size normalization
  const normalizedPinch = pinchDist / handScale;

  distanceHistory.push(normalizedPinch);
  if (distanceHistory.length > PINCH_DISTANCE_WINDOW) {
    distanceHistory.shift();
  }

  const avgDistance = distanceHistory.reduce((a, b) => a + b, 0) / distanceHistory.length;

  // Dynamic thresholds become more forgiving for small/far hands.
  const farScale = clamp(handScale / 0.16, 0.75, 1.2);
  const dynamicStart = PINCH_RATIO_START * farScale;
  const dynamicEnd = PINCH_RATIO_END * farScale;

  // A lightweight confidence score: low distance + stable rolling average => high confidence.
  const confidenceFromDistance = clamp((dynamicEnd - avgDistance) / (dynamicEnd - dynamicStart), 0, 1);

  const handSpeedNorm = Math.hypot(index.x - indexMcp.x, index.y - indexMcp.y);
  const speedPenalty = clamp(handSpeedNorm / 0.22, 0, 1);

  const strength = clamp(confidenceFromDistance * (1 - speedPenalty * 0.45), 0, 1);

  return { strength, dynamicStart, dynamicEnd, avgDistance, handSpeedNorm };
}

export function updateCursorPosition(params: {
  current: Point;
  rawTarget: Point;
  dtMs: number;
  isPinching: boolean;
  freezeWeight: number;
}) {
  const { current, rawTarget, dtMs, isPinching, freezeWeight } = params;

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  const targetX = centerX + (rawTarget.x - centerX) * MOVEMENT_SENSITIVITY;
  const targetY = centerY + (rawTarget.y - centerY) * MOVEMENT_SENSITIVITY;

  const alpha = isPinching ? PINCH_SMOOTHING_ALPHA : BASE_SMOOTHING_ALPHA;
  let nextX = alpha * targetX + (1 - alpha) * current.x;
  let nextY = alpha * targetY + (1 - alpha) * current.y;

  // Micro jitter suppression.
  if (Math.abs(nextX - current.x) < DEAD_ZONE_PX) nextX = current.x;
  if (Math.abs(nextY - current.y) < DEAD_ZONE_PX) nextY = current.y;

  // Cursor freeze/dampening while pinching for click stability.
  if (isPinching) {
    nextX = current.x + (nextX - current.x) * (1 - freezeWeight);
    nextY = current.y + (nextY - current.y) * (1 - freezeWeight);
  }

  // Acceleration spike limiter.
  const maxStepByFps = MAX_CURSOR_STEP_PER_FRAME * clamp(dtMs / FRAME_INTERVAL_MS, 0.5, 1.6);
  const stepX = nextX - current.x;
  const stepY = nextY - current.y;
  const stepMag = Math.hypot(stepX, stepY);
  if (stepMag > maxStepByFps) {
    const ratio = maxStepByFps / stepMag;
    nextX = current.x + stepX * ratio;
    nextY = current.y + stepY * ratio;
  }

  // Acceleration clamp between sequential updates.
  const accelX = clamp(stepX, -ACCELERATION_CLAMP, ACCELERATION_CLAMP);
  const accelY = clamp(stepY, -ACCELERATION_CLAMP, ACCELERATION_CLAMP);

  return {
    x: clamp(current.x + accelX, 0, window.innerWidth),
    y: clamp(current.y + accelY, 0, window.innerHeight),
  };
}

export function detectStablePinch(params: {
  strength: number;
  avgDistance: number;
  dynamicStart: number;
  dynamicEnd: number;
  handSpeedNorm: number;
  heldMs: number;
  stableFrames: number;
}) {
  const { strength, avgDistance, dynamicStart, dynamicEnd, handSpeedNorm, heldMs, stableFrames } = params;

  const rawStart = avgDistance < dynamicStart;
  const rawEnd = avgDistance > dynamicEnd;

  const stableEnough = stableFrames >= PINCH_STABLE_FRAMES;
  const heldEnough = heldMs >= PINCH_HOLD_MS;
  const speedSafe = handSpeedNorm < PINCH_MAX_HAND_SPEED;
  const confidenceOk = strength >= PINCH_MIN_CONFIDENCE;

  return {
    shouldStartPinch: rawStart && stableEnough && heldEnough && speedSafe && confidenceOk,
    shouldReleasePinch: rawEnd,
    confidence: strength,
  };
}

type ClickState = 'IDLE' | 'PINCHING' | 'CLICKED' | 'RELEASED';

export function clickStateMachine(params: {
  state: ClickState;
  shouldStartPinch: boolean;
  shouldReleasePinch: boolean;
  nowMs: number;
  lastClickMs: number;
}) {
  const { state, shouldStartPinch, shouldReleasePinch, nowMs, lastClickMs } = params;

  let nextState = state;
  let fireClick = false;

  if (state === 'IDLE') {
    if (shouldStartPinch) nextState = 'PINCHING';
  } else if (state === 'PINCHING') {
    if (shouldStartPinch && nowMs - lastClickMs > PINCH_COOLDOWN_MS) {
      nextState = 'CLICKED';
      fireClick = true;
    } else if (shouldReleasePinch) {
      nextState = 'RELEASED';
    }
  } else if (state === 'CLICKED') {
    if (shouldReleasePinch) nextState = 'RELEASED';
  } else if (state === 'RELEASED') {
    if (!shouldStartPinch) nextState = 'IDLE';
  }

  return { nextState, fireClick };
}

export function useGestureControl({ enabled, videoRef, snapRadius = 100 }: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [depthTouchActive, setDepthTouchActive] = useState(false);
  const [scrollModeActive, setScrollModeActive] = useState(false);
  const [pinchConfidence, setPinchConfidence] = useState(0);

  const targetElementRef = useRef<HTMLElement | null>(null);
  const clickStateRef = useRef<ClickState>('IDLE');
  const lastPinchClickTimeRef = useRef(0);
  const pinchStartCandidateAtRef = useRef<number | null>(null);
  const stablePinchFramesRef = useRef(0);
  const pinchDistanceHistoryRef = useRef<number[]>([]);

  const depthTouchActiveRef = useRef(false);
  const lastDepthTouchTimeRef = useRef(0);
  const previousIndexZRef = useRef<number | null>(null);

  const lastCursorRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const previousPalmYRef = useRef<number | null>(null);

  const cameraRef = useRef<MediaPipeCamera | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrameTimeRef = useRef(0);
  const lastScrollTimeRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setTargetRect(null);
      setCameraReady(false);
      setStatus('Idle');
      setDepthTouchActive(false);
      setScrollModeActive(false);
      setPinchConfidence(0);

      clickStateRef.current = 'IDLE';
      pinchStartCandidateAtRef.current = null;
      stablePinchFramesRef.current = 0;
      pinchDistanceHistoryRef.current = [];
      previousIndexZRef.current = null;
      previousPalmYRef.current = null;

      cameraRef.current?.stop();
      cameraRef.current = null;

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }

      const video = videoRef.current;
      if (video) video.srcObject = null;
      return;
    }

    let cancelled = false;
    let fallbackCleanup = () => {};

    const init = async () => {
      const video = videoRef.current;
      if (!video) {
        setStatus('Waiting for video element...');
        return;
      }

      if (!window.Hands || !window.Camera) {
        setStatus('MediaPipe scripts not loaded. Mouse fallback active.');
        const onMove = (event: MouseEvent) => {
          const next = { x: event.clientX, y: event.clientY };
          lastCursorRef.current = next;
          setCursor(next);
        };
        window.addEventListener('mousemove', onMove);
        fallbackCleanup = () => window.removeEventListener('mousemove', onMove);
        return;
      }

      try {
        setStatus('Requesting camera permission...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 960, height: 540, facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        const hands = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
          selfieMode: true,
        });

        hands.onResults((results) => {
          const now = performance.now();
          const elapsed = now - lastFrameTimeRef.current;
          if (elapsed < FRAME_INTERVAL_MS) return;
          const dtMs = Math.max(1, elapsed || FRAME_INTERVAL_MS);
          lastFrameTimeRef.current = now;

          const hand = results.multiHandLandmarks?.[0];
          if (!hand) {
            setStatus('No hand detected');
            setScrollModeActive(false);
            setDepthTouchActive(false);
            setPinchConfidence(0);
            clickStateRef.current = 'IDLE';
            pinchStartCandidateAtRef.current = null;
            stablePinchFramesRef.current = 0;
            return;
          }

          const indexTip = hand[8];
          const thumbTip = hand[4];
          const wrist = hand[0];
          const middleMcp = hand[9];
          if (!indexTip || !thumbTip || !wrist || !middleMcp) return;

          // Whole-hand scrolling mode.
          const palmOpen = isOpenPalm(hand);
          const palmCenterY = (wrist.y + middleMcp.y) / 2;
          if (palmOpen && previousPalmYRef.current !== null) {
            const palmDelta = palmCenterY - previousPalmYRef.current;
            setScrollModeActive(true);
            if (Math.abs(palmDelta) > SCROLL_PALM_DELTA_THRESHOLD && now - lastScrollTimeRef.current > SCROLL_COOLDOWN_MS) {
              const scrollDelta = clamp(-palmDelta * SCROLL_GAIN, -46, 46); // down hand => up scroll
              const target = getScrollContainerAtPoint(lastCursorRef.current);
              scrollByTarget(target, scrollDelta);
              lastScrollTimeRef.current = now;
              setStatus('Open palm scroll');
            }
            previousPalmYRef.current = palmCenterY;
            return;
          }

          setScrollModeActive(false);
          previousPalmYRef.current = palmCenterY;

          // Pinch signal analysis.
          const pinch = calculatePinchStrength(hand, pinchDistanceHistoryRef.current);
          setPinchConfidence(pinch.strength);

          if (pinch.avgDistance < pinch.dynamicStart) {
            stablePinchFramesRef.current += 1;
            if (pinchStartCandidateAtRef.current === null) pinchStartCandidateAtRef.current = now;
          } else {
            stablePinchFramesRef.current = 0;
            pinchStartCandidateAtRef.current = null;
          }

          const heldMs = pinchStartCandidateAtRef.current === null ? 0 : now - pinchStartCandidateAtRef.current;
          const stablePinch = detectStablePinch({
            strength: pinch.strength,
            avgDistance: pinch.avgDistance,
            dynamicStart: pinch.dynamicStart,
            dynamicEnd: pinch.dynamicEnd,
            handSpeedNorm: pinch.handSpeedNorm,
            heldMs,
            stableFrames: stablePinchFramesRef.current,
          });

          const isPinching = clickStateRef.current === 'PINCHING' || clickStateRef.current === 'CLICKED' || stablePinch.shouldStartPinch;

          // Index-finger cursor update.
          const nextCursor = updateCursorPosition({
            current: lastCursorRef.current,
            rawTarget: { x: indexTip.x * window.innerWidth, y: indexTip.y * window.innerHeight },
            dtMs,
            isPinching,
            freezeWeight: 0.55,
          });
          lastCursorRef.current = nextCursor;
          setCursor(nextCursor);

          // Click state machine.
          const clickState = clickStateMachine({
            state: clickStateRef.current,
            shouldStartPinch: stablePinch.shouldStartPinch,
            shouldReleasePinch: stablePinch.shouldReleasePinch,
            nowMs: now,
            lastClickMs: lastPinchClickTimeRef.current,
          });

          clickStateRef.current = clickState.nextState;

          if (clickState.fireClick) {
            targetElementRef.current?.click();
            lastPinchClickTimeRef.current = now;
            setStatus('Stable pinch click');
          } else {
            setStatus(isPinching ? 'Pinch stabilizing...' : 'Tracking index finger');
          }

          // Optional depth-touch click path (air touch).
          const prevZ = previousIndexZRef.current;
          const zVelocity = prevZ === null ? 0 : prevZ - indexTip.z;
          previousIndexZRef.current = indexTip.z;

          if (
            !depthTouchActiveRef.current
            && indexTip.z < DEPTH_TOUCH_START_Z
            && zVelocity > DEPTH_TOUCH_VELOCITY_THRESHOLD
            && now - lastDepthTouchTimeRef.current > DEPTH_TOUCH_COOLDOWN_MS
          ) {
            depthTouchActiveRef.current = true;
            setDepthTouchActive(true);
            targetElementRef.current?.click();
            lastDepthTouchTimeRef.current = now;
            setStatus('Depth touch click');
          } else if (depthTouchActiveRef.current && indexTip.z > DEPTH_TOUCH_END_Z) {
            depthTouchActiveRef.current = false;
            setDepthTouchActive(false);
          }
        });

        const camera = new window.Camera(video, {
          onFrame: async () => {
            await hands.send({ image: video });
          },
          width: 960,
          height: 540,
        });

        cameraRef.current = camera;
        await camera.start();
        setCameraReady(true);
        setStatus('Camera ready');
      } catch (error) {
        setStatus(error instanceof Error ? `Camera error: ${error.message}` : 'Camera error: unable to initialize');
      }
    };

    const cleanupPromise = init();

    return () => {
      cancelled = true;
      void cleanupPromise;
      cameraRef.current?.stop();
      cameraRef.current = null;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      fallbackCleanup();
    };
  }, [enabled, videoRef]);

  useEffect(() => {
    if (!enabled) return;

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR));
    let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const d = distanceToRectCenter(cursor, rect);
      if (d > snapRadius) continue;
      if (!nearest || d < nearest.distance) nearest = { element, rect, distance: d };
    }

    if (!nearest) {
      targetElementRef.current = null;
      setTargetRect(null);
      return;
    }

    targetElementRef.current = nearest.element;
    setTargetRect({ left: nearest.rect.left, top: nearest.rect.top, width: nearest.rect.width, height: nearest.rect.height });
  }, [cursor, enabled, snapRadius]);

  return useMemo(
    () => ({
      cursor,
      targetRect,
      cameraReady,
      status,
      depthTouchActive,
      scrollModeActive,
      pinchConfidence,
    }),
    [cameraReady, cursor, depthTouchActive, pinchConfidence, scrollModeActive, status, targetRect],
  );
}

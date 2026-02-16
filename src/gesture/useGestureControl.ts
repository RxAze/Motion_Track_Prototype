import { RefObject, useEffect, useMemo, useRef, useState } from 'react';

type Point = { x: number; y: number };

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

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
};

type Landmark = { x: number; y: number; z: number };
type HandResults = {
  multiHandLandmarks?: Landmark[][];
};

type MediaPipeHands = {
  setOptions: (options: Record<string, number | boolean>) => void;
  onResults: (callback: (results: HandResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
};

type MediaPipeCamera = {
  start: () => Promise<void>;
  stop: () => void;
};

type MediaPipeCameraCtor = new (
  video: HTMLVideoElement,
  options: {
    onFrame: () => Promise<void>;
    width: number;
    height: number;
  },
) => MediaPipeCamera;

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => MediaPipeHands;
    Camera?: MediaPipeCameraCtor;
  }
}

const CLICKABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

const BASE_SMOOTHING_ALPHA = 0.24;
const SLOW_SMOOTHING_ALPHA = 0.14;
const FAST_SMOOTHING_ALPHA = 0.34;
const MOVEMENT_SENSITIVITY = 0.9;
const DEAD_ZONE_PX = 2;
const INTENTIONAL_MOVE_PX = 4;
const MAX_CURSOR_STEP_PER_FRAME = 44;

const PINCH_START_THRESHOLD = 0.035;
const PINCH_END_THRESHOLD = 0.055;
const PINCH_COOLDOWN_MS = 220;

const DEPTH_TOUCH_START_Z = -0.145;
const DEPTH_TOUCH_END_Z = -0.115;
const DEPTH_TOUCH_VELOCITY_THRESHOLD = 0.02;
const DEPTH_TOUCH_COOLDOWN_MS = 650;

const SCROLL_PALM_DELTA_THRESHOLD = 0.008;
const SCROLL_GAIN = 820;
const SCROLL_COOLDOWN_MS = 12;

function distanceToRectCenter(point: Point, rect: DOMRect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

function landmarkDistance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isFingerExtended(landmarks: Landmark[], tipIndex: number, pipIndex: number) {
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  if (!tip || !pip) {
    return false;
  }
  return tip.y < pip.y;
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
    if (canScrollY) {
      return node;
    }
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

export function useGestureControl({ enabled, videoRef, snapRadius = 100 }: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [depthTouchActive, setDepthTouchActive] = useState(false);
  const [scrollModeActive, setScrollModeActive] = useState(false);

  const targetElementRef = useRef<HTMLElement | null>(null);
  const pinchActiveRef = useRef(false);
  const lastPinchClickTimeRef = useRef(0);
  const depthTouchActiveRef = useRef(false);
  const lastDepthTouchTimeRef = useRef(0);

  const lastCursorRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const previousIndexZRef = useRef<number | null>(null);
  const previousPalmYRef = useRef<number | null>(null);
  const previousPalmAreaRef = useRef<number | null>(null);

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
      depthTouchActiveRef.current = false;
      pinchActiveRef.current = false;
      previousIndexZRef.current = null;
      previousPalmYRef.current = null;
      previousPalmAreaRef.current = null;

      cameraRef.current?.stop();
      cameraRef.current = null;

      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }

      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }

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
        setStatus('MediaPipe scripts not loaded. Falling back to mouse pointer.');

        const handleMove = (event: MouseEvent) => {
          setCursor({ x: event.clientX, y: event.clientY });
          lastCursorRef.current = { x: event.clientX, y: event.clientY };
        };

        window.addEventListener('mousemove', handleMove);
        fallbackCleanup = () => window.removeEventListener('mousemove', handleMove);
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
          if (now - lastFrameTimeRef.current < FRAME_INTERVAL_MS) {
            return;
          }
          const dtMs = Math.max(1, now - lastFrameTimeRef.current || FRAME_INTERVAL_MS);
          lastFrameTimeRef.current = now;

          const hand = results.multiHandLandmarks?.[0];
          if (!hand) {
            setStatus('No hand detected');
            setDepthTouchActive(false);
            setScrollModeActive(false);
            depthTouchActiveRef.current = false;
            pinchActiveRef.current = false;
            previousPalmYRef.current = null;
            previousPalmAreaRef.current = null;
            previousIndexZRef.current = null;
            return;
          }

          const indexTip = hand[8];
          const thumbTip = hand[4];
          const wrist = hand[0];
          const middleMcp = hand[9];

          if (!indexTip || !thumbTip || !wrist || !middleMcp) {
            return;
          }

          const palmOpen = isOpenPalm(hand);
          const palmCenterY = (wrist.y + middleMcp.y) / 2;
          const palmArea = landmarkDistance(hand[5], hand[17]);

          const previousPalmY = previousPalmYRef.current;
          const previousPalmArea = previousPalmAreaRef.current;
          previousPalmYRef.current = palmCenterY;
          previousPalmAreaRef.current = palmArea;

          const areaScale = previousPalmArea && palmArea > 0 ? clamp(previousPalmArea / palmArea, 0.85, 1.18) : 1;

          if (palmOpen && previousPalmY !== null) {
            setScrollModeActive(true);
            const palmDelta = palmCenterY - previousPalmY;
            const directionalIntent = Math.abs(palmDelta) > SCROLL_PALM_DELTA_THRESHOLD;

            if (directionalIntent && now - lastScrollTimeRef.current > SCROLL_COOLDOWN_MS) {
              // Hand down => scroll up; hand up => scroll down.
              const scrollDelta = clamp(-palmDelta * SCROLL_GAIN, -45, 45);
              const target = getScrollContainerAtPoint(lastCursorRef.current);
              scrollByTarget(target, scrollDelta);
              lastScrollTimeRef.current = now;
              setStatus('Scroll mode (open palm)');
            } else {
              setStatus('Open palm detected');
            }
            return;
          }

          setScrollModeActive(false);

          // Only index finger controls cursor movement.
          const rawX = indexTip.x * window.innerWidth;
          const rawY = indexTip.y * window.innerHeight;

          const centerX = window.innerWidth / 2;
          const centerY = window.innerHeight / 2;
          const sensitivityX = centerX + (rawX - centerX) * MOVEMENT_SENSITIVITY * areaScale;
          const sensitivityY = centerY + (rawY - centerY) * MOVEMENT_SENSITIVITY * areaScale;

          const previousCursor = lastCursorRef.current;
          const distance = Math.hypot(sensitivityX - previousCursor.x, sensitivityY - previousCursor.y);
          const normalizedSpeed = distance / dtMs;

          const adaptiveAlpha = normalizedSpeed < 0.08
            ? SLOW_SMOOTHING_ALPHA
            : normalizedSpeed > 0.28
              ? FAST_SMOOTHING_ALPHA
              : BASE_SMOOTHING_ALPHA;

          let nextX = adaptiveAlpha * sensitivityX + (1 - adaptiveAlpha) * previousCursor.x;
          let nextY = adaptiveAlpha * sensitivityY + (1 - adaptiveAlpha) * previousCursor.y;

          const stepX = nextX - previousCursor.x;
          const stepY = nextY - previousCursor.y;
          const stepMag = Math.hypot(stepX, stepY);
          if (stepMag > MAX_CURSOR_STEP_PER_FRAME) {
            const ratio = MAX_CURSOR_STEP_PER_FRAME / stepMag;
            nextX = previousCursor.x + stepX * ratio;
            nextY = previousCursor.y + stepY * ratio;
          }

          if (Math.abs(nextX - previousCursor.x) < DEAD_ZONE_PX) {
            nextX = previousCursor.x;
          }
          if (Math.abs(nextY - previousCursor.y) < DEAD_ZONE_PX) {
            nextY = previousCursor.y;
          }

          const intentionalMove = Math.hypot(nextX - previousCursor.x, nextY - previousCursor.y) > INTENTIONAL_MOVE_PX;
          if (!intentionalMove) {
            setStatus('Stable hold');
          }

          nextX = clamp(nextX, 0, window.innerWidth);
          nextY = clamp(nextY, 0, window.innerHeight);

          lastCursorRef.current = { x: nextX, y: nextY };
          setCursor(lastCursorRef.current);
          if (intentionalMove) {
            setStatus('Tracking index finger');
          }

          const pinchDistance = landmarkDistance(indexTip, thumbTip);
          if (!pinchActiveRef.current && pinchDistance < PINCH_START_THRESHOLD) {
            pinchActiveRef.current = true;
            if (now - lastPinchClickTimeRef.current > PINCH_COOLDOWN_MS) {
              targetElementRef.current?.click();
              lastPinchClickTimeRef.current = now;
              setStatus('Pinch click');
            }
          } else if (pinchActiveRef.current && pinchDistance > PINCH_END_THRESHOLD) {
            pinchActiveRef.current = false;
          }

          // Smooth depth-touch by requiring both depth threshold and fast forward movement.
          const previousZ = previousIndexZRef.current;
          const zVelocity = previousZ === null ? 0 : previousZ - indexTip.z;
          previousIndexZRef.current = indexTip.z;

          if (
            !depthTouchActiveRef.current
            && indexTip.z < DEPTH_TOUCH_START_Z
            && zVelocity > DEPTH_TOUCH_VELOCITY_THRESHOLD
          ) {
            depthTouchActiveRef.current = true;
            setDepthTouchActive(true);
            if (now - lastDepthTouchTimeRef.current > DEPTH_TOUCH_COOLDOWN_MS) {
              targetElementRef.current?.click();
              lastDepthTouchTimeRef.current = now;
              setStatus('Depth touch click');
            }
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
        setStatus(
          error instanceof Error
            ? `Camera error: ${error.message}`
            : 'Camera error: unable to initialize',
        );
      }
    };

    const cleanupPromise = init();

    return () => {
      cancelled = true;
      void cleanupPromise;
      cameraRef.current?.stop();
      cameraRef.current = null;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
      fallbackCleanup();
    };
  }, [enabled, videoRef]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR));
    let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;

    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const distance = distanceToRectCenter(cursor, rect);
      if (distance > snapRadius) continue;

      if (!nearest || distance < nearest.distance) {
        nearest = { element, rect, distance };
      }
    }

    if (!nearest) {
      targetElementRef.current = null;
      setTargetRect(null);
      return;
    }

    targetElementRef.current = nearest.element;
    setTargetRect({
      left: nearest.rect.left,
      top: nearest.rect.top,
      width: nearest.rect.width,
      height: nearest.rect.height,
    });
  }, [cursor, enabled, snapRadius]);

  return useMemo(
    () => ({
      cursor,
      targetRect,
      cameraReady,
      status,
      depthTouchActive,
      scrollModeActive,
    }),
    [cameraReady, cursor, depthTouchActive, scrollModeActive, status, targetRect],
  );
}

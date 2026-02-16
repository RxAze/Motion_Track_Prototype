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

const SMOOTHING_ALPHA = 0.14;
const MOVEMENT_SENSITIVITY = 0.75;
const DEAD_ZONE_PX = 3;

const PINCH_START_THRESHOLD = 0.042;
const PINCH_END_THRESHOLD = 0.068;

const DEPTH_TOUCH_START_Z = -0.11;
const DEPTH_TOUCH_END_Z = -0.08;
const DEPTH_TOUCH_COOLDOWN_MS = 450;

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

export function useGestureControl({ enabled, videoRef, snapRadius = 100 }: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [depthTouchActive, setDepthTouchActive] = useState(false);

  const targetElementRef = useRef<HTMLElement | null>(null);
  const pinchActiveRef = useRef(false);
  const depthTouchActiveRef = useRef(false);
  const lastDepthTouchTimeRef = useRef(0);
  const cameraRef = useRef<MediaPipeCamera | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTargetRect(null);
      setCameraReady(false);
      setStatus('Idle');
      setDepthTouchActive(false);
      depthTouchActiveRef.current = false;
      pinchActiveRef.current = false;

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
          minDetectionConfidence: 0.62,
          minTrackingConfidence: 0.55,
          selfieMode: true,
        });

        const smoothing = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

        hands.onResults((results) => {
          const hand = results.multiHandLandmarks?.[0];
          if (!hand) {
            setStatus('No hand detected');
            setDepthTouchActive(false);
            depthTouchActiveRef.current = false;
            pinchActiveRef.current = false;
            return;
          }

          const indexTip = hand[8];
          const thumbTip = hand[4];
          if (!indexTip || !thumbTip) {
            return;
          }

          // Keep cursor direction parallel with physical movement.
          const targetX = indexTip.x * window.innerWidth;
          const targetY = (1 - indexTip.y) * window.innerHeight;

          const centerX = window.innerWidth / 2;
          const centerY = window.innerHeight / 2;
          const sensitivityX = centerX + (targetX - centerX) * MOVEMENT_SENSITIVITY;
          const sensitivityY = centerY + (targetY - centerY) * MOVEMENT_SENSITIVITY;

          const nextX = SMOOTHING_ALPHA * sensitivityX + (1 - SMOOTHING_ALPHA) * smoothing.x;
          const nextY = SMOOTHING_ALPHA * sensitivityY + (1 - SMOOTHING_ALPHA) * smoothing.y;

          if (Math.abs(nextX - smoothing.x) > DEAD_ZONE_PX) {
            smoothing.x = nextX;
          }
          if (Math.abs(nextY - smoothing.y) > DEAD_ZONE_PX) {
            smoothing.y = nextY;
          }

          smoothing.x = clamp(smoothing.x, 0, window.innerWidth);
          smoothing.y = clamp(smoothing.y, 0, window.innerHeight);

          setCursor({ x: smoothing.x, y: smoothing.y });
          setStatus('Tracking hand');

          const pinchDistance = landmarkDistance(indexTip, thumbTip);
          if (!pinchActiveRef.current && pinchDistance < PINCH_START_THRESHOLD) {
            pinchActiveRef.current = true;
            targetElementRef.current?.click();
          } else if (pinchActiveRef.current && pinchDistance > PINCH_END_THRESHOLD) {
            pinchActiveRef.current = false;
          }

          // Depth-touch: when index fingertip gets close to camera, trigger click.
          const now = Date.now();
          if (!depthTouchActiveRef.current && indexTip.z < DEPTH_TOUCH_START_Z) {
            depthTouchActiveRef.current = true;
            setDepthTouchActive(true);
            if (now - lastDepthTouchTimeRef.current > DEPTH_TOUCH_COOLDOWN_MS) {
              lastDepthTouchTimeRef.current = now;
              targetElementRef.current?.click();
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
    }),
    [cameraReady, cursor, depthTouchActive, status, targetRect],
  );
}

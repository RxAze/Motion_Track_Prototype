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

function distanceToRectCenter(point: Point, rect: DOMRect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

function landmarkDistance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function useGestureControl({ enabled, videoRef, snapRadius = 100 }: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Idle');

  const targetElementRef = useRef<HTMLElement | null>(null);
  const pinchActiveRef = useRef(false);
  const cameraRef = useRef<MediaPipeCamera | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTargetRect(null);
      setCameraReady(false);
      setStatus('Idle');

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
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.6,
          selfieMode: true,
        });

        const smoothing = { x: cursor.x, y: cursor.y };

        hands.onResults((results) => {
          const hand = results.multiHandLandmarks?.[0];
          if (!hand) {
            setStatus('No hand detected');
            return;
          }

          const indexTip = hand[8];
          const thumbTip = hand[4];
          if (!indexTip || !thumbTip) {
            return;
          }

          const rawX = (1 - indexTip.x) * window.innerWidth;
          const rawY = indexTip.y * window.innerHeight;

          const alpha = 0.25;
          smoothing.x = alpha * rawX + (1 - alpha) * smoothing.x;
          smoothing.y = alpha * rawY + (1 - alpha) * smoothing.y;

          setCursor({ x: smoothing.x, y: smoothing.y });
          setStatus('Tracking hand');

          const pinchDistance = landmarkDistance(indexTip, thumbTip);
          const pinchStartThreshold = 0.045;
          const pinchEndThreshold = 0.07;

          if (!pinchActiveRef.current && pinchDistance < pinchStartThreshold) {
            pinchActiveRef.current = true;
            targetElementRef.current?.click();
          } else if (pinchActiveRef.current && pinchDistance > pinchEndThreshold) {
            pinchActiveRef.current = false;
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
    }),
    [cursor, targetRect, cameraReady, status],
  );
}

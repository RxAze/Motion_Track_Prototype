import { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createZoomEngine, type Landmark, type ZoomGestureState } from './zoomGesture';
import { extractFrameFeatures } from '../ml/features';
import { GestureInferencer, type MlGestureLabel } from '../ml/infer';
import { RingBuffer } from '../ml/ringBuffer';

type Point = { x: number; y: number };
type TargetRect = { left: number; top: number; width: number; height: number };
type DatasetLabel = MlGestureLabel;

type DatasetSample = {
  label: DatasetLabel;
  sequence: number[][];
};

type UseGestureControlOptions = {
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  snapRadius?: number;
  mlInferenceEnabled?: boolean;
};

type UseGestureControlReturn = {
  cursor: Point;
  targetRect: TargetRect | null;
  cameraReady: boolean;
  status: string;
  depthTouchActive: boolean;
  scrollModeActive: boolean;
  pinchConfidence: number;
  zoomScale: number;
  zoomState: ZoomGestureState;
  mlGesture: MlGestureLabel;
  recording: boolean;
  recorderLabel: DatasetLabel;
  datasetSamples: number;
  modelReady: boolean;
  mlProbabilities: { neutral: number; open_palm: number; pinch: number };
  mlDebug: { errorCount: number; lastError: string | null; modelFeatureDim: number | null };
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

declare const chrome:
  | {
      runtime?: {
        getURL?: (path: string) => string;
      };
    }
  | undefined;

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
const ML_SEQUENCE_LENGTH = 30;
const DATASET_CAPTURE_STRIDE = 4;
const NO_HAND_RESET_FRAMES = 8;

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
const SCROLL_ARM_FRAMES = 4;
const OPEN_PALM_NEUTRAL_BIAS = 0.08;

const TWO_HAND_ZOOM_ENTER_DELTA = 0.026;
const TWO_HAND_ZOOM_EXIT_DELTA = 0.01;
const TWO_HAND_ZOOM_ALPHA = 0.3;
const TWO_HAND_ZOOM_SENSITIVITY = 1.65;
const TWO_HAND_ZOOM_MAX_STEP = 0.035;
const TWO_HAND_ENTER_MAX_SPEED = 0.05;
const TWO_HAND_FAST_SPEED = 0.11;
const TWO_HAND_IDLE_FRAMES_TO_STOP = 4;
const UI_PUBLISH_INTERVAL_MS = 90;
const SNAP_RECOMPUTE_INTERVAL_MS = 90;
const SNAP_RECOMPUTE_MOVE_PX = 14;
const CLICKABLE_REFRESH_INTERVAL_MS = 1200;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Landmark, b: Landmark) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function distanceToRectCenter(point: Point, rect: DOMRect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

function pointsDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getScrollContainerAtPoint(point: Point): HTMLElement | Window {
  const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
  let node: HTMLElement | null = el;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2;
    if (canScrollY || canScrollX) return node;
    node = node.parentElement;
  }
  return window;
}

function scrollByTarget(target: HTMLElement | Window, dx: number, dy: number) {
  if (target === window) {
    window.scrollBy({ left: dx, top: dy, behavior: 'auto' });
    return;
  }
  target.scrollBy({ left: dx, top: dy, behavior: 'auto' });
}

function calculatePinchStrength(
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
  const handScale = Math.max(0.02, distance(wrist, middleMcp));
  const normalizedPinch = pinchDist / handScale;

  distanceHistory.push(normalizedPinch);
  if (distanceHistory.length > PINCH_DISTANCE_WINDOW) distanceHistory.shift();

  const avgDistance = distanceHistory.reduce((a, b) => a + b, 0) / distanceHistory.length;
  const farScale = clamp(handScale / 0.16, 0.75, 1.2);
  const dynamicStart = PINCH_RATIO_START * farScale;
  const dynamicEnd = PINCH_RATIO_END * farScale;

  const confidenceFromDistance = clamp((dynamicEnd - avgDistance) / (dynamicEnd - dynamicStart), 0, 1);
  const handSpeedNorm = Math.hypot(index.x - indexMcp.x, index.y - indexMcp.y);
  const speedPenalty = clamp(handSpeedNorm / 0.22, 0, 1);
  const strength = clamp(confidenceFromDistance * (1 - speedPenalty * 0.45), 0, 1);

  return { strength, dynamicStart, dynamicEnd, avgDistance, handSpeedNorm };
}

function updateCursorPosition(params: {
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

  if (Math.abs(nextX - current.x) < DEAD_ZONE_PX) nextX = current.x;
  if (Math.abs(nextY - current.y) < DEAD_ZONE_PX) nextY = current.y;

  if (isPinching) {
    nextX = current.x + (nextX - current.x) * (1 - freezeWeight);
    nextY = current.y + (nextY - current.y) * (1 - freezeWeight);
  }

  const maxStepByFps = MAX_CURSOR_STEP_PER_FRAME * clamp(dtMs / FRAME_INTERVAL_MS, 0.5, 1.6);
  const stepX = nextX - current.x;
  const stepY = nextY - current.y;
  const stepMag = Math.hypot(stepX, stepY);
  if (stepMag > maxStepByFps) {
    const ratio = maxStepByFps / stepMag;
    nextX = current.x + stepX * ratio;
    nextY = current.y + stepY * ratio;
  }

  const accelX = clamp(stepX, -ACCELERATION_CLAMP, ACCELERATION_CLAMP);
  const accelY = clamp(stepY, -ACCELERATION_CLAMP, ACCELERATION_CLAMP);

  return {
    x: clamp(current.x + accelX, 0, window.innerWidth),
    y: clamp(current.y + accelY, 0, window.innerHeight),
  };
}

function detectStablePinch(params: {
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

  return {
    shouldStartPinch:
      rawStart &&
      stableFrames >= PINCH_STABLE_FRAMES &&
      heldMs >= PINCH_HOLD_MS &&
      handSpeedNorm < PINCH_MAX_HAND_SPEED &&
      strength >= PINCH_MIN_CONFIDENCE,
    shouldReleasePinch: rawEnd,
    confidence: strength,
  };
}

type ClickState = 'IDLE' | 'PINCHING' | 'CLICKED' | 'RELEASED';

function clickStateMachine(params: {
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

function cloneLandmarks(landmarks: Landmark[]) {
  return landmarks.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }));
}

function padSequenceToLength(sequence: number[][], targetLength: number) {
  if (sequence.length === 0) return null;
  if (sequence.length === targetLength) return sequence;
  if (sequence.length > targetLength) return sequence.slice(sequence.length - targetLength);
  const pad = Array.from({ length: targetLength - sequence.length }, () => sequence[0]);
  return [...pad, ...sequence];
}

export function useGestureControl({
  enabled,
  videoRef,
  snapRadius = 100,
  mlInferenceEnabled = true,
}: UseGestureControlOptions): UseGestureControlReturn {
  const [cursor, setCursor] = useState<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [depthTouchActive, setDepthTouchActive] = useState(false);
  const [scrollModeActive, setScrollModeActive] = useState(false);
  const [pinchConfidence, setPinchConfidence] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomState, setZoomState] = useState<ZoomGestureState>('IDLE');
  const [mlGesture, setMlGesture] = useState<MlGestureLabel>('neutral');
  const [recording, setRecording] = useState(false);
  const [recorderLabel, setRecorderLabel] = useState<DatasetLabel>('neutral');
  const [datasetSamples, setDatasetSamples] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [mlProbabilities, setMlProbabilities] = useState({ neutral: 1, open_palm: 0, pinch: 0 });
  const [mlDebug, setMlDebug] = useState<{ errorCount: number; lastError: string | null; modelFeatureDim: number | null }>({
    errorCount: 0,
    lastError: null,
    modelFeatureDim: null,
  });

  const targetElementRef = useRef<HTMLElement | null>(null);
  const clickStateRef = useRef<ClickState>('IDLE');
  const lastPinchClickTimeRef = useRef(0);
  const pinchStartCandidateAtRef = useRef<number | null>(null);
  const stablePinchFramesRef = useRef(0);
  const pinchDistanceHistoryRef = useRef<number[]>([]);

  const depthTouchActiveRef = useRef(false);
  const lastDepthTouchTimeRef = useRef(0);
  const previousIndexZRef = useRef<number | null>(null);
  const previousIndexRef = useRef<Point | null>(null);
  const previousPalmYRef = useRef<number | null>(null);
  const previousPalmXRef = useRef<number | null>(null);
  const scrollArmFramesRef = useRef(0);

  const lastCursorRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const zoomEngineRef = useRef(createZoomEngine(1));

  const featureBufferRef = useRef(new RingBuffer<number[]>(ML_SEQUENCE_LENGTH));
  const lastLandmarksRef = useRef<Landmark[] | null>(null);
  const inferencerRef = useRef(new GestureInferencer({ sequenceLength: ML_SEQUENCE_LENGTH }));

  const recordingRef = useRef(false);
  const recordingLabelRef = useRef<DatasetLabel>('neutral');
  const recorderStrideRef = useRef(0);
  const datasetRef = useRef<DatasetSample[]>([]);

  const cameraRef = useRef<MediaPipeCamera | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrameTimeRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const noHandFramesRef = useRef(0);
  const lastUiPublishAtRef = useRef(0);
  const lastSnapComputeAtRef = useRef(0);
  const lastSnapCursorRef = useRef<Point | null>(null);
  const clickableCacheRef = useRef<HTMLElement[]>([]);
  const clickableCacheAtRef = useRef(0);
  const twoHandPreviousDistanceRef = useRef<number | null>(null);
  const twoHandSmoothedDeltaRef = useRef(0);
  const twoHandActiveRef = useRef(false);
  const twoHandIdleFramesRef = useRef(0);
  const twoHandPrevCenterARef = useRef<Landmark | null>(null);
  const twoHandPrevCenterBRef = useRef<Landmark | null>(null);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (!enabled) return;

    const downloadDataset = () => {
      if (datasetRef.current.length === 0) {
        setStatus('Recorder: dataset is empty');
        return;
      }
      const jsonl = datasetRef.current.map((entry) => JSON.stringify(entry)).join('\n');
      const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = 'dataset.jsonl';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(href);
      setStatus(`Recorder: downloaded ${datasetRef.current.length} sequences`);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName ?? '';
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

      if (event.code === 'KeyR') {
        setRecording((prev) => !prev);
        setStatus(`Recorder: ${recordingRef.current ? 'OFF' : 'ON'} (${recordingLabelRef.current})`);
        return;
      }

      if (event.code === 'Digit1') {
        recordingLabelRef.current = 'neutral';
        setRecorderLabel('neutral');
        setStatus('Recorder label: neutral');
        return;
      }

      if (event.code === 'Digit2') {
        recordingLabelRef.current = 'open_palm';
        setRecorderLabel('open_palm');
        setStatus('Recorder label: open_palm');
        return;
      }

      if (event.code === 'Digit3') {
        recordingLabelRef.current = 'pinch';
        setRecorderLabel('pinch');
        setStatus('Recorder label: pinch');
        return;
      }

      if (event.code === 'KeyS') {
        downloadDataset();
        return;
      }

      if (event.code === 'KeyC') {
        datasetRef.current = [];
        setDatasetSamples(0);
        setStatus('Recorder: cleared in-memory dataset');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setTargetRect(null);
      setCameraReady(false);
      setStatus('Idle');
      setDepthTouchActive(false);
      setScrollModeActive(false);
      setPinchConfidence(0);
      setZoomState('IDLE');
      setMlGesture('neutral');
      setRecording(false);
      setRecorderLabel('neutral');
      setModelReady(false);
      setMlProbabilities({ neutral: 1, open_palm: 0, pinch: 0 });
      setMlDebug({ errorCount: 0, lastError: null, modelFeatureDim: null });
      recordingLabelRef.current = 'neutral';

      zoomEngineRef.current = createZoomEngine(1);
      setZoomScale(1);

      clickStateRef.current = 'IDLE';
      pinchStartCandidateAtRef.current = null;
      stablePinchFramesRef.current = 0;
      pinchDistanceHistoryRef.current = [];
      previousIndexZRef.current = null;
      previousPalmYRef.current = null;
      previousPalmXRef.current = null;
      previousIndexRef.current = null;
      scrollArmFramesRef.current = 0;

      inferencerRef.current.reset();
      featureBufferRef.current.clear();
      lastLandmarksRef.current = null;
      recorderStrideRef.current = 0;
      noHandFramesRef.current = 0;
      twoHandPreviousDistanceRef.current = null;
      twoHandSmoothedDeltaRef.current = 0;
      twoHandActiveRef.current = false;
      twoHandIdleFramesRef.current = 0;
      twoHandPrevCenterARef.current = null;
      twoHandPrevCenterBRef.current = null;

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
          video: { width: 640, height: 360, facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();

        if (mlInferenceEnabled) {
          const modelLoad = inferencerRef.current.loadModel();
          modelLoad.then(() => setModelReady(true)).catch(() => {
            setStatus('ML model missing. Place model at /public/models/gesture_model/');
            setModelReady(false);
          });
        } else {
          setModelReady(false);
        }

        const hands = new window.Hands({
          locateFile: (file) => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
              return chrome.runtime.getURL(`vendor/mediapipe/hands/${file}`);
            }
            return `/vendor/mediapipe/hands/${file}`;
          },
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 0,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.45,
          selfieMode: true,
        });

        hands.onResults((results) => {
          const now = performance.now();
          const elapsed = now - lastFrameTimeRef.current;
          if (elapsed < FRAME_INTERVAL_MS) return;
          const dtMs = Math.max(1, elapsed || FRAME_INTERVAL_MS);
          lastFrameTimeRef.current = now;

          const hand = results.multiHandLandmarks?.[0];
          const secondHand = results.multiHandLandmarks?.[1];
          if (!hand) {
            noHandFramesRef.current += 1;
            setStatus('No hand detected');
            setScrollModeActive(false);
            setDepthTouchActive(false);
            setPinchConfidence(0);
            setZoomState('IDLE');
            setMlGesture('neutral');
            clickStateRef.current = 'IDLE';
            pinchStartCandidateAtRef.current = null;
            stablePinchFramesRef.current = 0;
            scrollArmFramesRef.current = 0;
            twoHandPreviousDistanceRef.current = null;
            twoHandSmoothedDeltaRef.current = 0;
            twoHandActiveRef.current = false;
            twoHandIdleFramesRef.current = 0;
            twoHandPrevCenterARef.current = null;
            twoHandPrevCenterBRef.current = null;
            if (noHandFramesRef.current >= NO_HAND_RESET_FRAMES) {
              featureBufferRef.current.clear();
              lastLandmarksRef.current = null;
            }
            return;
          }
          noHandFramesRef.current = 0;

          const indexTip = hand[8];
          const thumbTip = hand[4];
          const wrist = hand[0];
          const middleMcp = hand[9];
          if (!indexTip || !thumbTip || !wrist || !middleMcp) return;

          if (secondHand) {
            const secondWrist = secondHand[0];
            const secondMiddleMcp = secondHand[9];
            if (secondWrist && secondMiddleMcp) {
              const centerA = midpoint(wrist, middleMcp);
              const centerB = midpoint(secondWrist, secondMiddleMcp);
              const scaleA = Math.max(0.02, distance(wrist, middleMcp));
              const scaleB = Math.max(0.02, distance(secondWrist, secondMiddleMcp));
              const distanceNorm = distance(centerA, centerB) / Math.max(0.03, (scaleA + scaleB) / 2);

              const prevDistance = twoHandPreviousDistanceRef.current;
              twoHandPreviousDistanceRef.current = distanceNorm;

              const rawDelta = prevDistance === null ? 0 : distanceNorm - prevDistance;
              twoHandSmoothedDeltaRef.current =
                TWO_HAND_ZOOM_ALPHA * rawDelta + (1 - TWO_HAND_ZOOM_ALPHA) * twoHandSmoothedDeltaRef.current;
              const absDelta = Math.abs(twoHandSmoothedDeltaRef.current);

              const prevCenterA = twoHandPrevCenterARef.current;
              const prevCenterB = twoHandPrevCenterBRef.current;
              const speedA = prevCenterA ? distance(centerA, prevCenterA) : 0;
              const speedB = prevCenterB ? distance(centerB, prevCenterB) : 0;
              twoHandPrevCenterARef.current = centerA;
              twoHandPrevCenterBRef.current = centerB;
              const pairSpeed = Math.max(speedA, speedB);

              const canEnter = pairSpeed <= TWO_HAND_ENTER_MAX_SPEED;
              if (!twoHandActiveRef.current && canEnter && absDelta >= TWO_HAND_ZOOM_ENTER_DELTA) {
                twoHandActiveRef.current = true;
                twoHandIdleFramesRef.current = 0;
              }

              if (twoHandActiveRef.current) {
                if (absDelta <= TWO_HAND_ZOOM_EXIT_DELTA) {
                  twoHandIdleFramesRef.current += 1;
                } else {
                  twoHandIdleFramesRef.current = 0;
                }

                const speedFactor = pairSpeed > TWO_HAND_FAST_SPEED ? 0.4 : 1;
                const step = clamp(
                  twoHandSmoothedDeltaRef.current * TWO_HAND_ZOOM_SENSITIVITY * speedFactor,
                  -TWO_HAND_ZOOM_MAX_STEP,
                  TWO_HAND_ZOOM_MAX_STEP,
                );

                if (absDelta > TWO_HAND_ZOOM_EXIT_DELTA) {
                  zoomEngineRef.current.zoom = clamp(zoomEngineRef.current.zoom * (1 + step), 0.6, 2.2);
                }

                if (twoHandIdleFramesRef.current >= TWO_HAND_IDLE_FRAMES_TO_STOP) {
                  twoHandActiveRef.current = false;
                  twoHandIdleFramesRef.current = 0;
                  setZoomState('IDLE');
                  setStatus(recordingRef.current ? `Two-hand zoom idle | REC ${recordingLabelRef.current}` : 'Two-hand zoom idle');
                } else {
                  setZoomState('ZOOMING');
                  setStatus(
                    recordingRef.current
                      ? `${step >= 0 ? 'Two-hand zoom in' : 'Two-hand zoom out'} | REC ${recordingLabelRef.current}`
                      : step >= 0
                        ? 'Two-hand zoom in'
                        : 'Two-hand zoom out',
                  );
                }
              } else {
                setZoomState('ARMED');
                setStatus(recordingRef.current ? `Two hands detected | REC ${recordingLabelRef.current}` : 'Two hands detected');
              }

              setZoomScale(zoomEngineRef.current.zoom);
              setScrollModeActive(false);
              setDepthTouchActive(false);
              if (now - lastUiPublishAtRef.current >= UI_PUBLISH_INTERVAL_MS) {
                lastUiPublishAtRef.current = now;
                setPinchConfidence(0);
                setMlGesture('neutral');
                setMlProbabilities({ neutral: 1, open_palm: 0, pinch: 0 });
              }
              clickStateRef.current = 'IDLE';
              pinchStartCandidateAtRef.current = null;
              stablePinchFramesRef.current = 0;
              previousPalmYRef.current = (wrist.y + middleMcp.y) / 2;
              scrollArmFramesRef.current = 0;

              const nextCursor = updateCursorPosition({
                current: lastCursorRef.current,
                rawTarget: { x: indexTip.x * window.innerWidth, y: indexTip.y * window.innerHeight },
                dtMs,
                isPinching: false,
                freezeWeight: 0,
              });
              lastCursorRef.current = nextCursor;
              setCursor(nextCursor);
              return;
            }
          } else {
            twoHandPreviousDistanceRef.current = null;
            twoHandSmoothedDeltaRef.current = 0;
            twoHandActiveRef.current = false;
            twoHandIdleFramesRef.current = 0;
            twoHandPrevCenterARef.current = null;
            twoHandPrevCenterBRef.current = null;
          }

          const frameFeatures = extractFrameFeatures(hand, lastLandmarksRef.current, dtMs);
          lastLandmarksRef.current = cloneLandmarks(hand);
          featureBufferRef.current.push(frameFeatures.vector);

          if (recordingRef.current && featureBufferRef.current.isFull()) {
            recorderStrideRef.current += 1;
            if (recorderStrideRef.current % DATASET_CAPTURE_STRIDE === 0) {
              datasetRef.current.push({
                label: recordingLabelRef.current,
                sequence: featureBufferRef.current.toArray(),
              });
              setDatasetSamples(datasetRef.current.length);
            }
          }

          const sequenceForInference = padSequenceToLength(featureBufferRef.current.toArray(), ML_SEQUENCE_LENGTH);
          const ml = mlInferenceEnabled && sequenceForInference
            ? inferencerRef.current.predict(sequenceForInference, frameFeatures.handVelocity)
            : {
                label: 'neutral' as MlGestureLabel,
                probabilities: { neutral: 1, open_palm: 0, pinch: 0 },
                modelReady: false,
                errorCount: 0,
                lastError: null,
                modelFeatureDim: null,
              };
          let activeGesture = ml.label;
          if (
            activeGesture === 'open_palm' &&
            ml.probabilities.neutral > ml.probabilities.open_palm + OPEN_PALM_NEUTRAL_BIAS
          ) {
            activeGesture = 'neutral';
          }
          const shouldPublishUi = now - lastUiPublishAtRef.current >= UI_PUBLISH_INTERVAL_MS;
          if (shouldPublishUi) {
            lastUiPublishAtRef.current = now;
            setModelReady(ml.modelReady && mlInferenceEnabled);
            setMlProbabilities(ml.probabilities);
            setMlDebug({
              errorCount: ml.errorCount ?? 0,
              lastError: ml.lastError ?? null,
              modelFeatureDim: ml.modelFeatureDim ?? null,
            });
            setMlGesture(activeGesture);
            setPinchConfidence(mlInferenceEnabled ? ml.probabilities.pinch : 0);
          }

          const isPinchFamily =
            activeGesture === 'pinch' &&
            (clickStateRef.current === 'PINCHING' || clickStateRef.current === 'CLICKED');

          const nextCursor = updateCursorPosition({
            current: lastCursorRef.current,
            rawTarget: { x: indexTip.x * window.innerWidth, y: indexTip.y * window.innerHeight },
            dtMs,
            isPinching: isPinchFamily,
            freezeWeight: 0.55,
          });
          lastCursorRef.current = nextCursor;
          setCursor(nextCursor);

          previousIndexRef.current = { x: indexTip.x * window.innerWidth, y: indexTip.y * window.innerHeight };

          if (activeGesture === 'open_palm') {
            const palmCenterX = (wrist.x + middleMcp.x) / 2;
            const palmCenterY = (wrist.y + middleMcp.y) / 2;
            scrollArmFramesRef.current += 1;
            const scrollArmed = scrollArmFramesRef.current >= SCROLL_ARM_FRAMES;

            setScrollModeActive(true);
            setDepthTouchActive(false);
            depthTouchActiveRef.current = false;
            clickStateRef.current = 'IDLE';
            pinchStartCandidateAtRef.current = null;
            stablePinchFramesRef.current = 0;

            if (scrollArmed && previousPalmYRef.current !== null && previousPalmXRef.current !== null) {
              const palmDelta = palmCenterY - previousPalmYRef.current;
              const palmDeltaX = palmCenterX - previousPalmXRef.current;
              if (
                (Math.abs(palmDelta) > SCROLL_PALM_DELTA_THRESHOLD || Math.abs(palmDeltaX) > SCROLL_PALM_DELTA_THRESHOLD) &&
                now - lastScrollTimeRef.current > SCROLL_COOLDOWN_MS
              ) {
                const scrollDeltaY = clamp(-palmDelta * SCROLL_GAIN, -46, 46);
                const scrollDeltaX = clamp(palmDeltaX * SCROLL_GAIN, -46, 46);
                const target = getScrollContainerAtPoint(lastCursorRef.current);
                scrollByTarget(target, scrollDeltaX, scrollDeltaY);
                lastScrollTimeRef.current = now;
                setStatus(recordingRef.current ? `Open palm scroll XY | REC ${recordingLabelRef.current}` : 'Open palm scroll XY');
              } else {
                setStatus(recordingRef.current ? `Open palm armed | REC ${recordingLabelRef.current}` : 'Open palm armed');
              }
            } else {
              setStatus(recordingRef.current ? `Open palm detected | REC ${recordingLabelRef.current}` : 'Open palm detected');
            }

            previousPalmXRef.current = palmCenterX;
            previousPalmYRef.current = palmCenterY;
            setZoomScale(zoomEngineRef.current.zoom);
            setZoomState('IDLE');
            return;
          }

          setScrollModeActive(false);
          previousPalmYRef.current = null;
          previousPalmXRef.current = null;
          scrollArmFramesRef.current = 0;

          if (activeGesture !== 'pinch') {
            clickStateRef.current = 'IDLE';
            pinchStartCandidateAtRef.current = null;
            stablePinchFramesRef.current = 0;
            setDepthTouchActive(false);
            depthTouchActiveRef.current = false;

            setZoomScale(zoomEngineRef.current.zoom);
            setZoomState('IDLE');
            setStatus(recordingRef.current ? `Neutral tracking | REC ${recordingLabelRef.current}` : 'Neutral tracking');
            return;
          }

          const pinch = calculatePinchStrength(hand, pinchDistanceHistoryRef.current);
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
            setStatus(recordingRef.current ? `Pinch click | REC ${recordingLabelRef.current}` : 'Pinch click');
          } else {
            setStatus(recordingRef.current ? `Pinch mode | REC ${recordingLabelRef.current}` : 'Pinch mode');
          }

          setZoomScale(zoomEngineRef.current.zoom);
          setZoomState('IDLE');

          const prevZ = previousIndexZRef.current;
          const zVelocity = prevZ === null ? 0 : prevZ - indexTip.z;
          previousIndexZRef.current = indexTip.z;

          if (
            !depthTouchActiveRef.current &&
            indexTip.z < DEPTH_TOUCH_START_Z &&
            zVelocity > DEPTH_TOUCH_VELOCITY_THRESHOLD &&
            now - lastDepthTouchTimeRef.current > DEPTH_TOUCH_COOLDOWN_MS
          ) {
            depthTouchActiveRef.current = true;
            setDepthTouchActive(true);
            targetElementRef.current?.click();
            lastDepthTouchTimeRef.current = now;
          } else if (depthTouchActiveRef.current && indexTip.z > DEPTH_TOUCH_END_Z) {
            depthTouchActiveRef.current = false;
            setDepthTouchActive(false);
          }
        });

        const camera = new window.Camera(video, {
          onFrame: async () => {
            await hands.send({ image: video });
          },
          width: 640,
          height: 360,
        });

        cameraRef.current = camera;
        await camera.start();
        setCameraReady(true);
        setStatus(mlInferenceEnabled ? 'Camera ready (ML gesture router active)' : 'Camera ready (training mode: ML off)');
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
  }, [enabled, mlInferenceEnabled, videoRef]);

  useEffect(() => {
    if (!enabled) return;

    const now = performance.now();
    const prevSnapCursor = lastSnapCursorRef.current;
    const canSkipForTime = now - lastSnapComputeAtRef.current < SNAP_RECOMPUTE_INTERVAL_MS;
    const canSkipForMove = prevSnapCursor ? pointsDistance(cursor, prevSnapCursor) < SNAP_RECOMPUTE_MOVE_PX : false;
    if (canSkipForTime && canSkipForMove) return;
    lastSnapComputeAtRef.current = now;
    lastSnapCursorRef.current = cursor;

    if (
      clickableCacheRef.current.length === 0 ||
      now - clickableCacheAtRef.current > CLICKABLE_REFRESH_INTERVAL_MS
    ) {
      clickableCacheRef.current = Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR));
      clickableCacheAtRef.current = now;
    }

    const candidates = clickableCacheRef.current;
    let nearest: { element: HTMLElement; rect: DOMRect; distance: number } | null = null;

    for (const element of candidates) {
      if (!element.isConnected) continue;
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
      zoomScale,
      zoomState,
      mlGesture,
      recording,
      recorderLabel,
      datasetSamples,
      modelReady,
      mlProbabilities,
      mlDebug,
    }),
    [
      cameraReady,
      cursor,
      datasetSamples,
      depthTouchActive,
      mlGesture,
      modelReady,
      mlProbabilities,
      mlDebug,
      pinchConfidence,
      recorderLabel,
      recording,
      scrollModeActive,
      status,
      targetRect,
      zoomScale,
      zoomState,
    ],
  );
}

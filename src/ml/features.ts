import type { Landmark } from '../gesture/zoomGesture';

export type FeatureFrame = {
  vector: number[];
  handVelocity: number;
};

export const FEATURE_DIM = 32;

const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dist2D(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function safeRatio(numerator: number, denominator: number, fallback = 0) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) {
    return fallback;
  }
  return numerator / denominator;
}

export function computeHandScale(landmarks: Landmark[]) {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  if (!wrist || !middleMcp || !indexMcp || !pinkyMcp) return 0.12;
  return Math.max(0.02, (dist2D(wrist, middleMcp) + dist2D(indexMcp, pinkyMcp)) / 2);
}

function normalizedDistance(landmarks: Landmark[], a: number, b: number, handScale: number) {
  return safeRatio(dist2D(landmarks[a], landmarks[b]), handScale);
}

function curlProxy(landmarks: Landmark[], tip: number, pip: number, mcp: number) {
  const tipToMcp = dist2D(landmarks[tip], landmarks[mcp]);
  const pipToMcp = dist2D(landmarks[pip], landmarks[mcp]);
  return clamp(safeRatio(tipToMcp, pipToMcp, 1), 0, 3);
}

function tipVelocityNorm(
  landmarks: Landmark[],
  previousLandmarks: Landmark[] | null,
  index: number,
  handScale: number,
  dtSec: number,
) {
  if (!previousLandmarks) return 0;
  const now = landmarks[index];
  const prev = previousLandmarks[index];
  if (!now || !prev) return 0;
  const delta = Math.hypot(now.x - prev.x, now.y - prev.y);
  return safeRatio(delta, Math.max(1e-3, handScale * dtSec), 0);
}

function palmCenter(landmarks: Landmark[]) {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[INDEX_MCP];
  const middleMcp = landmarks[MIDDLE_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  return {
    x: (wrist.x + indexMcp.x + middleMcp.x + pinkyMcp.x) / 4,
    y: (wrist.y + indexMcp.y + middleMcp.y + pinkyMcp.y) / 4,
  };
}

export function extractFrameFeatures(
  landmarks: Landmark[],
  previousLandmarks: Landmark[] | null,
  dtMs: number,
): FeatureFrame {
  const handScale = computeHandScale(landmarks);
  const dtSec = Math.max(1 / 120, dtMs / 1000);

  const distances = [
    normalizedDistance(landmarks, THUMB_TIP, INDEX_TIP, handScale),
    normalizedDistance(landmarks, INDEX_TIP, MIDDLE_TIP, handScale),
    normalizedDistance(landmarks, MIDDLE_TIP, RING_TIP, handScale),
    normalizedDistance(landmarks, RING_TIP, PINKY_TIP, handScale),
    normalizedDistance(landmarks, THUMB_TIP, PINKY_TIP, handScale),
    normalizedDistance(landmarks, WRIST, INDEX_TIP, handScale),
    normalizedDistance(landmarks, WRIST, MIDDLE_TIP, handScale),
    normalizedDistance(landmarks, WRIST, RING_TIP, handScale),
    normalizedDistance(landmarks, WRIST, PINKY_TIP, handScale),
    normalizedDistance(landmarks, INDEX_MCP, PINKY_MCP, handScale),
    normalizedDistance(landmarks, THUMB_IP, THUMB_TIP, handScale),
    normalizedDistance(landmarks, INDEX_PIP, INDEX_TIP, handScale),
    normalizedDistance(landmarks, MIDDLE_PIP, MIDDLE_TIP, handScale),
    normalizedDistance(landmarks, RING_PIP, RING_TIP, handScale),
    normalizedDistance(landmarks, PINKY_PIP, PINKY_TIP, handScale),
  ];

  const curls = [
    curlProxy(landmarks, THUMB_TIP, THUMB_IP, THUMB_CMC),
    curlProxy(landmarks, INDEX_TIP, INDEX_PIP, INDEX_MCP),
    curlProxy(landmarks, MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP),
    curlProxy(landmarks, RING_TIP, RING_PIP, RING_MCP),
    curlProxy(landmarks, PINKY_TIP, PINKY_PIP, PINKY_MCP),
  ];

  const spread = [
    normalizedDistance(landmarks, THUMB_TIP, INDEX_MCP, handScale),
    normalizedDistance(landmarks, INDEX_TIP, MIDDLE_TIP, handScale),
    normalizedDistance(landmarks, MIDDLE_TIP, RING_TIP, handScale),
    normalizedDistance(landmarks, RING_TIP, PINKY_TIP, handScale),
    normalizedDistance(landmarks, WRIST, MIDDLE_MCP, handScale),
  ];

  const velocities = [
    tipVelocityNorm(landmarks, previousLandmarks, WRIST, handScale, dtSec),
    tipVelocityNorm(landmarks, previousLandmarks, THUMB_TIP, handScale, dtSec),
    tipVelocityNorm(landmarks, previousLandmarks, INDEX_TIP, handScale, dtSec),
    tipVelocityNorm(landmarks, previousLandmarks, MIDDLE_TIP, handScale, dtSec),
    tipVelocityNorm(landmarks, previousLandmarks, RING_TIP, handScale, dtSec),
    tipVelocityNorm(landmarks, previousLandmarks, PINKY_TIP, handScale, dtSec),
  ];

  let handVelocity = 0;
  if (previousLandmarks) {
    const centerNow = palmCenter(landmarks);
    const centerPrev = palmCenter(previousLandmarks);
    handVelocity = safeRatio(
      Math.hypot(centerNow.x - centerPrev.x, centerNow.y - centerPrev.y),
      Math.max(1e-3, handScale * dtSec),
      0,
    );
  }

  const vector = [...distances, ...curls, ...spread, ...velocities, handVelocity].map((value) =>
    clamp(Number.isFinite(value) ? value : 0, -5, 5),
  );

  return { vector, handVelocity };
}

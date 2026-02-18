import * as tf from '@tensorflow/tfjs';

export const GESTURE_LABELS = ['neutral', 'open_palm', 'pinch'] as const;
export type MlGestureLabel = (typeof GESTURE_LABELS)[number];

type PendingSwitch = { label: MlGestureLabel; frames: number } | null;

export type GestureInference = {
  label: MlGestureLabel;
  probabilities: Record<MlGestureLabel, number>;
  modelReady: boolean;
  errorCount: number;
  lastError: string | null;
  modelFeatureDim: number | null;
};

export type GestureInferencerOptions = {
  sequenceLength?: number;
  smoothingAlpha?: number;
  enterThreshold?: number;
  exitThreshold?: number;
  switchFrames?: number;
  transitionVelocityLimit?: number;
  inferEveryNFrames?: number;
};

const DEFAULT_MODEL_URL = '/models/gesture_model/model.json';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function argMax(values: number[]) {
  let bestIndex = 0;
  let bestValue = values[0] ?? Number.NEGATIVE_INFINITY;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}

function normalizeProbabilities(raw: number[]) {
  const clipped = raw.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const sum = clipped.reduce((acc, value) => acc + value, 0);
  if (sum <= 1e-6) return [1 / 3, 1 / 3, 1 / 3];
  return clipped.map((value) => value / sum);
}

export class GestureInferencer {
  private model: tf.LayersModel | null = null;
  private loadingPromise: Promise<void> | null = null;
  private readonly sequenceLength: number;
  private readonly smoothingAlpha: number;
  private readonly enterThreshold: number;
  private readonly exitThreshold: number;
  private readonly switchFrames: number;
  private readonly transitionVelocityLimit: number;
  private readonly inferEveryNFrames: number;

  private smoothed = [1 / 3, 1 / 3, 1 / 3];
  private stableLabel: MlGestureLabel = 'neutral';
  private pendingSwitch: PendingSwitch = null;
  private frameCounter = 0;
  private modelFeatureDim: number | null = null;
  private lastErrorAtMs = 0;
  private errorCount = 0;
  private lastError: string | null = null;

  constructor(options: GestureInferencerOptions = {}) {
    this.sequenceLength = options.sequenceLength ?? 30;
    this.smoothingAlpha = options.smoothingAlpha ?? 0.42;
    this.enterThreshold = options.enterThreshold ?? 0.5;
    this.exitThreshold = options.exitThreshold ?? 0.4;
    this.switchFrames = options.switchFrames ?? 1;
    this.transitionVelocityLimit = options.transitionVelocityLimit ?? 3.2;
    this.inferEveryNFrames = options.inferEveryNFrames ?? 2;
  }

  async loadModel(modelUrl = DEFAULT_MODEL_URL) {
    if (this.model) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      this.model = await tf.loadLayersModel(modelUrl);
      const shape = this.model.inputs?.[0]?.shape;
      const maybeFeatureDim = shape?.[2];
      this.modelFeatureDim = typeof maybeFeatureDim === 'number' ? maybeFeatureDim : null;
      tf.tidy(() => {
        const warmupFeatureDim = this.modelFeatureDim ?? 32;
        const warmup = tf.zeros([1, this.sequenceLength, warmupFeatureDim], 'float32');
        const out = this.model?.predict(warmup);
        if (!out) return;
        const tensor = Array.isArray(out) ? out[0] : out;
        if (tensor) tensor.dataSync();
      });
    })();

    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  isModelReady() {
    return this.model !== null;
  }

  reset() {
    this.smoothed = [1 / 3, 1 / 3, 1 / 3];
    this.stableLabel = 'neutral';
    this.pendingSwitch = null;
    this.frameCounter = 0;
    this.modelFeatureDim = null;
    this.lastErrorAtMs = 0;
    this.errorCount = 0;
    this.lastError = null;
  }

  private buildInference() {
    return {
      label: this.stableLabel,
      probabilities: {
        neutral: this.smoothed[0],
        open_palm: this.smoothed[1],
        pinch: this.smoothed[2],
      },
      modelReady: this.isModelReady(),
      errorCount: this.errorCount,
      lastError: this.lastError,
      modelFeatureDim: this.modelFeatureDim,
    } satisfies GestureInference;
  }

  private updateStableLabel(handVelocity: number) {
    if (handVelocity > this.transitionVelocityLimit) {
      this.pendingSwitch = null;
      return;
    }

    const currentIndex = GESTURE_LABELS.indexOf(this.stableLabel);
    const currentScore = this.smoothed[currentIndex];
    if (this.stableLabel !== 'neutral' && currentScore < this.exitThreshold && this.smoothed[0] > this.enterThreshold) {
      this.stableLabel = 'neutral';
      this.pendingSwitch = null;
      return;
    }

    const candidateIndex = argMax(this.smoothed);
    const candidate = GESTURE_LABELS[candidateIndex];
    const candidateScore = this.smoothed[candidateIndex];

    if (candidate === this.stableLabel || candidateScore < this.enterThreshold) {
      this.pendingSwitch = null;
      return;
    }

    if (!this.pendingSwitch || this.pendingSwitch.label !== candidate) {
      this.pendingSwitch = { label: candidate, frames: 1 };
      return;
    }

    this.pendingSwitch.frames += 1;
    if (this.pendingSwitch.frames >= this.switchFrames) {
      this.stableLabel = candidate;
      this.pendingSwitch = null;
    }
  }

  predict(sequence: number[][], handVelocity: number): GestureInference {
    if (!this.model || sequence.length !== this.sequenceLength || sequence.length === 0) {
      return this.buildInference();
    }

    const featureDim = sequence[0]?.length ?? 0;
    if (featureDim === 0) return this.buildInference();
    if (this.modelFeatureDim !== null && featureDim !== this.modelFeatureDim) return this.buildInference();
    if (!Number.isFinite(handVelocity)) handVelocity = 0;

    this.frameCounter += 1;
    if (this.frameCounter % this.inferEveryNFrames !== 0) {
      this.updateStableLabel(handVelocity);
      return this.buildInference();
    }

    let raw: number[] = [1 / 3, 1 / 3, 1 / 3];
    try {
      raw = tf.tidy(() => {
        const input = tf.tensor3d([sequence], [1, this.sequenceLength, featureDim], 'float32');
        const output = this.model?.predict(input);
        if (!output) return [1 / 3, 1 / 3, 1 / 3];
        const tensor = Array.isArray(output) ? output[0] : output;
        if (!tensor) return [1 / 3, 1 / 3, 1 / 3];
        const flat = tensor.flatten();
        const values = Array.from(flat.dataSync());
        if (values.length < GESTURE_LABELS.length) return [1 / 3, 1 / 3, 1 / 3];
        return values.slice(0, GESTURE_LABELS.length);
      });
    } catch (error) {
      this.errorCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (now - this.lastErrorAtMs > 1500) {
        this.lastErrorAtMs = now;
        console.error('[GestureInferencer] predict failed:', error);
      }
      return this.buildInference();
    }

    const normalized = normalizeProbabilities(raw);
    this.smoothed = this.smoothed.map((value, index) =>
      clamp(this.smoothingAlpha * normalized[index] + (1 - this.smoothingAlpha) * value, 0, 1),
    );

    const sum = this.smoothed.reduce((acc, value) => acc + value, 0);
    if (sum > 1e-6) {
      this.smoothed = this.smoothed.map((value) => value / sum);
    }
    this.lastError = null;

    this.updateStableLabel(handVelocity);
    return this.buildInference();
  }
}

// ═══════════════════════════════════════════════════════════════════
// POINTER FILTER — Smoothes hand tracking coordinates.
//
// Uses the "One Euro Filter" algorithm:
//   - At LOW speed:  heavy smoothing → reduces jitter
//   - At HIGH speed: light smoothing → stays responsive
//
// This is why your drawing looks smooth instead of shaky.
// ═══════════════════════════════════════════════════════════════════

/**
 * Helper: compute the smoothing factor (alpha) for a given
 * time-step and cutoff frequency.
 */
function smoothingFactor(deltaSeconds, cutoff) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / deltaSeconds);
}

/**
 * Simple low-pass filter — blends new values with old values.
 * alpha = 1 means "use new value only" (no smoothing).
 * alpha = 0 means "keep old value" (maximum smoothing).
 */
class LowPassFilter {
  constructor() {
    this.initialized = false;
    this.value = 0;
  }

  filter(nextValue, alpha) {
    if (!this.initialized) {
      this.initialized = true;
      this.value = nextValue;
      return nextValue;
    }
    this.value = alpha * nextValue + (1 - alpha) * this.value;
    return this.value;
  }

  reset() {
    this.initialized = false;
    this.value = 0;
  }
}

/**
 * One Euro Filter — adaptive low-pass filter.
 *
 * Parameters:
 *   minCutoff: base cutoff frequency (lower = more smooth at rest)
 *   beta:      speed coefficient (higher = less lag during fast movement)
 *   derivativeCutoff: cutoff for the speed estimator
 */
class OneEuroFilter {
  constructor({ minCutoff = 1.2, beta = 0.02, derivativeCutoff = 1.5 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.positionFilter = new LowPassFilter();
    this.derivativeFilter = new LowPassFilter();
    this.lastValue = null;
    this.lastTimestamp = null;
  }

  filter(value, timestampMs) {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs;
      this.lastValue = value;
      return this.positionFilter.filter(value, 1);
    }

    const deltaSeconds = Math.max((timestampMs - this.lastTimestamp) / 1000, 1 / 240);
    const rawDerivative = (value - this.lastValue) / deltaSeconds;
    const derivativeAlpha = smoothingFactor(deltaSeconds, this.derivativeCutoff);
    const filteredDerivative = this.derivativeFilter.filter(rawDerivative, derivativeAlpha);

    // Adapt the cutoff: fast movement → higher cutoff → less smoothing
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const positionAlpha = smoothingFactor(deltaSeconds, cutoff);
    const filteredValue = this.positionFilter.filter(value, positionAlpha);

    this.lastTimestamp = timestampMs;
    this.lastValue = value;
    return filteredValue;
  }

  reset() {
    this.positionFilter.reset();
    this.derivativeFilter.reset();
    this.lastValue = null;
    this.lastTimestamp = null;
  }
}

/**
 * PointFilter — applies One Euro Filter to both X and Y coordinates.
 *
 * Usage:
 *   const filter = new PointFilter();
 *   const [smoothX, smoothY] = filter.filter(rawX, rawY, timestamp);
 */
export class PointFilter {
  constructor() {
    this.xFilter = new OneEuroFilter();
    this.yFilter = new OneEuroFilter();
  }

  filter(x, y, timestampMs) {
    return [
      Math.round(this.xFilter.filter(x, timestampMs)),
      Math.round(this.yFilter.filter(y, timestampMs)),
    ];
  }

  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
  }
}

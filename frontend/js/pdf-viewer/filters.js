import { FILTER_PRESETS } from "./constants.js";

export class OneEuroFilter {
  constructor(freq = 60, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  _alpha(cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / this.freq;
    return 1.0 / (1.0 + tau / te);
  }

  _expSmoothing(a, x, xPrev) {
    return a * x + (1 - a) * xPrev;
  }

  filter(x, timestamp) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = timestamp;
      return x;
    }

    const dt = timestamp - this.tPrev;
    this.tPrev = timestamp;

    if (dt > 0) {
      this.freq = 1.0 / dt;
    }

    const dx = (x - this.xPrev) * this.freq;
    const adx = this._alpha(this.dCutoff);
    const dxSmooth = this._expSmoothing(adx, dx, this.dxPrev);
    this.dxPrev = dxSmooth;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmooth);
    const ax = this._alpha(cutoff);

    const xSmooth = this._expSmoothing(ax, x, this.xPrev);
    this.xPrev = xSmooth;

    return xSmooth;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

function createFilter(config) {
  return new OneEuroFilter(config.freq, config.minCutoff, config.beta, config.dCutoff);
}

export function createViewerFilters() {
  return {
    ptrFilterX: createFilter(FILTER_PRESETS.pointer),
    ptrFilterY: createFilter(FILTER_PRESETS.pointer),
    drawFilterX: createFilter(FILTER_PRESETS.drawing),
    drawFilterY: createFilter(FILTER_PRESETS.drawing),
    overlayFilterX: createFilter(FILTER_PRESETS.overlay),
    overlayFilterY: createFilter(FILTER_PRESETS.overlay),
    scrollFilter: createFilter(FILTER_PRESETS.scroll),
  };
}

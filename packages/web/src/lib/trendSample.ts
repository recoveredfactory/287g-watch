// Shared sampling for the national trend series (#167 video). The chart's
// gliding labels and the video counter's "agreements" figure must agree, so
// both read the series through the same linear interpolation at a fractional
// (Jan-2025-epoch) cursor — no wall-clock tween, so it's deterministic and the
// frame-stepped bake stays exact.

const EPOCH_YEAR = 2025;

// "YYYY-MM" sample labels → integer month indices (Dec 2024 = -1, Jan 2025 = 0).
export function monthsToIdx(trendMonths: string[]): number[] {
  return trendMonths.map(
    (ym) => (Number(ym.slice(0, 4)) - EPOCH_YEAR) * 12 + (Number(ym.slice(5, 7)) - 1),
  );
}

// Linearly interpolate a monthly series at a fractional cursor, clamped to the
// sampled range. `months` is index-aligned with `values` (ascending).
export function interpAt(values: number[], months: number[], cursor: number): number {
  if (!values.length) return 0;
  if (cursor <= months[0]) return values[0];
  const last = months.length - 1;
  if (cursor >= months[last]) return values[last];
  for (let i = 0; i < last; i++) {
    if (cursor >= months[i] && cursor <= months[i + 1]) {
      const span = months[i + 1] - months[i] || 1;
      const frac = (cursor - months[i]) / span;
      return values[i] + (values[i + 1] - values[i]) * frac;
    }
  }
  return values[last];
}

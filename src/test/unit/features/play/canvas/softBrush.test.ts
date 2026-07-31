import { describe, expect, it } from 'vitest';
import {
  compositePassOpacity,
  SOFT_BRUSH_PASS_COUNT,
  softBrushPasses,
} from '../../../../../features/play/canvas/softBrush';

describe('soft brush profile', () => {
  it('feathers from the full diameter to the hardness core', () => {
    const passes = softBrushPasses(80, 0.6, 0.25);

    expect(passes).toHaveLength(SOFT_BRUSH_PASS_COUNT);
    expect(passes[0].width).toBe(80);
    expect(passes.at(-1)?.width).toBeCloseTo(20);
    expect(
      passes.every(
        (pass, index) =>
          index === 0 || pass.width < passes[index - 1].width,
      ),
    ).toBe(true);
    const cumulativeOpacity = passes.reduce<number[]>((values, pass) => {
      const previous = values.at(-1) ?? 0;
      values.push(previous + pass.alpha * (1 - previous));
      return values;
    }, []);
    expect(
      cumulativeOpacity.every(
        (value, index) =>
          index === 0 || value > cumulativeOpacity[index - 1],
      ),
    ).toBe(true);
    expect(compositePassOpacity(passes)).toBeCloseTo(0.6, 10);
  });

  it('supports a fully soft center and collapses 100% hardness to one pass', () => {
    const fullySoft = softBrushPasses(40, 1, 0);
    expect(fullySoft).toHaveLength(SOFT_BRUSH_PASS_COUNT);
    expect(fullySoft.at(-1)?.width).toBeCloseTo(0.001);
    expect(compositePassOpacity(fullySoft)).toBeCloseTo(1, 10);

    expect(softBrushPasses(40, 0.5, 1)).toEqual([
      { alpha: 0.5, width: 40 },
    ]);
  });
});

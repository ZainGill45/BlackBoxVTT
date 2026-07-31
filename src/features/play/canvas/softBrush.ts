export interface SoftBrushPass {
  alpha: number;
  width: number;
}

export const SOFT_BRUSH_PASS_COUNT = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

/**
 * Produces outer-to-inner vector passes whose source-over composition follows
 * a smooth radial opacity ramp without exceeding the requested center opacity.
 */
export function softBrushPasses(
  width: number,
  opacity: number,
  hardness: number,
): SoftBrushPass[] {
  const diameter = Math.max(0.001, width);
  const targetOpacity = clamp(opacity, 0, 1);
  const normalizedHardness = clamp(hardness, 0, 1);
  if (normalizedHardness >= 1 || targetOpacity === 0) {
    return [{ alpha: targetOpacity, width: diameter }];
  }

  const coreWidth = Math.max(diameter * normalizedHardness, 0.001);
  let accumulated = 0;
  return Array.from({ length: SOFT_BRUSH_PASS_COUNT }, (_, index) => {
    const progress = (index + 1) / SOFT_BRUSH_PASS_COUNT;
    const widthProgress = index / (SOFT_BRUSH_PASS_COUNT - 1);
    const nextAccumulated = targetOpacity * smoothstep(progress);
    const alpha =
      accumulated >= 1
        ? 0
        : (nextAccumulated - accumulated) / (1 - accumulated);
    accumulated = nextAccumulated;
    return {
      alpha: clamp(alpha, 0, 1),
      width: diameter - (diameter - coreWidth) * widthProgress,
    };
  });
}

export function compositePassOpacity(passes: SoftBrushPass[]): number {
  return passes.reduce(
    (opacity, pass) => opacity + pass.alpha * (1 - opacity),
    0,
  );
}

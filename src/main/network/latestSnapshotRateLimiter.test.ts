import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MIN_TRANSFORM_PREVIEW_RATE,
} from '../../shared/network';
import { LatestSnapshotRateLimiter } from './latestSnapshotRateLimiter';

describe('LatestSnapshotRateLimiter', () => {
  it('emits immediately after idle and coalesces every later value at the configured rate', () => {
    vi.useFakeTimers();
    const emitted: number[] = [];
    let rate = MIN_TRANSFORM_PREVIEW_RATE;
    const limiter = new LatestSnapshotRateLimiter(
      () => rate,
      (value: number) => emitted.push(value),
    );

    limiter.push(1);
    limiter.push(2);
    limiter.push(3);
    expect(emitted).toEqual([1]);

    vi.advanceTimersByTime(
      Math.ceil(1_000 / MIN_TRANSFORM_PREVIEW_RATE),
    );
    expect(emitted).toEqual([1, 3]);

    limiter.push(4);
    rate = MAX_TRANSFORM_PREVIEW_RATE;
    limiter.rateChanged();
    vi.advanceTimersByTime(
      Math.ceil(1_000 / MAX_TRANSFORM_PREVIEW_RATE),
    );
    expect(emitted).toEqual([1, 3, 4]);
  });

  it('discards a pending value when cleared', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const limiter = new LatestSnapshotRateLimiter(
      () => MIN_TRANSFORM_PREVIEW_RATE,
      emit,
    );

    limiter.push('start');
    limiter.push('clear');
    limiter.clear();
    vi.advanceTimersByTime(100);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('start');
  });
});

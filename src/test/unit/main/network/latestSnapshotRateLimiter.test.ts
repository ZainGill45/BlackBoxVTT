import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSFORM_PREVIEW_RATE,
  MIN_TRANSFORM_PREVIEW_RATE,
} from '../../../../shared/network';
import { LatestSnapshotRateLimiter } from '../../../../main/network/latestSnapshotRateLimiter';

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

  it('drops a matching pending snapshot without discarding another operation', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const limiter = new LatestSnapshotRateLimiter<{
      operationId: string;
      sequence: number;
    }>(
      () => MIN_TRANSFORM_PREVIEW_RATE,
      emit,
    );

    limiter.push({ operationId: 'first', sequence: 1 });
    limiter.push({ operationId: 'cancelled', sequence: 2 });
    limiter.drop((value) => value.operationId === 'cancelled');
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(1);

    limiter.push({ operationId: 'kept', sequence: 3 });
    limiter.drop((value) => value.operationId === 'different');
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenLastCalledWith({
      operationId: 'kept',
      sequence: 3,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './loginRateLimiter';

describe('LoginRateLimiter', () => {
  it('applies and expires independent per-IP and per-account cooldowns', () => {
    const limiter = new LoginRateLimiter();
    const ip = 'ip:192.0.2.1';
    const account = 'account:campaign:alice';

    for (let index = 0; index < 5; index += 1) {
      limiter.recordFailure([ip, account], 1_000 + index);
    }
    expect(limiter.isLimited([ip], 2_000)).toBe(true);
    expect(limiter.isLimited([account], 2_000)).toBe(true);
    expect(limiter.isLimited(['ip:198.51.100.2'], 2_000)).toBe(false);
    expect(limiter.isLimited([ip, account], 302_000)).toBe(false);
  });
});

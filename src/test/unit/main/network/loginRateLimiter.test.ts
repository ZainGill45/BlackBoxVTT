import { beforeEach, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '../../../../main/network/loginRateLimiter';

const ip = 'ip:192.0.2.1';
const account = 'account:campaign:alice';

let limiter: LoginRateLimiter;

beforeEach(() => {
  limiter = new LoginRateLimiter();
  // Exhausts the attempt budget, charging every key involved in the failure.
  for (let index = 0; index < 5; index += 1) {
    limiter.recordFailure([ip, account], 1_000 + index);
  }
});

describe('LoginRateLimiter', () => {
  it('locks out the address that ran out of attempts', () => {
    expect(limiter.isLimited([ip], 2_000)).toBe(true);
  });

  it('locks out the account that ran out of attempts', () => {
    expect(limiter.isLimited([account], 2_000)).toBe(true);
  });

  it('leaves an unrelated address alone', () => {
    // Otherwise one failing client could lock every player out of a campaign.
    expect(limiter.isLimited(['ip:198.51.100.2'], 2_000)).toBe(false);
  });

  it('expires both cooldowns once the window has passed', () => {
    expect(limiter.isLimited([ip, account], 302_000)).toBe(false);
  });
});

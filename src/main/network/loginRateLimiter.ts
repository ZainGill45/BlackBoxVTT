const FAILURE_WINDOW_MS = 60_000;
const COOLDOWN_MS = 5 * 60_000;
const MAX_FAILURES = 5;

interface LimitState {
  cooldownUntil: number;
  failures: number[];
}

export class LoginRateLimiter {
  private readonly states = new Map<string, LimitState>();

  isLimited(keys: readonly string[], now = Date.now()): boolean {
    return keys.some((key) => {
      const state = this.states.get(key);
      if (!state) {
        return false;
      }

      if (state.cooldownUntil > now) {
        return true;
      }

      this.prune(state, now);
      if (state.failures.length === 0) {
        this.states.delete(key);
      }
      return false;
    });
  }

  recordFailure(keys: readonly string[], now = Date.now()): void {
    for (const key of keys) {
      const state = this.states.get(key) ?? {
        cooldownUntil: 0,
        failures: [],
      };
      this.prune(state, now);
      state.failures.push(now);

      if (state.failures.length >= MAX_FAILURES) {
        state.cooldownUntil = now + COOLDOWN_MS;
        state.failures = [];
      }
      this.states.set(key, state);
    }
  }

  clear(keys: readonly string[]): void {
    keys.forEach((key) => this.states.delete(key));
  }

  private prune(state: LimitState, now: number): void {
    const cutoff = now - FAILURE_WINDOW_MS;
    state.failures = state.failures.filter((failure) => failure > cutoff);
    if (state.cooldownUntil <= now) {
      state.cooldownUntil = 0;
    }
  }
}

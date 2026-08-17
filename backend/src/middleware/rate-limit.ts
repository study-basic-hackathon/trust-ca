export type FixedWindowRateLimiter = {
  consume(key: string): boolean;
};

export function createFixedWindowRateLimiter(
  limit: number,
  windowMs = 60_000,
  now: () => number = Date.now,
): FixedWindowRateLimiter {
  const windows = new Map<string, { count: number; startedAt: number }>();

  return {
    consume(key) {
      const currentTime = now();
      const current = windows.get(key);
      if (!current || currentTime - current.startedAt >= windowMs) {
        windows.set(key, { count: 1, startedAt: currentTime });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
  };
}

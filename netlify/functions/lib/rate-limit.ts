const requestLog = new Map<string, number[]>();

export function checkRateLimit(
  ip: string,
  maxPerHour: number
): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Get existing timestamps for this IP, filter to last hour
  const timestamps = (requestLog.get(ip) || []).filter((t) => t > oneHourAgo);

  if (timestamps.length >= maxPerHour) {
    const oldest = timestamps[0];
    const retryAfterSeconds = Math.ceil((oldest + 60 * 60 * 1000 - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  // Record this request
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return { allowed: true };
}

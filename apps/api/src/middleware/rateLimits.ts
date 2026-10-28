import rateLimit from 'express-rate-limit';

const standard = {
  standardHeaders: true as const,
  legacyHeaders: false as const,
  message: {
    error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' },
  },
};

/** Authentication endpoints: brute-force protection. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  ...standard,
});

/** Password reset / verification: stricter still. */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  ...standard,
});

/** Resource-intensive endpoints that launch outbound requests or browsers. */
export const heavyLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 40,
  keyGenerator: (req) => (req.auth ? `user:${String(req.auth.user._id)}` : req.ip ?? 'anonymous'),
  ...standard,
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  ...standard,
});

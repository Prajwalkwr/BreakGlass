import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { loadEnv, logger, isAllowedOrigin, serviceUnavailable, databaseState } from '@breakglass/core';
import { v1Router } from './routes/v1';
import { healthRouter } from './routes/v1/misc.routes';
import { webhooksRouter } from './routes/v1/webhooks.routes';
import { attachSession, csrfProtection } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';

export function createApp() {
  const env = loadEnv();
  const app = express();

  // Behind a proxy (Fly, Render, nginx) the client IP arrives in X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // This process serves JSON only.
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests and non-browser clients have no Origin header.
        if (!origin) return callback(null, true);
        // Disallowed origins simply receive no CORS headers (the browser then
        // blocks the response); the CSRF middleware below rejects the write.
        return callback(null, isAllowedOrigin(origin, undefined, env));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'x-requested-with'],
      maxAge: 600,
    }),
  );

  app.use(
    pinoHttp({
      logger: logger(),
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/health/live',
      },
      customProps: (req) => ({ requestId: req.id }),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(cookieParser());

  // Health checks are unauthenticated and dependency-aware.
  app.use('/api/v1/health', healthRouter);

  // Webhooks need the exact raw body for signature verification, so they are
  // mounted before the JSON parser and are exempt from CSRF (they are
  // authenticated by their HMAC signature instead).
  app.use('/api/v1/webhooks', webhooksRouter);

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.use('/api/v1', (req, res, next) => {
    if (databaseState() === 'disconnected') {
      return next(serviceUnavailable('The application database is not reachable. Try again shortly.'));
    }
    return next();
  });

  app.use('/api/v1', attachSession, csrfProtection, v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

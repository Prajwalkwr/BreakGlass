import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError, logger } from '@breakglass/core';
import { ZodError } from 'zod';
import mongoose from 'mongoose';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (isAppError(error)) {
    res.status(error.statusCode).json(error.toBody());
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'invalid_input',
        message: 'Some fields need attention.',
        details: error.issues.map((issue) => ({
          path: issue.path.filter((part) => typeof part === 'string' || typeof part === 'number').join('.') || 'form',
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      error: {
        code: 'invalid_input',
        message: 'Some fields need attention.',
        details: Object.values(error.errors).map((issue) => ({ path: issue.path, message: issue.message })),
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'invalid_input', message: 'That identifier is not valid.' } });
    return;
  }

  if ((error as { code?: number }).code === 11000) {
    res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists.' },
    });
    return;
  }

  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'The request body is too large.' } });
    return;
  }

  if ((error as AppError)?.message === 'not_found') {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
    return;
  }
  if ((error as AppError)?.message === 'resolved') {
    res.status(409).json({ error: { code: 'conflict', message: 'This incident is already resolved.' } });
    return;
  }

  logger().error(
    { err: (error as Error).message, stack: (error as Error).stack, path: req.path, method: req.method },
    'Unhandled API error',
  );
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side. The error has been logged.' },
  });
}

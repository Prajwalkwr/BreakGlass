import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async route so rejected promises reach the error middleware. */
export function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function ok<T>(res: Response, data: T, status = 200) {
  res.status(status).json(data);
}

export function parsePagination(req: Request, defaultLimit = 25) {
  const limit = Math.min(Math.max(Number(req.query.limit) || defaultLimit, 1), 100);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  return { limit, cursor };
}

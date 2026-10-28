import express, { Router } from 'express';
import {
  handleGithubWebhook,
  logger,
} from '@breakglass/core';

import { asyncHandler } from '../../lib/http';

/**
 * Provider webhooks. Mounted before the JSON body parser because signature
 * verification needs the exact raw bytes.
 */
export const webhooksRouter = Router();

webhooksRouter.post(
  '/github/:projectId',
  express.raw({ type: '*/*', limit: '256kb' }),
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const result = await handleGithubWebhook({
      projectId: req.params.projectId,
      rawBody,
      signature: req.get('x-hub-signature-256'),
      event: req.get('x-github-event'),
      deliveryId: req.get('x-github-delivery'),
    });

    if (!result.accepted) {
      logger().warn({ projectId: req.params.projectId, status: result.status, message: result.message }, 'GitHub webhook rejected');
    }
    res.status(result.status).json({ ok: result.accepted, message: result.message });
  }),
);

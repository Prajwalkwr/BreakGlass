import { Router } from 'express';
import { authRouter } from './auth.routes';
import { workspacesRouter } from './workspaces.routes';
import { projectsRouter } from './projects.routes';
import { checksRouter } from './checks.routes';
import { incidentsRouter } from './incidents.routes';
import { artifactsRouter, runArtifactsRouter } from './misc.routes';
import { authLimiter, sensitiveLimiter, apiLimiter } from '../../middleware/rateLimits';

export const v1Router = Router();

v1Router.use('/auth/register', authLimiter);
v1Router.use('/auth/login', authLimiter);
v1Router.use('/auth/forgot-password', sensitiveLimiter);
v1Router.use('/auth/reset-password', sensitiveLimiter);

v1Router.use('/auth', authRouter);
v1Router.use('/workspaces', apiLimiter, workspacesRouter);

// Nested resource routers keep URLs consistent and make tenant scoping obvious.
v1Router.use('/workspaces/:workspaceId/projects', projectsRouter);
v1Router.use('/workspaces/:workspaceId/checks', checksRouter);
v1Router.use('/workspaces/:workspaceId/incidents', incidentsRouter);
v1Router.use('/workspaces/:workspaceId/artifacts', runArtifactsRouter);

v1Router.use('/artifacts', artifactsRouter);

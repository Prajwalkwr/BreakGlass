import { Types } from 'mongoose';
import type { ApiCheckConfig, CheckType, HttpCheckConfig, BrowserCheckConfig } from '@breakglass/shared';
import { decryptSecret } from '../lib/crypto';
import { Secret } from '../models/infra';
import { runHttpCheck } from './runners/http';
import { runApiCheck } from './runners/api';
import { runBrowserCheck } from './runners/browser';
import { failureResult, type ExecutionContext, type ExecutionResult } from './types';

export interface ExecuteCheckParams {
  checkId: string;
  workspaceId: string;
  projectId: string;
  checkName: string;
  type: CheckType;
  config: unknown;
  timeoutMs: number;
  logger?: ExecutionContext['logger'];
  /** In-memory credential values used only for pre-save configuration tests. */
  inlineSecrets?: Map<string, string>;
}

/**
 * Resolves encrypted credentials for a check. Secrets are looked up by the
 * caller's workspace *and* check, so an id guessed from another tenant can
 * never be decrypted.
 */
function buildSecretResolver(params: ExecuteCheckParams) {
  const cache = new Map<string, string | null>();
  return async (secretRef: string): Promise<string | null> => {
    if (cache.has(secretRef)) return cache.get(secretRef) ?? null;
    if (params.inlineSecrets?.has(secretRef)) {
      const inline = params.inlineSecrets.get(secretRef) ?? null;
      cache.set(secretRef, inline);
      return inline;
    }
    if (!Types.ObjectId.isValid(secretRef)) return null;

    // `params.checkId` is not always an ObjectId (the ad-hoc configuration
    // test runs with the sentinel id 'adhoc'), so the check scope is only
    // applied when it is a real id. Project-level secrets (checkId: null) are
    // always eligible; another check's secrets are not.
    const scope: Record<string, unknown>[] = [{ checkId: null }];
    if (Types.ObjectId.isValid(params.checkId)) scope.push({ checkId: params.checkId });

    const secret = await Secret.findOne({
      _id: secretRef,
      workspaceId: params.workspaceId,
      $or: scope,
    }).select('+ciphertext');

    if (!secret) {
      cache.set(secretRef, null);
      return null;
    }

    try {
      const plaintext = decryptSecret(secret.ciphertext);
      void Secret.updateOne({ _id: secret._id }, { $set: { lastUsedAt: new Date() } }).catch(() => undefined);
      cache.set(secretRef, plaintext);
      return plaintext;
    } catch {
      cache.set(secretRef, null);
      return null;
    }
  };
}

export async function executeCheck(params: ExecuteCheckParams): Promise<ExecutionResult> {
  const ctx: ExecutionContext = {
    checkId: params.checkId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    checkName: params.checkName,
    timeoutMs: params.timeoutMs,
    secretResolver: buildSecretResolver(params),
    logger: params.logger,
  };

  switch (params.type) {
    case 'http':
      return runHttpCheck(params.config as HttpCheckConfig, ctx);
    case 'api':
      return runApiCheck(params.config as ApiCheckConfig, ctx);
    case 'browser':
      return runBrowserCheck(params.config as BrowserCheckConfig, ctx);
    default:
      return failureResult('config_error', `Unsupported check type "${String(params.type)}".`, 0);
  }
}

import type { FailureCategory } from '@breakglass/shared';
import type { RunEvidence } from '../models/checkRun';

export interface ArtifactPayload {
  kind: 'screenshot' | 'trace' | 'html';
  contentType: string;
  data: Buffer;
}

export interface ExecutionContext {
  checkId: string;
  workspaceId: string;
  projectId: string;
  checkName: string;
  /** Decrypted secrets resolved by check id → value. Never logged. */
  secretResolver: (secretRef: string) => Promise<string | null>;
  timeoutMs: number;
  logger?: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}

export interface ExecutionResult {
  success: boolean;
  failureCategory: FailureCategory | null;
  /** Sanitized, user-facing explanation. */
  failureMessage: string | null;
  /** Short one-liner for lists and emails. */
  errorSummary: string | null;
  httpStatus: number | null;
  durationMs: number;
  evidence: RunEvidence;
  artifacts: ArtifactPayload[];
}

export function successResult(
  durationMs: number,
  evidence: RunEvidence,
  artifacts: ArtifactPayload[] = [],
  httpStatus: number | null = null,
): ExecutionResult {
  return {
    success: true,
    failureCategory: null,
    failureMessage: null,
    errorSummary: null,
    httpStatus,
    durationMs,
    evidence,
    artifacts,
  };
}

export function failureResult(
  category: FailureCategory,
  failureMessage: string,
  durationMs: number,
  evidence: RunEvidence = {},
  artifacts: ArtifactPayload[] = [],
  httpStatus: number | null = null,
): ExecutionResult {
  return {
    success: false,
    failureCategory: category,
    failureMessage,
    errorSummary: failureMessage.length > 200 ? `${failureMessage.slice(0, 197)}…` : failureMessage,
    httpStatus,
    durationMs,
    evidence,
    artifacts,
  };
}

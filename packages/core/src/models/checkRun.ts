import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { CheckType, FailureCategory } from '@breakglass/shared';

const baseOptions = {
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false as const,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      return ret;
    },
  },
};

export interface RunArtifact {
  artifactId: string;
  kind: 'screenshot' | 'trace' | 'html';
  bytes: number;
  createdAt?: Date;
}

export interface RunEvidence {
  /** HTTP checks */
  httpStatus?: number | null;
  statusText?: string | null;
  finalUrl?: string | null;
  redirectChain?: string[];
  responseTimeMs?: number | null;
  contentType?: string | null;
  responseHeaders?: Record<string, string>;
  bodyPreview?: string | null;
  matchedAssertion?: string | null;
  /** Browser checks */
  steps?: { index: number; type: string; ok: boolean; durationMs: number; detail?: string }[];
  failedStepIndex?: number | null;
  consoleErrors?: string[];
  authResponses?: number[];
  blockedRequest?: string | null;
  /** JSON API checks */
  json?: { assertions: { path: string; operator: string; ok: boolean; detail?: string }[] };
}

export interface CheckRunDoc extends Document {
  _id: Types.ObjectId;
  runId: string;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  checkId: Types.ObjectId;
  checkType: CheckType;
  checkName: string;
  configVersion: number;
  configSnapshot: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number;
  success: boolean;
  failureCategory: FailureCategory | null;
  httpStatus: number | null;
  failureMessage: string | null;
  errorSummary: string | null;
  attempt: number;
  maxAttempts: number;
  triggeredBy: 'schedule' | 'manual' | 'test' | 'recovery';
  workerId: string | null;
  jobId: string | null;
  incidentId: Types.ObjectId | null;
  countedTowardIncident: boolean;
  evidence: RunEvidence;
  artifacts: RunArtifact[];
  createdAt: Date;
}

const artifactSchema = new Schema<RunArtifact>(
  {
    artifactId: { type: String, required: true },
    kind: { type: String, enum: ['screenshot', 'trace', 'html'], required: true },
    bytes: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const runSchema = new Schema<CheckRunDoc>(
  {
    runId: { type: String, required: true, unique: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    checkId: { type: Schema.Types.ObjectId, ref: 'Check', required: true, index: true },
    checkType: { type: String, enum: ['http', 'api', 'browser'], required: true },
    checkName: { type: String, required: true },
    configVersion: { type: Number, default: 1 },
    configSnapshot: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    success: { type: Boolean, required: true },
    failureCategory: { type: String, default: null },
    httpStatus: { type: Number, default: null },
    failureMessage: { type: String, default: null, maxlength: 1000 },
    errorSummary: { type: String, default: null, maxlength: 600 },
    attempt: { type: Number, default: 1 },
    maxAttempts: { type: Number, default: 3 },
    triggeredBy: { type: String, enum: ['schedule', 'manual', 'test', 'recovery'], default: 'schedule' },
    workerId: { type: String, default: null },
    jobId: { type: String, default: null },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    countedTowardIncident: { type: Boolean, default: false },
    evidence: { type: Schema.Types.Mixed, default: {} },
    artifacts: { type: [artifactSchema], default: [] },
  },
  baseOptions,
);

// Time-ordered history reads (highest-volume queries).
runSchema.index({ checkId: 1, startedAt: -1 });
runSchema.index({ projectId: 1, startedAt: -1 });
runSchema.index({ workspaceId: 1, startedAt: -1 });
runSchema.index({ workspaceId: 1, success: 1, startedAt: -1 });
// NOTE: run history retention is enforced by the retention service
// (RETENTION_DAYS_RUNS), not a TTL index, so the window stays configurable
// without an index migration.

export const CheckRun: Model<CheckRunDoc> =
  (mongoose.models.CheckRun as Model<CheckRunDoc>) ||
  mongoose.model<CheckRunDoc>('CheckRun', runSchema);

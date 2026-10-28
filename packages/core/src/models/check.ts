import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { CheckRuntimeStatus, CheckType, FailureCategory, IncidentSeverity } from '@breakglass/shared';

const baseOptions = {
  timestamps: true,
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

export interface LastResultEmbedded {
  success: boolean;
  at: Date;
  durationMs: number;
  failureCategory: FailureCategory | null;
  httpStatus: number | null;
  errorSummary: string | null;
  runId: string;
}

export interface CheckDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  type: CheckType;
  /** Type-specific configuration. Validated by Zod before write. */
  config: Record<string, unknown>;
  configVersion: number;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  severity: IncidentSeverity;
  runtimeStatus: CheckRuntimeStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastResult: LastResultEmbedded | null;
  lastRunId: string | null;
  pausedReason: string | null;
  /** Short-lived execution lock so one check never runs twice concurrently. */
  activeRunUntil: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const lastResultSchema = new Schema<LastResultEmbedded>(
  {
    success: { type: Boolean, required: true },
    at: { type: Date, required: true },
    durationMs: { type: Number, default: 0 },
    failureCategory: { type: String, default: null },
    httpStatus: { type: Number, default: null },
    errorSummary: { type: String, default: null, maxlength: 600 },
    runId: { type: String, default: null },
  },
  { _id: false },
);

const checkSchema = new Schema<CheckDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['http', 'api', 'browser'], required: true },
    config: { type: Schema.Types.Mixed, required: true },
    configVersion: { type: Number, default: 1 },
    enabled: { type: Boolean, default: false },
    intervalSeconds: { type: Number, required: true, min: 60, max: 86400 },
    timeoutMs: { type: Number, required: true, min: 3000, max: 60000 },
    failureThreshold: { type: Number, default: 2, min: 1, max: 10 },
    recoveryThreshold: { type: Number, default: 2, min: 1, max: 10 },
    severity: { type: String, enum: ['critical', 'major', 'minor'], default: 'major' },
    runtimeStatus: {
      type: String,
      enum: ['pending', 'healthy', 'suspected', 'failing', 'paused', 'misconfigured', 'auth_failure', 'worker_error'],
      default: 'pending',
    },
    consecutiveFailures: { type: Number, default: 0 },
    consecutiveSuccesses: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    lastResult: { type: lastResultSchema, default: null },
    lastRunId: { type: String, default: null },
    pausedReason: { type: String, default: null },
    activeRunUntil: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  baseOptions,
);

// Scheduler hot path: due, enabled checks.
checkSchema.index({ enabled: 1, nextRunAt: 1 });
checkSchema.index({ workspaceId: 1, projectId: 1 });
checkSchema.index({ projectId: 1, enabled: 1 });

export const Check: Model<CheckDoc> =
  (mongoose.models.Check as Model<CheckDoc>) || mongoose.model<CheckDoc>('Check', checkSchema);

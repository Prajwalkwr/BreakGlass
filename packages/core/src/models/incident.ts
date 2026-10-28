import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { CheckType, FailureCategory, IncidentSeverity, IncidentStatus } from '@breakglass/shared';

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

export interface IncidentDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  checkId: Types.ObjectId;
  checkName: string;
  checkType: CheckType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  firstFailureAt: Date;
  lastFailureAt: Date;
  resolvedAt: Date | null;
  recoveringSince: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: Types.ObjectId | null;
  acknowledgedByName: string | null;
  resolvedBy: Types.ObjectId | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  failureCount: number;
  recoveryVerifiedCount: number;
  lastFailureCategory: FailureCategory | null;
  lastErrorSummary: string | null;
  firstRunId: string | null;
  lastRunId: string | null;
  checkConfigSnapshot: Record<string, unknown>;
  suggestedSteps: string[];
  /** Set to 'active' while unresolved, nulled on resolve. Enforces one open incident per check. */
  activeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const incidentSchema = new Schema<IncidentDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    checkId: { type: Schema.Types.ObjectId, ref: 'Check', required: true, index: true },
    checkName: { type: String, required: true },
    checkType: { type: String, enum: ['http', 'api', 'browser'], required: true },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'recovering', 'resolved'],
      default: 'open',
      index: true,
    },
    severity: { type: String, enum: ['critical', 'major', 'minor'], default: 'major' },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, required: true, maxlength: 1000 },
    firstFailureAt: { type: Date, required: true },
    lastFailureAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: null },
    recoveringSince: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedByName: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedByName: { type: String, default: null },
    resolutionNote: { type: String, default: null, maxlength: 500 },
    failureCount: { type: Number, default: 0 },
    recoveryVerifiedCount: { type: Number, default: 0 },
    lastFailureCategory: { type: String, default: null },
    lastErrorSummary: { type: String, default: null, maxlength: 600 },
    firstRunId: { type: String, default: null },
    lastRunId: { type: String, default: null },
    checkConfigSnapshot: { type: Schema.Types.Mixed, default: {} },
    suggestedSteps: { type: [String], default: [] },
    activeKey: { type: String, default: 'active' },
  },
  baseOptions,
);

// One unresolved incident per check, enforced by the database.
incidentSchema.index(
  { checkId: 1, activeKey: 1 },
  { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } },
);
incidentSchema.index({ workspaceId: 1, status: 1, lastFailureAt: -1 });
incidentSchema.index({ projectId: 1, createdAt: -1 });

export const Incident: Model<IncidentDoc> =
  (mongoose.models.Incident as Model<IncidentDoc>) || mongoose.model<IncidentDoc>('Incident', incidentSchema);

/* ------------------------------------------------------------------ */
/* Incident events — append-only timeline                              */
/* ------------------------------------------------------------------ */

export interface IncidentEventDoc extends Document {
  _id: Types.ObjectId;
  incidentId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type:
    | 'opened'
    | 'failure'
    | 'recovery_started'
    | 'recovery_failed'
    | 'resolved'
    | 'acknowledged'
    | 'reopened'
    | 'note'
    | 'notification_queued'
    | 'notification_failed'
    | 'notification_delivered'
    | 'deployment_correlation'
    | 'verification_skipped'
    | 'severity_changed';
  message: string;
  actor: string;
  source: 'system' | 'user' | 'worker';
  details: Record<string, unknown> | null;
  createdAt: Date;
}

const incidentEventSchema = new Schema<IncidentEventDoc>(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    type: { type: String, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    actor: { type: String, default: 'system', maxlength: 120 },
    source: { type: String, enum: ['system', 'user', 'worker'], default: 'system' },
    details: { type: Schema.Types.Mixed, default: null },
  },
  {
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
  },
);

incidentEventSchema.index({ incidentId: 1, createdAt: 1 });

export const IncidentEvent: Model<IncidentEventDoc> =
  (mongoose.models.IncidentEvent as Model<IncidentEventDoc>) ||
  mongoose.model<IncidentEventDoc>('IncidentEvent', incidentEventSchema);

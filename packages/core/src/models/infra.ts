import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

const idTransform = (_doc: unknown, ret: Record<string, unknown>) => {
  ret.id = String(ret._id);
  delete ret._id;
  return ret;
};

/* ------------------------------------------------------------------ */
/* Encrypted credentials                                               */
/* ------------------------------------------------------------------ */

export interface SecretDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  checkId: Types.ObjectId | null;
  purpose: 'api_header' | 'login_password' | 'login_username' | 'basic_auth' | 'slack_webhook' | 'github_webhook';
  label: string;
  /** AES-256-GCM envelope. Plaintext never touches the database. */
  ciphertext: string;
  keyId: string;
  fingerprint: string;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const secretSchema = new Schema<SecretDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    checkId: { type: Schema.Types.ObjectId, ref: 'Check', default: null, index: true },
    purpose: { type: String, required: true },
    label: { type: String, default: '', maxlength: 120 },
    ciphertext: { type: String, required: true, select: false },
    keyId: { type: String, required: true },
    fingerprint: { type: String, required: true },
    lastUsedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false as const, toJSON: { virtuals: true, transform: idTransform } },
);

secretSchema.index({ workspaceId: 1, checkId: 1 });

export const Secret: Model<SecretDoc> =
  (mongoose.models.Secret as Model<SecretDoc>) || mongoose.model<SecretDoc>('Secret', secretSchema);

/* ------------------------------------------------------------------ */
/* Evidence artifacts (private, short-lived signed access)             */
/* ------------------------------------------------------------------ */

export interface ArtifactDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  checkId: Types.ObjectId;
  runId: string;
  kind: 'screenshot' | 'trace' | 'html';
  storage: 'local' | 's3';
  storageKey: string;
  contentType: string;
  bytes: number;
  checksum: string;
  expiresAt: Date;
  createdAt: Date;
}

const artifactSchema = new Schema<ArtifactDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    checkId: { type: Schema.Types.ObjectId, ref: 'Check', required: true, index: true },
    runId: { type: String, required: true },
    kind: { type: String, enum: ['screenshot', 'trace', 'html'], required: true },
    storage: { type: String, enum: ['local', 's3'], default: 'local' },
    storageKey: { type: String, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false as const,
    toJSON: { virtuals: true, transform: idTransform },
  },
);

artifactSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
artifactSchema.index({ runId: 1 });
artifactSchema.index({ workspaceId: 1, createdAt: -1 });

export const Artifact: Model<ArtifactDoc> =
  (mongoose.models.Artifact as Model<ArtifactDoc>) || mongoose.model<ArtifactDoc>('Artifact', artifactSchema);

/* ------------------------------------------------------------------ */
/* Durable job queue (Mongo driver) + worker heartbeats                */
/* ------------------------------------------------------------------ */

export type JobStatus = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'dead';

export interface JobDoc extends Document {
  _id: Types.ObjectId;
  queue: string;
  name: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastError: string | null;
  /** Present only while the job is live — enforces idempotent enqueue. */
  dedupeKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<JobDoc>(
  {
    queue: { type: String, required: true, index: true },
    name: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['waiting', 'active', 'delayed', 'completed', 'failed', 'dead'],
      default: 'waiting',
    },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    runAt: { type: Date, default: () => new Date() },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 600 },
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false as const, toJSON: { virtuals: true, transform: idTransform } },
);

jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ status: 1, lockedUntil: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
jobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export const Job: Model<JobDoc> = (mongoose.models.Job as Model<JobDoc>) || mongoose.model<JobDoc>('Job', jobSchema);

export interface WorkerHeartbeatDoc extends Document {
  _id: Types.ObjectId;
  workerId: string;
  host: string;
  concurrency: number;
  queues: string[];
  startedAt: Date;
  lastSeenAt: Date;
  processed: number;
  failed: number;
}

const heartbeatSchema = new Schema<WorkerHeartbeatDoc>(
  {
    workerId: { type: String, required: true, unique: true },
    host: { type: String, default: '' },
    concurrency: { type: Number, default: 1 },
    queues: { type: [String], default: [] },
    startedAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
    processed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { timestamps: false, versionKey: false as const },
);

heartbeatSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 120, name: 'heartbeat_ttl' });

export const WorkerHeartbeat: Model<WorkerHeartbeatDoc> =
  (mongoose.models.WorkerHeartbeat as Model<WorkerHeartbeatDoc>) ||
  mongoose.model<WorkerHeartbeatDoc>('WorkerHeartbeat', heartbeatSchema);

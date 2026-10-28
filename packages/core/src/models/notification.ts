import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { DeliveryStatus, NotificationChannel } from '@breakglass/shared';

const toJSONTransform = (_doc: unknown, ret: Record<string, unknown>) => {
  ret.id = String(ret._id);
  delete ret._id;
  return ret;
};

/* ------------------------------------------------------------------ */
/* Deployments (verified webhook ingestion)                            */
/* ------------------------------------------------------------------ */

export interface DeploymentDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  source: 'github' | 'manual' | 'webhook';
  environment: string;
  commitSha: string | null;
  commitMessage: string | null;
  actor: string | null;
  url: string | null;
  ref: string | null;
  repository: string | null;
  deployedAt: Date;
  receivedAt: Date;
  verified: boolean;
  providerDeliveryId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const deploymentSchema = new Schema<DeploymentDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    source: { type: String, enum: ['github', 'manual', 'webhook'], default: 'github' },
    environment: { type: String, default: 'production', maxlength: 40 },
    commitSha: { type: String, default: null, maxlength: 64 },
    commitMessage: { type: String, default: null, maxlength: 300 },
    actor: { type: String, default: null, maxlength: 120 },
    url: { type: String, default: null, maxlength: 500 },
    ref: { type: String, default: null, maxlength: 200 },
    repository: { type: String, default: null, maxlength: 200 },
    deployedAt: { type: Date, required: true },
    receivedAt: { type: Date, default: () => new Date() },
    verified: { type: Boolean, default: false },
    providerDeliveryId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false as const,
    toJSON: { virtuals: true, transform: toJSONTransform },
  },
);

deploymentSchema.index({ projectId: 1, deployedAt: -1 });
deploymentSchema.index({ projectId: 1, commitSha: 1 }, { unique: true, sparse: true });
deploymentSchema.index({ providerDeliveryId: 1 }, { unique: true, sparse: true });

export const Deployment: Model<DeploymentDoc> =
  (mongoose.models.Deployment as Model<DeploymentDoc>) ||
  mongoose.model<DeploymentDoc>('Deployment', deploymentSchema);

/* ------------------------------------------------------------------ */
/* Notification destinations                                           */
/* ------------------------------------------------------------------ */

export interface NotificationDestinationDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type: NotificationChannel;
  /** Email address (plaintext) for email destinations. */
  address: string | null;
  /** Encrypted Slack webhook URL. */
  webhookCiphertext: string | null;
  label: string;
  enabled: boolean;
  verified: boolean;
  verifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const destinationSchema = new Schema<NotificationDestinationDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    type: { type: String, enum: ['email', 'slack'], required: true },
    address: { type: String, default: null },
    webhookCiphertext: { type: String, default: null, select: false },
    label: { type: String, default: '', maxlength: 80 },
    enabled: { type: Boolean, default: true },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    lastError: { type: String, default: null, maxlength: 400 },
  },
  { timestamps: true, versionKey: false as const, toJSON: { virtuals: true, transform: toJSONTransform } },
);

destinationSchema.index({ workspaceId: 1, type: 1 });

export const NotificationDestination: Model<NotificationDestinationDoc> =
  (mongoose.models.NotificationDestination as Model<NotificationDestinationDoc>) ||
  mongoose.model<NotificationDestinationDoc>('NotificationDestination', destinationSchema);

/* ------------------------------------------------------------------ */
/* Notification deliveries (audit trail per attempt set)               */
/* ------------------------------------------------------------------ */

export interface NotificationDeliveryDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  incidentId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  destinationId: Types.ObjectId;
  channel: NotificationChannel;
  destinationLabel: string;
  eventType: 'incident_opened' | 'incident_resolved' | 'incident_repeat' | 'test' | 'email_verification' | 'password_reset';
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  providerRef: string | null;
  provider: string | null;
  error: string | null;
  dedupeKey: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const deliverySchema = new Schema<NotificationDeliveryDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    destinationId: { type: Schema.Types.ObjectId, ref: 'NotificationDestination', required: true },
    channel: { type: String, enum: ['email', 'slack'], required: true },
    destinationLabel: { type: String, default: '' },
    eventType: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    providerRef: { type: String, default: null },
    provider: { type: String, default: null },
    error: { type: String, default: null, maxlength: 400 },
    dedupeKey: { type: String, default: null },
    nextAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false as const, toJSON: { virtuals: true, transform: toJSONTransform } },
);

// Idempotency: the same event can never be queued twice for the same destination.
deliverySchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
deliverySchema.index({ incidentId: 1, createdAt: -1 });

export const NotificationDelivery: Model<NotificationDeliveryDoc> =
  (mongoose.models.NotificationDelivery as Model<NotificationDeliveryDoc>) ||
  mongoose.model<NotificationDeliveryDoc>('NotificationDelivery', deliverySchema);

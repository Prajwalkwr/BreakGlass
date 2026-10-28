import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type { PageScanSnapshot } from '@breakglass/shared';

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

export interface ProjectDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  url: string;
  /** Normalised host + path, used for display and duplicate hints. */
  canonicalUrl: string;
  clientName: string | null;
  notes: string | null;
  status: 'active' | 'paused';
  githubRepository: string | null;
  githubWebhookSecretSet: boolean;
  lastPageScan: PageScanSnapshot | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<ProjectDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, maxlength: 2048 },
    canonicalUrl: { type: String, required: true, maxlength: 2048 },
    clientName: { type: String, default: null, maxlength: 80 },
    notes: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    githubRepository: { type: String, default: null, maxlength: 200 },
    githubWebhookSecretSet: { type: Boolean, default: false },
    lastPageScan: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  baseOptions,
);

projectSchema.index({ workspaceId: 1, createdAt: -1 });
projectSchema.index({ workspaceId: 1, name: 1 });

export const Project: Model<ProjectDoc> =
  (mongoose.models.Project as Model<ProjectDoc>) || mongoose.model<ProjectDoc>('Project', projectSchema);

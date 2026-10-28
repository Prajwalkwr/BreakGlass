import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

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

export interface WorkspaceSettings {
  notifyOnOpen: boolean;
  notifyOnResolve: boolean;
  notifyOnRepeatFailures: boolean;
}

export interface WorkspaceDoc extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  alertEmail: string | null;
  settings: WorkspaceSettings;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<WorkspaceDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    alertEmail: { type: String, default: null },
    settings: {
      notifyOnOpen: { type: Boolean, default: true },
      notifyOnResolve: { type: Boolean, default: true },
      notifyOnRepeatFailures: { type: Boolean, default: false },
    },
  },
  baseOptions,
);

export const Workspace: Model<WorkspaceDoc> =
  (mongoose.models.Workspace as Model<WorkspaceDoc>) ||
  mongoose.model<WorkspaceDoc>('Workspace', workspaceSchema);

/* ------------------------------------------------------------------ */
/* Memberships                                                         */
/* ------------------------------------------------------------------ */

export interface MembershipDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'owner' | 'member';
  status: 'active' | 'invited';
  invitedEmail: string | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<MembershipDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'invited'], default: 'active' },
    invitedEmail: { type: String, default: null },
    joinedAt: { type: Date, default: () => new Date() },
  },
  baseOptions,
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const Membership: Model<MembershipDoc> =
  (mongoose.models.Membership as Model<MembershipDoc>) ||
  mongoose.model<MembershipDoc>('Membership', membershipSchema);

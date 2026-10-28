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

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export interface UserDoc extends Document {
  _id: Types.ObjectId;
  email: string;
  normalizedEmail: string;
  name: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  status: 'active' | 'suspended';
  timezone: string;
  passwordUpdatedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, trim: true, maxlength: 254 },
    normalizedEmail: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    passwordHash: { type: String, required: true, select: false },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    passwordUpdatedAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  baseOptions,
);

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) || mongoose.model<UserDoc>('User', userSchema);

/* ------------------------------------------------------------------ */
/* Sessions (opaque, hashed, revocable)                                */
/* ------------------------------------------------------------------ */

export interface SessionDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  userAgent: string | null;
  ipHash: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    ipHash: { type: String, default: null },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  baseOptions,
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1, revokedAt: 1 });

export const Session: Model<SessionDoc> =
  (mongoose.models.Session as Model<SessionDoc>) || mongoose.model<SessionDoc>('Session', sessionSchema);

/* ------------------------------------------------------------------ */
/* Single-use tokens (email verification, password reset)              */
/* ------------------------------------------------------------------ */

export interface TokenDoc extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: 'email_verify' | 'password_reset';
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const tokenSchema = new Schema<TokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['email_verify', 'password_reset'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  baseOptions,
);

tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tokenSchema.index({ userId: 1, type: 1 });

export const Token: Model<TokenDoc> =
  (mongoose.models.Token as Model<TokenDoc>) || mongoose.model<TokenDoc>('Token', tokenSchema);

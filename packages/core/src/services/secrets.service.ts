import { Types } from 'mongoose';
import { Secret } from '../models/infra';
import { encryptSecret, decryptSecret, maskSecret } from '../lib/crypto';
import { badRequest, notFound } from '../lib/errors';

export interface SecretView {
  id: string;
  purpose: string;
  label: string;
  preview: string;
  lastUsedAt: string | null;
  createdAt: string;
}

const PURPOSE_LABELS: Record<string, string> = {
  api_header: 'API header value',
  login_password: 'Test account password',
  login_username: 'Test account username',
  basic_auth: 'Basic auth credential',
  slack_webhook: 'Slack webhook URL',
  github_webhook: 'GitHub webhook secret',
};

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose] ?? purpose;
}

export async function createSecret(params: {
  workspaceId: string | Types.ObjectId;
  projectId?: string | Types.ObjectId | null;
  checkId?: string | Types.ObjectId | null;
  purpose: string;
  label: string;
  value: string;
  createdBy?: string;
}): Promise<string> {
  const value = params.value?.trim();
  if (!value) throw badRequest('The credential value cannot be empty.');
  if (value.length > 4000) throw badRequest('The credential value is too long (4000 characters maximum).');

  const encrypted = encryptSecret(value);
  const secret = await Secret.create({
    workspaceId: params.workspaceId,
    projectId: params.projectId ?? null,
    checkId: params.checkId ?? null,
    purpose: params.purpose,
    label: params.label.slice(0, 120),
    ciphertext: encrypted.ciphertext,
    keyId: encrypted.keyId,
    fingerprint: encrypted.fingerprint,
  });
  return String(secret._id);
}

export async function rotateSecret(params: {
  workspaceId: string;
  secretId: string;
  value: string;
}): Promise<void> {
  if (!Types.ObjectId.isValid(params.secretId)) throw notFound('Credential not found.');
  const encrypted = encryptSecret(params.value.trim());
  const result = await Secret.updateOne(
    { _id: params.secretId, workspaceId: params.workspaceId },
    {
      $set: {
        ciphertext: encrypted.ciphertext,
        keyId: encrypted.keyId,
        fingerprint: encrypted.fingerprint,
        rotatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 0) throw notFound('Credential not found.');
}

export async function deleteSecret(workspaceId: string, secretId: string): Promise<void> {
  if (!Types.ObjectId.isValid(secretId)) throw notFound('Credential not found.');
  const result = await Secret.deleteOne({ _id: secretId, workspaceId });
  if (result.deletedCount === 0) throw notFound('Credential not found.');
}

export async function listSecrets(workspaceId: string, projectId?: string): Promise<SecretView[]> {
  const filter: Record<string, unknown> = { workspaceId };
  if (projectId) filter.projectId = projectId;
  const secrets = await Secret.find(filter).sort({ createdAt: -1 }).limit(100);
  return secrets.map((secret) => ({
    id: String(secret._id),
    purpose: secret.purpose,
    label: secret.label || purposeLabel(secret.purpose),
    preview: maskSecret('•'.repeat(12)), // Metadata only: values are never returned.
    lastUsedAt: secret.lastUsedAt ? secret.lastUsedAt.toISOString() : null,
    createdAt: secret.createdAt.toISOString(),
  }));
}

export async function verifySecretBelongsToWorkspace(
  workspaceId: string,
  secretId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(secretId)) return false;
  const count = await Secret.countDocuments({ _id: secretId, workspaceId });
  return count > 0;
}

/** Used by the GitHub webhook verifier and notification worker. */
export async function readSecretValue(workspaceId: string, secretId: string): Promise<string | null> {
  const secret = await Secret.findOne({ _id: secretId, workspaceId }).select('+ciphertext');
  if (!secret) return null;
  try {
    return decryptSecret(secret.ciphertext);
  } catch {
    return null;
  }
}

/** Deletes credentials attached to a check that was removed. */
export async function deleteSecretsForCheck(workspaceId: string, checkId: string): Promise<void> {
  await Secret.deleteMany({ workspaceId, checkId });
}

export { maskSecret };

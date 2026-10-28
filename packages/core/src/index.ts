/* Config */
export * from './config/env';

/* Database */
export { connectDatabase, disconnectDatabase, ensureIndexes, databaseState } from './db/connect';

/* Models */
export { User, Session, Token } from './models/user';
export { Workspace, Membership } from './models/workspace';
export { Project } from './models/project';
export { Check } from './models/check';
export { CheckRun } from './models/checkRun';
export { Incident, IncidentEvent } from './models/incident';
export { Deployment, NotificationDestination, NotificationDelivery } from './models/notification';
export { Secret, Artifact, Job, WorkerHeartbeat } from './models/infra';

/* Model document types */
export type { UserDoc } from './models/user';
export type { WorkspaceDoc, MembershipDoc } from './models/workspace';
export type { ProjectDoc } from './models/project';
export type { CheckDoc } from './models/check';
export type { CheckRunDoc } from './models/checkRun';
export type { IncidentDoc, IncidentEventDoc } from './models/incident';
export type { DeploymentDoc, NotificationDestinationDoc, NotificationDeliveryDoc } from './models/notification';
export type { SecretDoc, ArtifactDoc, JobDoc, WorkerHeartbeatDoc } from './models/infra';

/* Libraries */
export { logger, childLogger } from './lib/logger';
export * from './lib/errors';
export * from './lib/crypto';
export * from './lib/origin';
export * from './lib/paths';

/* Security */
export {
  UnsafeTargetError,
  assertUrlStructure,
  resolveAndValidate,
  isBlockedAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  pinnedLookup,
  privateTargetsAllowed,
  isAlwaysBlockedAddress,
  BLOCKED_PORTS,
  assertConnectedSocketAllowed,
} from './monitoring/ssrf';
export { secureRequest, RequestFailure } from './monitoring/runner';

/* Monitoring */
export { executeCheck } from './monitoring/executor';
export { processCheckRun, runCheckNow } from './services/monitoring.service';

/* Services */
export * from './services/auth.service';
export * from './services/access.service';
export * from './services/projects.service';
export * from './services/checks.service';
export * from './services/page-scan.service';
export * from './services/incidents.query';
export * from './services/incident.service';
export * from './services/notification.service';
export * from './services/transport.service';
export * from './services/secrets.service';
export * from './services/artifacts.service';
export { getStorage, resetStorage, type StorageDriver } from './storage';
export * from './services/stats.service';
export * from './services/scheduler.service';
export * from './services/deployments.service';

/* Queue */
export { getQueue } from './queue';
export type {
  ConsumerHandle,
  ConsumerOptions,
  JobHandler,
  QueueName,
  ReservedJob,
  QueueStats,
  QueueDriver,
} from './queue';
export type { CheckRunJobPayload } from './services/monitoring.service';
export { executeAdHocCheck, probeProjectWebsite, type ProjectProbeResult } from './services/adhoc.service';

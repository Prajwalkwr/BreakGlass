import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Constants & limits                                                  */
/* ------------------------------------------------------------------ */

export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 60 * 60 * 24;

export const INTERVAL_OPTIONS = [
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 600, label: 'Every 10 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
  { value: 3600, label: 'Every hour' },
  { value: 21600, label: 'Every 6 hours' },
] as const;

export const PLAN_LIMITS = {
  maxProjects: 25,
  maxActiveChecks: 100,
  maxBrowserChecks: 25,
  maxChecksPerProject: 100,
  minIntervalSeconds: MIN_INTERVAL_SECONDS,
} as const;

export const DEFAULT_TIMEOUT_MS = 15000;
export const MIN_TIMEOUT_MS = 3000;
export const MAX_TIMEOUT_MS = 60000;

export const DEFAULT_FAILURE_THRESHOLD = 2;
export const DEFAULT_RECOVERY_THRESHOLD = 2;

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

export const CHECK_TYPES = ['http', 'api', 'browser'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export const CHECK_RUNTIME_STATUSES = [
  'pending',
  'healthy',
  'suspected',
  'failing',
  'paused',
  'misconfigured',
  'auth_failure',
  'worker_error',
] as const;
export type CheckRuntimeStatus = (typeof CHECK_RUNTIME_STATUSES)[number];

export const FAILURE_CATEGORIES = [
  'dns_failure',
  'connection_refused',
  'connection_timeout',
  'tls_error',
  'http_status',
  'content_mismatch',
  'json_assertion_failed',
  'redirect_error',
  'response_too_large',
  'blocked_destination',
  'auth_failure',
  'element_not_found',
  'text_not_found',
  'navigation_timeout',
  'journey_step_failed',
  'browser_runtime_error',
  'config_error',
  'internal_error',
  'unknown',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  dns_failure: 'DNS lookup failed',
  connection_refused: 'Connection refused',
  connection_timeout: 'Connection timed out',
  tls_error: 'TLS / certificate error',
  http_status: 'Unexpected HTTP status',
  content_mismatch: 'Expected content missing',
  json_assertion_failed: 'JSON assertion failed',
  redirect_error: 'Redirect problem',
  response_too_large: 'Response too large',
  blocked_destination: 'Destination blocked by security policy',
  auth_failure: 'Test account rejected',
  element_not_found: 'Expected element not found',
  text_not_found: 'Expected text not found',
  navigation_timeout: 'Page navigation timed out',
  journey_step_failed: 'Browser journey step failed',
  browser_runtime_error: 'Browser runtime unavailable',
  config_error: 'Check configuration invalid',
  internal_error: 'Internal monitoring error',
  unknown: 'Unclassified failure',
};

/** Categories that mean "we could not verify the website" rather than "the website is broken". */
export const NON_OUTAGE_CATEGORIES: FailureCategory[] = [
  'auth_failure',
  'config_error',
  'blocked_destination',
  'browser_runtime_error',
  'internal_error',
];

export const INCIDENT_STATUSES = ['open', 'acknowledged', 'recovering', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITIES = ['critical', 'major', 'minor'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const WORKSPACE_ROLES = ['owner', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'slack'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DELIVERY_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'skipped',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DEPLOYMENT_SOURCES = ['github', 'manual', 'webhook'] as const;

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Password is too long');

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

/**
 * Website URLs are validated structurally here and re-validated on the
 * server (scheme + DNS + resolved IP allowlist) before any request is made.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .min(4, 'Enter a URL')
  .max(2048, 'URL is too long')
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Enter a full URL starting with https://')
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.hostname.length > 0 && !parsed.hostname.includes(' ');
    } catch {
      return false;
    }
  }, 'URL hostname is not valid');

const selectorSchema = z
  .string()
  .trim()
  .min(1, 'Selector is required')
  .max(300, 'Selector is too long');

const expectedTextSchema = z
  .string()
  .min(1, 'Text is required')
  .max(500, 'Text is too long');

/* ------------------------------------------------------------------ */
/* Check configuration schemas                                        */
/* ------------------------------------------------------------------ */

export const statusRangeSchema = z
  .object({
    min: z.number().int().min(100).max(599),
    max: z.number().int().min(100).max(599),
  })
  .refine((v) => v.min <= v.max, { message: 'Status range start must be below its end', path: ['max'] });

export const apiHeaderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Invalid header name'),
  /** Only present on write requests. Never returned by the API once stored. */
  value: z.string().max(4000).optional(),
  sensitive: z.boolean().default(false),
  /** Server-assigned pointer to an encrypted secret. */
  secretRef: z.string().optional(),
});

export const jsonAssertionSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, 'JSON path is required')
    .max(200)
    .regex(/^[A-Za-z0-9_.\-[\]]+$/, 'Use a dotted path such as data.status'),
  operator: z.enum(['exists', 'equals', 'contains', 'matches', 'not_equals']).default('equals'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const httpCheckConfigSchema = z.object({
  url: httpUrlSchema,
  method: z.enum(['GET', 'HEAD']).default('GET'),
  expectedStatus: statusRangeSchema.default({ min: 200, max: 399 }),
  followRedirects: z.boolean().default(true),
  maxRedirects: z.number().int().min(0).max(10).default(5),
  expectedBodyContains: z.string().max(500).optional(),
  expectedBodyNotContains: z.string().max(500).optional(),
  maxResponseBytes: z.number().int().min(1024).max(5_000_000).default(512_000),
});

export const apiCheckConfigSchema = z.object({
  url: httpUrlSchema,
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.array(apiHeaderSchema).max(20).default([]),
  bodyType: z.enum(['none', 'json', 'text']).default('none'),
  body: z.string().max(20_000).optional(),
  expectedStatus: statusRangeSchema.default({ min: 200, max: 299 }),
  jsonAssertions: z.array(jsonAssertionSchema).max(10).default([]),
  followRedirects: z.boolean().default(true),
  maxRedirects: z.number().int().min(0).max(10).default(5),
  maxResponseBytes: z.number().int().min(1024).max(5_000_000).default(512_000),
});

export const journeyStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goto'),
    url: httpUrlSchema.optional(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  }),
  z.object({
    type: z.literal('fill'),
    selector: selectorSchema,
    /** Plain, non-secret value. */
    value: z.string().max(2000).optional(),
    /** Encrypted credential pointer (preferred for passwords). */
    secretRef: z.string().optional(),
  }),
  z.object({ type: z.literal('click'), selector: selectorSchema }),
  z.object({ type: z.literal('press'), selector: selectorSchema, key: z.string().min(1).max(30).default('Enter') }),
  z.object({ type: z.literal('expectVisible'), selector: selectorSchema }),
  z.object({ type: z.literal('expectText'), text: expectedTextSchema, selector: selectorSchema.optional() }),
  z.object({ type: z.literal('expectUrl'), contains: z.string().min(1).max(500) }),
  z.object({
    type: z.literal('waitForResponse'),
    urlContains: z.string().min(1).max(500),
    statusRange: statusRangeSchema.default({ min: 200, max: 299 }),
  }),
]);

export const browserCheckConfigSchema = z.object({
  startUrl: httpUrlSchema,
  steps: z.array(journeyStepSchema).min(1, 'Add at least one journey step').max(20, 'A journey can have at most 20 steps'),
  captureScreenshotOnFailure: z.boolean().default(true),
  captureTraceOnFailure: z.boolean().default(false),
  viewportWidth: z.number().int().min(320).max(1920).default(1366),
  viewportHeight: z.number().int().min(320).max(1080).default(768),
});

export type HttpCheckConfig = z.infer<typeof httpCheckConfigSchema>;
export type ApiCheckConfig = z.infer<typeof apiCheckConfigSchema>;
export type BrowserCheckConfig = z.infer<typeof browserCheckConfigSchema>;
export type JourneyStep = z.infer<typeof journeyStepSchema>;

export const checkConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('http'), config: httpCheckConfigSchema }),
  z.object({ type: z.literal('api'), config: apiCheckConfigSchema }),
  z.object({ type: z.literal('browser'), config: browserCheckConfigSchema }),
]);

export type CheckConfigPayload = z.infer<typeof checkConfigSchema>;

export function parseCheckConfig(type: CheckType, config: unknown) {
  return checkConfigSchema.parse({ type, config });
}

/* ------------------------------------------------------------------ */
/* Request schemas                                                    */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email: emailSchema,
  password: passwordSchema,
  workspaceName: z.string().trim().min(1).max(80).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset token is missing'),
  password: passwordSchema,
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name').max(80),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  alertEmail: z.union([emailSchema, z.literal('')]).optional(),
  notifyOnOpen: z.boolean().optional(),
  notifyOnResolve: z.boolean().optional(),
  notifyOnRepeatFailures: z.boolean().optional(),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(['owner', 'member']).default('member'),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Enter a project name').max(80),
  url: httpUrlSchema,
  clientName: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  url: httpUrlSchema.optional(),
  clientName: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(['active', 'paused']).optional(),
});

export const checkBaseSchema = z.object({
  name: z.string().trim().min(1, 'Enter a check name').max(80),
  intervalSeconds: z
    .number()
    .int()
    .min(MIN_INTERVAL_SECONDS, `The fastest supported interval is ${MIN_INTERVAL_SECONDS} seconds`)
    .max(MAX_INTERVAL_SECONDS),
  timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  failureThreshold: z.number().int().min(1).max(10).default(DEFAULT_FAILURE_THRESHOLD),
  recoveryThreshold: z.number().int().min(1).max(10).default(DEFAULT_RECOVERY_THRESHOLD),
  enabled: z.boolean().default(false),
  severity: z.enum(['critical', 'major', 'minor']).default('major'),
});

export const createCheckSchema = z.intersection(checkBaseSchema, checkConfigSchema);

export const updateCheckSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS).optional(),
    timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
    failureThreshold: z.number().int().min(1).max(10).optional(),
    recoveryThreshold: z.number().int().min(1).max(10).optional(),
    enabled: z.boolean().optional(),
    severity: z.enum(['critical', 'major', 'minor']).optional(),
    config: z.unknown().optional(),
  })
  .strict();

export const testCheckSchema = z.union([
  z.object({ checkId: objectIdSchema.optional(), payload: createCheckSchema.optional() }).optional(),
  createCheckSchema,
]);

export const notificationDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), address: emailSchema, label: z.string().trim().max(80).optional() }),
  z.object({
    type: z.literal('slack'),
    webhookUrl: z.string().url().max(500),
    label: z.string().trim().max(80).optional(),
  }),
]);

export const deploymentWebhookPayloadSchema = z.object({
  ref: z.string().optional(),
  after: z.string().optional(),
  environment: z.string().optional(),
  deployment_url: z.string().optional(),
  repository: z.object({ full_name: z.string().optional() }).optional(),
});

export const rotateSecretSchema = z.object({
  value: z.string().min(1, 'Enter the new value').max(4000),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const runHistoryQuerySchema = paginationSchema.extend({
  outcome: z.enum(['success', 'failure', 'all']).default('all'),
  checkId: objectIdSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* DTO types returned by the API                                      */
/* ------------------------------------------------------------------ */

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  timezone: string;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  ownerId: string;
  alertEmail: string | null;
  settings: {
    notifyOnOpen: boolean;
    notifyOnResolve: boolean;
    notifyOnRepeatFailures: boolean;
  };
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: 'active' | 'invited';
  joinedAt: string | null;
}

export interface ProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  clientName: string | null;
  status: 'active' | 'paused';
  createdAt: string;
  checkCount: number;
  enabledCheckCount: number;
  activeIncidentCount: number;
  health: 'healthy' | 'degraded' | 'down' | 'unknown' | 'paused';
  lastCheckAt: string | null;
  nextCheckAt: string | null;
}

export interface ScannedPageResult {
  url: string;
  success: boolean;
  httpStatus: number | null;
  durationMs: number;
  failureCategory: FailureCategory | null;
  summary: string;
  checkId: string | null;
  checkName: string | null;
  features: PageFeatureInventory | null;
}

export interface ObservedApiCall {
  method: string;
  path: string;
  status: number | null;
}

export interface PageFeatureInventory {
  formCount: number;
  fieldCount: number;
  passwordFieldCount: number;
  buttonCount: number;
  linkCount: number;
  runtimeErrorCount: number;
  apiCalls: ObservedApiCall[];
}

export interface PageScanReport {
  pages: ScannedPageResult[];
  truncated: boolean;
  warnings: string[];
  createdChecks: number;
  activatedChecks: number;
  alreadyMonitored: number;
  unscheduledPages: number;
  intervalSeconds: number;
}

export interface PageScanSnapshot {
  scannedAt: string;
  report: PageScanReport;
}

export interface CheckRunSummary {
  id: string;
  runId: string;
  checkId: string;
  projectId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  success: boolean;
  failureCategory: FailureCategory | null;
  httpStatus: number | null;
  errorSummary: string | null;
  attempt: number;
  triggeredBy: 'schedule' | 'manual' | 'test' | 'recovery';
  incidentId: string | null;
  artifacts: ArtifactRef[];
}

export interface ArtifactRef {
  id: string;
  kind: 'screenshot' | 'trace' | 'html';
  bytes: number;
  createdAt: string;
}

export interface CheckSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  type: CheckType;
  enabled: boolean;
  runtimeStatus: CheckRuntimeStatus;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  severity: IncidentSeverity;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  configVersion: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastResult: {
    success: boolean;
    at: string;
    durationMs: number;
    failureCategory: FailureCategory | null;
    httpStatus: number | null;
    errorSummary: string | null;
  } | null;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentEventDto {
  id: string;
  type: string;
  message: string;
  actor: string;
  source: 'system' | 'user' | 'worker';
  createdAt: string;
  details?: Record<string, unknown> | null;
}

export interface IncidentSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectUrl: string;
  checkId: string;
  checkName: string;
  checkType: CheckType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  firstFailureAt: string;
  lastFailureAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  failureCount: number;
  durationMs: number;
  recoveryVerifiedCount: number;
  suggestedSteps: string[];
}

export interface IncidentDetail extends IncidentSummary {
  events: IncidentEventDto[];
  recentRuns: CheckRunSummary[];
  notifications: NotificationDeliveryDto[];
  deployments: DeploymentDto[];
  checkConfig: unknown;
  responseTimeSeries: { at: string; durationMs: number; success: boolean }[];
}

export interface NotificationDeliveryDto {
  id: string;
  channel: NotificationChannel;
  destinationLabel: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  /** Which transport handled it. `development_outbox` means no real send. */
  provider: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentDto {
  id: string;
  source: string;
  environment: string;
  commitSha: string | null;
  commitMessage: string | null;
  deployedAt: string;
  url: string | null;
  actor: string | null;
  verified: boolean;
}

export interface DashboardStats {
  projectCount: number;
  enabledCheckCount: number;
  healthyCheckCount: number;
  failingCheckCount: number;
  pausedCheckCount: number;
  misconfiguredCheckCount: number;
  activeIncidentCount: number;
  openIncidentCount: number;
  checksDueSoon: number;
  last24h: { runs: number; failures: number };
  recentIncidents: IncidentSummary[];
  recentRuns: (CheckRunSummary & { checkName: string; projectName: string })[];
  workspaceNotice: string | null;
  emailConfigured: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  database: 'connected' | 'disconnected';
  queue: { driver: 'redis' | 'mongo'; workersOnline: number; pendingJobs: number };
  email: 'configured' | 'development_outbox';
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

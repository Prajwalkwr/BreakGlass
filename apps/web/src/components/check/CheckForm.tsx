import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Code2,
  Chrome,
  Globe,
  Loader2,
  Lock,
  Plus,
  PlayCircle,
  Trash2,
  XCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_RECOVERY_THRESHOLD,
  DEFAULT_TIMEOUT_MS,
  INTERVAL_OPTIONS,
  createCheckSchema,
  formatInterval,
  type CheckType,
  type CheckSummary,
  type JourneyStep,
} from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { useWorkspaceId } from '../../lib/auth';
import { Button, Field, InlineNotice, Input, Select, Switch, Textarea } from '../ui';
import { formatDuration } from '../../lib/format';
import { useToast } from '../../lib/toast';

interface SecretOption {
  id: string;
  label: string;
  purpose: string;
}

interface TestOutcome {
  success: boolean;
  failureCategory: string | null;
  failureMessage: string | null;
  durationMs: number;
  httpStatus: number | null;
  evidence: {
    steps?: { index: number; type: string; ok: boolean; durationMs: number; detail?: string }[];
    consoleErrors?: string[];
    finalUrl?: string;
    bodyPreview?: string;
    redirectChain?: string[];
    tls?: { daysUntilExpiry?: number | null; issuer?: string | null };
    json?: { assertions: { path: string; operator: string; ok: boolean; detail?: string }[] };
  };
}

const TYPE_OPTIONS = [
  { value: 'http' as CheckType, label: 'HTTP uptime', description: 'Status, content and response time', icon: Globe },
  { value: 'api' as CheckType, label: 'API endpoint', description: 'JSON assertions and headers', icon: Code2 },
  { value: 'browser' as CheckType, label: 'Browser journey', description: 'Playwright signs in and clicks through', icon: Chrome },
];

const STEP_TYPES: { value: JourneyStep['type']; label: string; hint: string }[] = [
  { value: 'goto', label: 'Open page', hint: 'Navigate to a URL (blank = start page)' },
  { value: 'fill', label: 'Fill field', hint: 'Type into an input, optionally using a saved credential' },
  { value: 'click', label: 'Click', hint: 'Click an element' },
  { value: 'press', label: 'Press key', hint: 'Press a key inside an element' },
  { value: 'expectVisible', label: 'Expect visible', hint: 'Fail unless the element becomes visible' },
  { value: 'expectText', label: 'Expect text', hint: 'Fail unless the text appears on the page' },
  { value: 'expectUrl', label: 'Expect URL', hint: 'Fail unless the URL contains a value' },
  { value: 'waitForResponse', label: 'Expect response', hint: 'Wait for a matching network response' },
];

function defaultStep(type: JourneyStep['type']): JourneyStep {
  switch (type) {
    case 'goto':
      return { type: 'goto', waitUntil: 'domcontentloaded' };
    case 'fill':
      return { type: 'fill', selector: '' };
    case 'click':
      return { type: 'click', selector: '' };
    case 'press':
      return { type: 'press', selector: '', key: 'Enter' };
    case 'expectVisible':
      return { type: 'expectVisible', selector: '' };
    case 'expectText':
      return { type: 'expectText', text: '' };
    case 'expectUrl':
      return { type: 'expectUrl', contains: '' };
    case 'waitForResponse':
      return { type: 'waitForResponse', urlContains: '', statusRange: { min: 200, max: 299 } };
    default:
      return { type: 'expectVisible', selector: '' };
  }
}

export function CheckForm({
  projectId,
  projectUrl,
  existing,
  onSaved,
  onCancel,
}: {
  projectId: string;
  projectUrl: string;
  existing?: CheckSummary;
  onSaved: (check: CheckSummary) => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const workspaceId = useWorkspaceId();

  const [type, setType] = useState<CheckType>(existing?.type ?? 'http');
  const [name, setName] = useState(existing?.name ?? '');
  const [intervalSeconds, setIntervalSeconds] = useState(existing?.intervalSeconds ?? 300);
  const [timeoutMs, setTimeoutMs] = useState(existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const [failureThreshold, setFailureThreshold] = useState(existing?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
  const [recoveryThreshold, setRecoveryThreshold] = useState(existing?.recoveryThreshold ?? DEFAULT_RECOVERY_THRESHOLD);
  const [severity, setSeverity] = useState<'critical' | 'major' | 'minor'>(existing?.severity ?? 'major');
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [advanced, setAdvanced] = useState(false);

  // HTTP / API shared
  const initialConfig = (existing?.config ?? {}) as Record<string, unknown>;
  const [url, setUrl] = useState<string>((initialConfig.url as string) ?? projectUrl);
  const [method, setMethod] = useState<string>((initialConfig.method as string) ?? 'GET');
  const [statusMin, setStatusMin] = useState(
    (initialConfig.expectedStatus as { min: number; max: number } | undefined)?.min ?? (type === 'api' ? 200 : 200),
  );
  const [statusMax, setStatusMax] = useState(
    (initialConfig.expectedStatus as { min: number; max: number } | undefined)?.max ?? (type === 'api' ? 299 : 399),
  );
  const [bodyContains, setBodyContains] = useState((initialConfig.expectedBodyContains as string) ?? '');
  const [bodyNotContains, setBodyNotContains] = useState((initialConfig.expectedBodyNotContains as string) ?? '');
  const [followRedirects, setFollowRedirects] = useState((initialConfig.followRedirects as boolean) ?? true);

  // API
  const [headers, setHeaders] = useState<{ name: string; value: string; sensitive: boolean; secretRef?: string }[]>(
    ((initialConfig.headers as { name: string; sensitive?: boolean; secretRef?: string }[]) ?? []).map((header) => ({
      name: header.name,
      value: '',
      sensitive: Boolean(header.sensitive || header.secretRef),
      secretRef: header.secretRef,
    })),
  );
  const [assertions, setAssertions] = useState<{ path: string; operator: string; value: string }[]>(
    ((initialConfig.jsonAssertions as { path: string; operator: string; value?: unknown }[]) ?? []).map((assertion) => ({
      path: assertion.path,
      operator: assertion.operator ?? 'equals',
      value: assertion.value === undefined || assertion.value === null ? '' : String(assertion.value),
    })),
  );
  const [bodyType, setBodyType] = useState<'none' | 'json' | 'text'>((initialConfig.bodyType as 'none') ?? 'none');
  const [requestBody, setRequestBody] = useState((initialConfig.body as string) ?? '');

  // Browser
  const [startUrl, setStartUrl] = useState<string>((initialConfig.startUrl as string) ?? projectUrl);
  const [steps, setSteps] = useState<JourneyStep[]>(
    (initialConfig.steps as JourneyStep[]) ?? [{ type: 'expectVisible', selector: 'body' } as JourneyStep],
  );
  const [captureScreenshot, setCaptureScreenshot] = useState((initialConfig.captureScreenshotOnFailure as boolean) ?? true);
  const [captureTrace, setCaptureTrace] = useState((initialConfig.captureTraceOnFailure as boolean) ?? false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);

  const { data: secretsData } = useQuery({
    queryKey: ['secrets', workspaceId, projectId],
    queryFn: () => api.get<{ secrets: SecretOption[] }>(`/workspaces/${workspaceId}/projects/${projectId}/secrets`),
    enabled: Boolean(workspaceId && projectId),
  });
  const secrets = secretsData?.secrets ?? [];

  const config = useMemo(() => {
    if (type === 'http') {
      return {
        url,
        method: method === 'HEAD' ? 'HEAD' : 'GET',
        expectedStatus: { min: statusMin, max: statusMax },
        followRedirects,
        maxRedirects: 5,
        maxResponseBytes: 1048576,
        ...(bodyContains ? { expectedBodyContains: bodyContains } : {}),
        ...(bodyNotContains ? { expectedBodyNotContains: bodyNotContains } : {}),
      };
    }
    if (type === 'api') {
      return {
        url,
        method,
        headers: headers
          .filter((header) => header.name.trim())
          .map((header) => ({
            name: header.name.trim(),
            sensitive: header.sensitive,
            ...(header.secretRef ? { secretRef: header.secretRef } : {}),
            ...(header.value ? { value: header.value } : {}),
          })),
        bodyType,
        ...(bodyType !== 'none' && requestBody ? { body: requestBody } : {}),
        expectedStatus: { min: statusMin, max: statusMax },
        jsonAssertions: assertions
          .filter((assertion) => assertion.path.trim())
          .map((assertion) => ({
            path: assertion.path.trim(),
            operator: assertion.operator,
            ...(assertion.operator === 'exists' ? {} : { value: coerceValue(assertion.value) }),
          })),
        followRedirects,
        maxRedirects: 5,
        maxResponseBytes: 1048576,
      };
    }
    return {
      startUrl,
      steps,
      captureScreenshotOnFailure: captureScreenshot,
      captureTraceOnFailure: captureTrace,
      viewportWidth: 1366,
      viewportHeight: 768,
    };
  }, [
    type, url, method, statusMin, statusMax, followRedirects, bodyContains, bodyNotContains,
    headers, bodyType, requestBody, assertions, startUrl, steps, captureScreenshot, captureTrace,
  ]);

  const payload = useMemo(
    () => ({
      name: name.trim() || defaultName(type),
      type,
      intervalSeconds,
      timeoutMs,
      failureThreshold,
      recoveryThreshold,
      severity,
      enabled,
      config,
    }),
    [name, type, intervalSeconds, timeoutMs, failureThreshold, recoveryThreshold, severity, enabled, config],
  );

  function validate(): boolean {
    const parsed = createCheckSchema.safeParse(payload);
    if (parsed.success) {
      setErrors({});
      setFormError(null);
      return true;
    }
    const next: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || 'form';
      if (!next[path]) next[path] = issue.message;
    }
    setErrors(next);
    setFormError('Some fields need attention before this check can be saved.');
    return false;
  }

  async function runTest() {
    if (!validate()) return;
    setTesting(true);
    setTestResult(null);
    setFormError(null);
    try {
      const result = await api.post<TestOutcome>(`/workspaces/${workspaceId}/projects/${projectId}/checks/test`, payload);
      setTestResult(result);
      if (result.success) {
        toast.success('Configuration test passed', `Responded in ${formatDuration(result.durationMs)}.`);
      } else {
        toast.error('Configuration test failed', result.failureMessage ?? 'See the details below.');
      }
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : 'The test could not be run.');
    } finally {
      setTesting(false);
    }
  }

  async function save(nextEnabled: boolean) {
    setFormError(null);
    const body = { ...payload, enabled: nextEnabled };
    if (!createCheckSchema.safeParse(body).success) {
      validate();
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        const result = await api.patch<{ check: CheckSummary }>(`/workspaces/${workspaceId}/checks/${existing.id}`, body);
        toast.success('Check updated');
        onSaved(result.check);
      } else {
        const result = await api.post<{ check: CheckSummary }>(
          `/workspaces/${workspaceId}/projects/${projectId}/checks`,
          body,
        );
        toast.success(
          nextEnabled ? 'Monitoring activated' : 'Check saved as draft',
          nextEnabled ? 'The scheduler will run it within a few seconds.' : 'Activate it when you are ready.',
        );
        onSaved(result.check);
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFormError(error.message);
        if (error.details?.length) setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      } else {
        setFormError('Could not save this check.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {formError ? <InlineNotice tone="critical">{formError}</InlineNotice> : null}

      {/* Type selector */}
      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-800">Check type</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={Boolean(existing) && existing?.type !== option.value}
              onClick={() => setType(option.value)}
              className={clsx(
                'rounded-xl border px-4 py-3 text-left transition-all duration-200',
                type === option.value
                  ? 'border-ink-900 bg-paper-50 shadow-card'
                  : 'border-paper-300 bg-paper-50 hover:border-ink-300',
                Boolean(existing) && existing?.type !== option.value && 'cursor-not-allowed opacity-40',
              )}
              aria-pressed={type === option.value}
            >
              <option.icon className="h-4 w-4 text-ink-700" aria-hidden />
              <p className="mt-2 text-[13px] font-medium text-ink-900">{option.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-400">{option.description}</p>
            </button>
          ))}
        </div>
        {existing ? (
          <p className="mt-2 text-[11.5px] text-ink-400">
            The check type cannot be changed after creation. Create a new check instead.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Check name" htmlFor="check-name" required error={errors.name}>
          <Input
            id="check-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={defaultName(type)}
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field
          label="Run every"
          htmlFor="check-interval"
          hint="The fastest supported interval is 60 seconds. Detection is not instant — a site can break right after a passing check."
          error={errors.intervalSeconds}
        >
          <Select
            id="check-interval"
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(Number(event.target.value))}
          >
            {INTERVAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Type-specific configuration */}
      {type === 'browser' ? (
        <div className="space-y-4 rounded-xl border border-paper-300 bg-paper-50 p-4">
          <Field label="Start page" htmlFor="start-url" required error={errors['config.startUrl']}>
            <Input id="start-url" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://example.com/login" />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink-800">Journey steps</p>
              <span className="text-[11.5px] text-ink-400">{steps.length} of 20</span>
            </div>
            {errors['config.steps'] ? <p className="mb-2 text-[12px] text-state-critical">{errors['config.steps']}</p> : null}

            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li key={index} className="rounded-lg border border-paper-300 bg-paper-100/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-400">{String(index + 1).padStart(2, '0')}</span>
                    <Select
                      value={step.type}
                      aria-label={`Step ${index + 1} type`}
                      onChange={(event) => {
                        const next = [...steps];
                        next[index] = defaultStep(event.target.value as JourneyStep['type']);
                        setSteps(next);
                      }}
                      className="h-8 max-w-[170px] py-0 text-[12.5px]"
                    >
                      {STEP_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setSteps(steps.filter((_, i) => i !== index))}
                      className="rounded p-1 text-ink-400 transition-colors hover:bg-paper-200 hover:text-state-critical"
                      aria-label={`Remove step ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {step.type === 'goto' ? (
                      <>
                        <Input
                          value={step.url ?? ''}
                          placeholder="URL (blank = start page)"
                          onChange={(event) => {
                            const next = [...steps];
                            next[index] = { ...step, url: event.target.value || undefined };
                            setSteps(next);
                          }}
                          aria-label="Step URL"
                        />
                        <Select
                          value={step.waitUntil}
                          aria-label="Wait until"
                          onChange={(event) => {
                            const next = [...steps];
                            next[index] = { ...step, waitUntil: event.target.value as 'load' };
                            setSteps(next);
                          }}
                        >
                          <option value="domcontentloaded">DOM ready</option>
                          <option value="load">Full load</option>
                          <option value="networkidle">Network idle</option>
                        </Select>
                      </>
                    ) : null}

                    {'selector' in step ? (
                      <Input
                        value={step.selector}
                        placeholder="CSS selector, e.g. #email"
                        onChange={(event) => {
                          const next = [...steps];
                          next[index] = { ...step, selector: event.target.value } as JourneyStep;
                          setSteps(next);
                        }}
                        aria-label="Selector"
                      />
                    ) : null}

                    {step.type === 'fill' ? (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <Input
                          value={step.secretRef ? '' : step.value ?? ''}
                          placeholder={step.secretRef ? 'Using saved credential' : 'Value to type'}
                          disabled={Boolean(step.secretRef)}
                          onChange={(event) => {
                            const next = [...steps];
                            next[index] = { ...step, value: event.target.value };
                            setSteps(next);
                          }}
                          aria-label="Value"
                        />
                        <Select
                          value={step.secretRef ?? ''}
                          aria-label="Saved credential"
                          onChange={(event) => {
                            const next = [...steps];
                            next[index] = { ...step, secretRef: event.target.value || undefined, value: undefined };
                            setSteps(next);
                          }}
                          className="max-w-[150px]"
                        >
                          <option value="">Plain value</option>
                          {secrets.map((secret) => (
                            <option key={secret.id} value={secret.id}>
                              {secret.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}

                    {step.type === 'expectText' ? (
                      <Input
                        value={step.text}
                        placeholder="Text that must be visible"
                        onChange={(event) => {
                          const next = [...steps];
                          next[index] = { ...step, text: event.target.value };
                          setSteps(next);
                        }}
                        aria-label="Expected text"
                      />
                    ) : null}

                    {step.type === 'expectUrl' ? (
                      <Input
                        value={step.contains}
                        placeholder="URL fragment, e.g. /dashboard"
                        onChange={(event) => {
                          const next = [...steps];
                          next[index] = { ...step, contains: event.target.value };
                          setSteps(next);
                        }}
                        aria-label="Expected URL fragment"
                      />
                    ) : null}

                    {step.type === 'waitForResponse' ? (
                      <>
                        <Input
                          value={step.urlContains}
                          placeholder="Response URL contains, e.g. /api/cart"
                          onChange={(event) => {
                            const next = [...steps];
                            next[index] = { ...step, urlContains: event.target.value };
                            setSteps(next);
                          }}
                          aria-label="Response URL contains"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            value={step.statusRange.min}
                            onChange={(event) => {
                              const next = [...steps];
                              next[index] = { ...step, statusRange: { ...step.statusRange, min: Number(event.target.value) } };
                              setSteps(next);
                            }}
                            aria-label="Minimum status"
                          />
                          <Input
                            type="number"
                            value={step.statusRange.max}
                            onChange={(event) => {
                              const next = [...steps];
                              next[index] = { ...step, statusRange: { ...step.statusRange, max: Number(event.target.value) } };
                              setSteps(next);
                            }}
                            aria-label="Maximum status"
                          />
                        </div>
                      </>
                    ) : null}

                    {step.type === 'press' ? (
                      <Input
                        value={step.key}
                        placeholder="Enter"
                        onChange={(event) => {
                          const next = [...steps];
                          next[index] = { ...step, key: event.target.value };
                          setSteps(next);
                        }}
                        aria-label="Key"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {STEP_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={steps.length >= 20}
                  onClick={() => setSteps([...steps, defaultStep(option.value)])}
                  className="inline-flex items-center gap-1 rounded-md border border-paper-300 bg-paper-50 px-2 py-1 text-[11.5px] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                  title={option.hint}
                >
                  <Plus className="h-3 w-3" />
                  {option.label}
                </button>
              ))}
            </div>

            {secrets.length === 0 ? (
              <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-400">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                To sign in to a protected page, add a dedicated test account under “Credentials” on the project page first.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-paper-300 pt-3 sm:grid-cols-2">
            <Switch
              checked={captureScreenshot}
              onChange={setCaptureScreenshot}
              label="Capture a screenshot on failure"
              description="Stored privately and accessible only to workspace members."
            />
            <Switch
              checked={captureTrace}
              onChange={setCaptureTrace}
              label="Capture a Playwright trace on failure"
              description="Larger files; useful for hard-to-reproduce journeys."
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-paper-300 bg-paper-50 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[110px_minmax(0,1fr)]">
            <Field label="Method" htmlFor="method">
              <Select id="method" value={method} onChange={(event) => setMethod(event.target.value)}>
                {(type === 'http' ? ['GET', 'HEAD'] : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={type === 'http' ? 'URL to check' : 'Endpoint URL'} htmlFor="url" required error={errors['config.url']}>
              <Input id="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" invalid={Boolean(errors['config.url'])} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Expected status from" htmlFor="status-min" error={errors['config.expectedStatus.min']}>
              <Input id="status-min" type="number" value={statusMin} onChange={(event) => setStatusMin(Number(event.target.value))} />
            </Field>
            <Field label="Expected status to" htmlFor="status-max" error={errors['config.expectedStatus.max']}>
              <Input id="status-max" type="number" value={statusMax} onChange={(event) => setStatusMax(Number(event.target.value))} />
            </Field>
          </div>

          {type === 'http' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Page must contain (optional)"
                htmlFor="body-contains"
                hint="Case-insensitive text match on the raw response."
              >
                <Input id="body-contains" value={bodyContains} onChange={(event) => setBodyContains(event.target.value)} placeholder="Welcome back" />
              </Field>
              <Field label="Page must not contain (optional)" htmlFor="body-not-contains">
                <Input id="body-not-contains" value={bodyNotContains} onChange={(event) => setBodyNotContains(event.target.value)} placeholder="Fatal error" />
              </Field>
            </div>
          ) : null}

          {type === 'api' ? (
            <>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-800">Request headers</p>
                {headers.map((header, index) => (
                  <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-2">
                    <Input
                      value={header.name}
                      placeholder="Authorization"
                      aria-label={`Header ${index + 1} name`}
                      onChange={(event) => {
                        const next = [...headers];
                        next[index] = { ...header, name: event.target.value };
                        setHeaders(next);
                      }}
                    />
                    <Input
                      value={header.secretRef ? '•••••• stored securely' : header.value}
                      disabled={Boolean(header.secretRef)}
                      placeholder="Bearer …"
                      aria-label={`Header ${index + 1} value`}
                      onChange={(event) => {
                        const next = [...headers];
                        next[index] = { ...header, value: event.target.value };
                        setHeaders(next);
                      }}
                    />
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-500">
                      <input
                        type="checkbox"
                        checked={header.sensitive}
                        onChange={(event) => {
                          const next = [...headers];
                          next[index] = { ...header, sensitive: event.target.checked };
                          setHeaders(next);
                        }}
                        className="h-3.5 w-3.5 rounded border-paper-400"
                      />
                      Encrypt
                    </label>
                    <button
                      type="button"
                      onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                      className="rounded p-1 text-ink-400 hover:text-state-critical"
                      aria-label={`Remove header ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setHeaders([...headers, { name: '', value: '', sensitive: true }])}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-600 hover:text-ink-900"
                >
                  <Plus className="h-3 w-3" /> Add header
                </button>
                <p className="mt-1.5 text-[11.5px] text-ink-400">
                  Values marked “Encrypt” are stored with AES-256-GCM and never returned by the API.
                </p>
              </div>

              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-800">JSON assertions</p>
                {assertions.map((assertion, index) => (
                  <div key={index} className="mb-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] items-center gap-2">
                    <Input
                      value={assertion.path}
                      placeholder="data.status"
                      aria-label={`Assertion ${index + 1} path`}
                      onChange={(event) => {
                        const next = [...assertions];
                        next[index] = { ...assertion, path: event.target.value };
                        setAssertions(next);
                      }}
                    />
                    <Select
                      value={assertion.operator}
                      aria-label={`Assertion ${index + 1} operator`}
                      onChange={(event) => {
                        const next = [...assertions];
                        next[index] = { ...assertion, operator: event.target.value };
                        setAssertions(next);
                      }}
                    >
                      {['equals', 'not_equals', 'contains', 'matches', 'exists'].map((operator) => (
                        <option key={operator} value={operator}>
                          {operator.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={assertion.value}
                      disabled={assertion.operator === 'exists'}
                      placeholder="ok"
                      aria-label={`Assertion ${index + 1} value`}
                      onChange={(event) => {
                        const next = [...assertions];
                        next[index] = { ...assertion, value: event.target.value };
                        setAssertions(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setAssertions(assertions.filter((_, i) => i !== index))}
                      className="rounded p-1 text-ink-400 hover:text-state-critical"
                      aria-label={`Remove assertion ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAssertions([...assertions, { path: '', operator: 'equals', value: '' }])}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-600 hover:text-ink-900"
                >
                  <Plus className="h-3 w-3" /> Add assertion
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <Field label="Request body" htmlFor="body-type">
                  <Select id="body-type" value={bodyType} onChange={(event) => setBodyType(event.target.value as 'none')}>
                    <option value="none">None</option>
                    <option value="json">JSON</option>
                    <option value="text">Plain text</option>
                  </Select>
                </Field>
                {bodyType !== 'none' ? (
                  <Field label="Body content" htmlFor="request-body">
                    <Textarea
                      id="request-body"
                      value={requestBody}
                      onChange={(event) => setRequestBody(event.target.value)}
                      placeholder={bodyType === 'json' ? '{"ping": true}' : 'hello'}
                      className="font-mono text-[12.5px]"
                    />
                  </Field>
                ) : null}
              </div>
            </>
          ) : null}

          <Switch
            checked={followRedirects}
            onChange={setFollowRedirects}
            label="Follow redirects"
            description="Each hop is re-validated — a redirect to a private address is blocked."
          />
        </div>
      )}

      {/* Advanced */}
      <div className="rounded-xl border border-paper-300 bg-paper-50">
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-ink-800"
          aria-expanded={advanced}
        >
          Incident thresholds and limits
          <ChevronDown className={clsx('h-4 w-4 text-ink-400 transition-transform', advanced && 'rotate-180')} />
        </button>
        {advanced ? (
          <div className="grid grid-cols-1 gap-4 border-t border-paper-300 p-4 sm:grid-cols-2">
            <Field
              label="Failures before an incident opens"
              htmlFor="failure-threshold"
              hint="Transient blips below this threshold stay as “suspicious” and never page anyone."
            >
              <Select id="failure-threshold" value={failureThreshold} onChange={(event) => setFailureThreshold(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} consecutive {value === 1 ? 'failure' : 'failures'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Successful checks before resolving"
              htmlFor="recovery-threshold"
              hint="Recovery is only declared after this many consecutive successes."
            >
              <Select id="recovery-threshold" value={recoveryThreshold} onChange={(event) => setRecoveryThreshold(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value} consecutive {value === 1 ? 'success' : 'successes'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Timeout per run" htmlFor="timeout" hint="Requests and journeys are aborted after this limit.">
              <Select id="timeout" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))}>
                {[5000, 10000, 15000, 30000, 45000, 60000].map((value) => (
                  <option key={value} value={value}>
                    {value / 1000} seconds
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity" htmlFor="severity" hint="Used in incident records and notifications.">
              <Select id="severity" value={severity} onChange={(event) => setSeverity(event.target.value as 'major')}>
                <option value="critical">Critical</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      {/* Test result */}
      {testResult ? <TestResultPanel result={testResult} /> : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-300 pt-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void runTest()} loading={testing} icon={testing ? undefined : <PlayCircle className="h-4 w-4" />}>
            Run test
          </Button>
          <span className="text-[11.5px] text-ink-400">
            {testing ? 'Running against the live site…' : `Interval: ${formatInterval(intervalSeconds)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void save(false)} loading={saving && !enabled}>
            Save as draft
          </Button>
          <Button onClick={() => void save(true)} loading={saving && enabled}>
            {existing?.enabled ? 'Save and keep active' : 'Activate monitoring'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TestResultPanel({ result }: { result: TestOutcome }) {
  return (
    <div
      className={clsx(
        'rounded-xl border p-4',
        result.success ? 'border-[#cfe3d8] bg-state-healthySoft/50' : 'border-[#efd2ce] bg-state-criticalSoft/50',
      )}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        {result.success ? (
          <CheckCircle2 className="h-4 w-4 text-state-healthy" aria-hidden />
        ) : (
          <XCircle className="h-4 w-4 text-state-critical" aria-hidden />
        )}
        <p className={clsx('text-[13px] font-semibold', result.success ? 'text-state-healthy' : 'text-state-critical')}>
          {result.success ? 'Configuration test passed' : 'Configuration test failed'}
        </p>
        <span className="tabular text-[12px] text-ink-500">
          {formatDuration(result.durationMs)}
          {result.httpStatus ? ` · HTTP ${result.httpStatus}` : ''}
          {result.failureCategory ? ` · ${result.failureCategory.replace(/_/g, ' ')}` : ''}
        </span>
      </div>

      {result.failureMessage ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{result.failureMessage}</p>
      ) : null}

      {!result.success && result.failureCategory && ['auth_failure', 'config_error', 'blocked_destination'].includes(result.failureCategory) ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-ink-500">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          This is a configuration or credential problem — it will not be treated as a website outage when monitoring runs.
        </p>
      ) : null}

      {result.evidence?.steps?.length ? (
        <ul className="mt-3 space-y-1">
          {result.evidence.steps.map((step) => (
            <li key={step.index} className="flex items-center gap-2 text-[12px] text-ink-600">
              <span className={step.ok ? 'text-state-healthy' : 'text-state-critical'}>{step.ok ? '✓' : '✕'}</span>
              <span className="font-mono text-[11px] text-ink-400">{String(step.index).padStart(2, '0')}</span>
              <span className="capitalize">{step.type}</span>
              <span className="truncate text-ink-400">{step.detail}</span>
              <span className="tabular ml-auto text-ink-300">{Math.round(step.durationMs)}ms</span>
            </li>
          ))}
        </ul>
      ) : null}

      {result.evidence?.json?.assertions?.length ? (
        <ul className="mt-3 space-y-1">
          {result.evidence.json.assertions.map((assertion, index) => (
            <li key={index} className="flex items-center gap-2 text-[12px] text-ink-600">
              <span className={assertion.ok ? 'text-state-healthy' : 'text-state-critical'}>{assertion.ok ? '✓' : '✕'}</span>
              <span className="font-mono text-[11.5px]">{assertion.path}</span>
              <span className="text-ink-400">{assertion.operator}</span>
              <span className="truncate text-ink-400">{assertion.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {result.evidence?.consoleErrors?.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-ink-500">Console errors ({result.evidence.consoleErrors.length})</summary>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-ink-500">
            {result.evidence.consoleErrors.slice(0, 5).map((error, index) => (
              <li key={index} className="truncate">{error}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function coerceValue(value: string): string | number | boolean | null {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && value.trim() !== '' ? asNumber : value;
}

function defaultName(type: CheckType): string {
  return type === 'http' ? 'Homepage responds' : type === 'api' ? 'API endpoint' : 'Sign-in journey';
}

export { defaultStep };
export type { SecretOption };

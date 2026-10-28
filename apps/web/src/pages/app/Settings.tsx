import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { NotificationDeliveryDto } from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth, useWorkspaceId } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  InlineNotice,
  Input,
  Modal,
  Select,
  Switch,
} from '../../components/ui';
import { formatDateTime, relativeTime } from '../../lib/format';

type Tab = 'workspace' | 'notifications' | 'account' | 'members';

interface WorkspaceDetail {
  workspace: {
    id: string;
    name: string;
    role: 'owner' | 'member';
    alertEmail: string | null;
    settings: { notifyOnOpen: boolean; notifyOnResolve: boolean; notifyOnRepeatFailures: boolean };
    createdAt: string;
  };
  members: { userId: string; name: string; email: string; role: string; status: string; joinedAt: string | null }[];
  email: { configured: boolean; provider: string; mode: 'live' | 'development_outbox'; message: string };
}

interface Destination {
  id: string;
  type: 'email' | 'slack';
  address: string | null;
  label: string;
  maskedWebhook: string | null;
  enabled: boolean;
  verified: boolean;
  lastError: string | null;
  createdAt: string;
}

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'workspace';

  const tabs: { value: Tab; label: string }[] = [
    { value: 'workspace', label: 'Workspace' },
    { value: 'notifications', label: 'Alerts' },
    { value: 'members', label: 'Members' },
    { value: 'account', label: 'Account' },
  ];

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-ink-900">Workspace and account</h1>
        <p className="mt-1 text-[13px] text-ink-500">Only settings that affect real behaviour are shown here.</p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-paper-300" role="tablist" aria-label="Settings sections">
        {tabs.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={tab === item.value}
            onClick={() => setParams({ tab: item.value })}
            className={clsx(
              '-mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors',
              tab === item.value
                ? 'border-ink-900 text-ink-900'
                : 'border-transparent text-ink-500 hover:text-ink-900',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'workspace' ? <WorkspaceTab /> : null}
      {tab === 'notifications' ? <NotificationsTab /> : null}
      {tab === 'members' ? <MembersTab /> : null}
      {tab === 'account' ? <AccountTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

function WorkspaceTab() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [settings, setSettings] = useState({ notifyOnOpen: true, notifyOnResolve: true, notifyOnRepeatFailures: false });

  const { data } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<WorkspaceDetail>(`/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!data) return;
    setName(data.workspace.name);
    setAlertEmail(data.workspace.alertEmail ?? '');
    setSettings(data.workspace.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/workspaces/${workspaceId}`, {
        name,
        alertEmail: alertEmail || '',
        ...settings,
      }),
    onSuccess: async () => {
      toast.success('Workspace settings saved');
      await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (caught) => toast.error('Could not save', (caught as Error).message),
  });

  const isOwner = data?.workspace.role === 'owner';

  return (
    <div className="max-w-2xl space-y-3">
      <Card>
        <CardHeader title="Workspace" description="Applies to every project and alert in this workspace." />
        <div className="space-y-4 p-5">
          <Field label="Workspace name" htmlFor="ws-name" hint={isOwner ? undefined : 'Only the owner can change this.'}>
            <Input id="ws-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!isOwner} />
          </Field>
          <Field
            label="Fallback alert email"
            htmlFor="ws-alert"
            hint="Used for reference only — actual delivery targets are listed under Alerts."
          >
            <Input
              id="ws-alert"
              type="email"
              value={alertEmail}
              onChange={(event) => setAlertEmail(event.target.value)}
              disabled={!isOwner}
              placeholder="alerts@agency.com"
            />
          </Field>

          <div className="space-y-4 border-t border-paper-300 pt-4">
            <Switch
              checked={settings.notifyOnOpen}
              onChange={(value) => setSettings({ ...settings, notifyOnOpen: value })}
              label="Email me when an incident opens"
              description="One email per incident — repeated failures do not re-send it."
              disabled={!isOwner}
            />
            <Switch
              checked={settings.notifyOnResolve}
              onChange={(value) => setSettings({ ...settings, notifyOnResolve: value })}
              label="Email me when an incident is resolved"
              disabled={!isOwner}
            />
            <Switch
              checked={settings.notifyOnRepeatFailures}
              onChange={(value) => setSettings({ ...settings, notifyOnRepeatFailures: value })}
              label="Send hourly “still failing” reminders"
              description="At most one reminder per incident per hour."
              disabled={!isOwner}
            />
          </div>

          <div className="flex justify-end border-t border-paper-300 pt-4">
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!isOwner}>
              Save changes
            </Button>
          </div>
        </div>
      </Card>

      {data ? (
        <Card className="p-4">
          <p className="text-[12px] font-medium text-ink-800">Email delivery</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{data.email.message}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={data.email.configured ? 'healthy' : 'warning'}>
              {data.email.configured ? `${data.email.provider} configured` : 'development outbox'}
            </Badge>
            {!data.email.configured ? (
              <span className="text-[11.5px] text-ink-400">Set EMAIL_PROVIDER + credentials in the server environment.</span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

function NotificationsTab() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [type, setType] = useState<'email' | 'slack'>('email');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');

  const destinations = useQuery({
    queryKey: ['destinations', workspaceId],
    queryFn: () =>
      api.get<{ destinations: Destination[]; email: { configured: boolean; message: string } }>(
        `/workspaces/${workspaceId}/notifications`,
      ),
    enabled: Boolean(workspaceId),
  });

  const deliveries = useQuery({
    queryKey: ['deliveries', workspaceId],
    queryFn: () =>
      api.get<{ deliveries: NotificationDeliveryDto[]; email: { configured: boolean; message: string } }>(
        `/workspaces/${workspaceId}/deliveries?limit=20`,
      ),
    enabled: Boolean(workspaceId),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post(`/workspaces/${workspaceId}/notifications`, {
        type,
        ...(type === 'email' ? { address: value } : { webhookUrl: value }),
        ...(label ? { label } : {}),
      }),
    onSuccess: async () => {
      toast.success('Destination added');
      setAddOpen(false);
      setValue('');
      setLabel('');
      await queryClient.invalidateQueries({ queryKey: ['destinations', workspaceId] });
    },
    onError: (caught) => toast.error('Could not add destination', (caught as Error).message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/workspaces/${workspaceId}/notifications/${id}`, { enabled }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['destinations', workspaceId] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/workspaces/${workspaceId}/notifications/${id}`),
    onSuccess: async () => {
      toast.success('Destination removed');
      await queryClient.invalidateQueries({ queryKey: ['destinations', workspaceId] });
    },
  });

  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; provider: string; error: string | null }>(`/workspaces/${workspaceId}/notifications/${id}/test`),
    onSuccess: async (result) => {
      if (result.ok) {
        toast.success(
          result.provider === 'development_outbox' ? 'Test written to the development outbox' : 'Test message sent',
          result.provider === 'development_outbox' ? 'No real mailbox was contacted — configure a provider to send real email.' : undefined,
        );
      } else {
        toast.error('Test failed', result.error ?? undefined);
      }
      await queryClient.invalidateQueries({ queryKey: ['destinations', workspaceId] });
      await queryClient.invalidateQueries({ queryKey: ['deliveries', workspaceId] });
    },
    onError: (caught) => toast.error('Test failed', (caught as Error).message),
  });

  return (
    <div className="max-w-3xl space-y-3">
      {destinations.data && !destinations.data.email.configured ? (
        <InlineNotice tone="warning">
          No email provider is configured on this server. Alerts are written to a development outbox instead of being
          delivered, and are labelled as such everywhere in the app.
        </InlineNotice>
      ) : null}

      <Card>
        <CardHeader
          title="Alert destinations"
          description="Every incident notification is delivered to each enabled destination."
          action={
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
              Add destination
            </Button>
          }
        />
        {destinations.data?.destinations.length ? (
          <ul className="divide-y divide-paper-200">
            {destinations.data.destinations.map((destination) => (
              <li key={destination.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-paper-300 bg-paper-100 text-ink-600">
                  {destination.type === 'email' ? <Mail className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-900">{destination.label}</p>
                  <p className="truncate text-[11.5px] text-ink-400">
                    {destination.type === 'email' ? destination.address : destination.maskedWebhook}
                    {destination.verified ? ' · verified' : ' · not verified yet'}
                  </p>
                  {destination.lastError ? <p className="text-[11.5px] text-state-critical">{destination.lastError}</p> : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => test.mutate(destination.id)}
                  loading={test.isPending && test.variables === destination.id}
                >
                  Send test
                </Button>
                <Switch
                  checked={destination.enabled}
                  onChange={(enabled) => toggle.mutate({ id: destination.id, enabled })}
                  label=""
                  id={`dest-${destination.id}`}
                />
                <button
                  onClick={() => remove.mutate(destination.id)}
                  className="rounded p-1 text-ink-400 hover:text-state-critical"
                  aria-label={`Remove ${destination.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No destinations yet"
            description="Add an email address or Slack webhook to receive incident notifications."
            action={<Button size="sm" onClick={() => setAddOpen(true)}>Add destination</Button>}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Delivery history" description="Queued, sent and failed attempts — as recorded." />
        {deliveries.data?.deliveries.length ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-paper-200 text-[10.5px] uppercase tracking-[0.12em] text-ink-400">
                  <th className="px-5 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Destination</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {deliveries.data.deliveries.map((delivery) => (
                  <tr key={delivery.id} className="text-[12.5px]">
                    <td className="px-5 py-2.5 text-ink-800">{delivery.eventType.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2.5 text-ink-500">{delivery.destinationLabel}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        tone={
                          delivery.status === 'sent' || delivery.status === 'delivered'
                            ? 'healthy'
                            : delivery.status === 'failed'
                              ? 'critical'
                              : delivery.status === 'skipped'
                                ? 'neutral'
                                : 'info'
                        }
                      >
                        {delivery.status}
                      </Badge>
                    </td>
                    <td className="tabular px-3 py-2.5 text-ink-500">{delivery.attempts}</td>
                    <td className="px-3 py-2.5 text-ink-500" title={formatDateTime(delivery.createdAt)}>
                      {relativeTime(delivery.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No deliveries yet" description="Notification attempts appear here once an incident opens." />
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add an alert destination"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} loading={add.isPending} disabled={!value.trim()}>
              Add destination
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Type" htmlFor="dest-type">
            <Select id="dest-type" value={type} onChange={(event) => setType(event.target.value as 'email')}>
              <option value="email">Email address</option>
              <option value="slack">Slack webhook</option>
            </Select>
          </Field>
          <Field
            label={type === 'email' ? 'Email address' : 'Slack webhook URL'}
            htmlFor="dest-value"
            hint={type === 'email' ? 'Incident details are sent to this address.' : 'Stored encrypted; only used to post incident messages.'}
          >
            <Input
              id="dest-value"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={type === 'email' ? 'alerts@agency.com' : 'https://hooks.slack.com/services/…'}
            />
          </Field>
          <Field label="Label (optional)" htmlFor="dest-label">
            <Input id="dest-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="On-call channel" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

function MembersTab() {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');

  const { data } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<WorkspaceDetail>(`/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const invite = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/members`, { email, role }),
    onSuccess: async () => {
      toast.success('Member added');
      setInviteOpen(false);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    },
    onError: (caught) =>
      toast.error('Could not add member', caught instanceof ApiRequestError ? caught.message : (caught as Error).message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: async () => {
      toast.success('Member removed');
      await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    },
    onError: (caught) => toast.error('Could not remove member', (caught as Error).message),
  });

  const isOwner = data?.workspace.role === 'owner';

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Members"
        description="Everyone here can view and manage this workspace's projects."
        action={
          isOwner ? (
            <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInviteOpen(true)}>
              Add member
            </Button>
          ) : null
        }
      />
      <ul className="divide-y divide-paper-200">
        {data?.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-5 py-3.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-paper-300 bg-paper-100 text-[11px] font-semibold text-ink-700">
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-900">{member.name}</p>
              <p className="truncate text-[11.5px] text-ink-400">{member.email}</p>
            </div>
            <Badge tone={member.role === 'owner' ? 'dark' : 'neutral'} className="capitalize">
              {member.role}
            </Badge>
            {isOwner && member.role !== 'owner' ? (
              <button
                onClick={() => remove.mutate(member.userId)}
                className="rounded p-1 text-ink-400 hover:text-state-critical"
                aria-label={`Remove ${member.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a member"
        description="The person must already have a BreakGlass account."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!email.trim()}>
              Add member
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email address" htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@agency.com" />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint="Owners can change workspace settings and delete projects.">
            <Select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as 'member')}>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  timezone: z.string().min(1),
});

const passwordSchemaForm = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(200),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const TIMEZONES = [
  'UTC',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Lisbon',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
];

function AccountTab() {
  const { user, refresh, signOut } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState<{ id: string; userAgent: string | null; lastSeenAt: string; current: boolean }[]>([]);

  const accountForm = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: user?.name ?? '', timezone: user?.timezone ?? 'UTC' },
  });

  const passwordForm = useForm<z.infer<typeof passwordSchemaForm>>({
    resolver: zodResolver(passwordSchemaForm),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (user) accountForm.reset({ name: user.name, timezone: user.timezone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    api
      .get<{ sessions: { id: string; userAgent: string | null; lastSeenAt: string; current: boolean }[] }>('/auth/sessions')
      .then((result) => setSessions(result.sessions))
      .catch(() => setSessions([]));
  }, []);

  const saveAccount = accountForm.handleSubmit(async (values) => {
    try {
      await api.patch('/auth/account', values);
      await refresh();
      await queryClient.invalidateQueries();
      toast.success('Account updated');
    } catch (caught) {
      toast.error('Could not save', (caught as Error).message);
    }
  });

  const savePassword = passwordForm.handleSubmit(async (values) => {
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      passwordForm.reset();
      toast.success('Password updated', 'Other sessions were signed out.');
    } catch (caught) {
      toast.error('Could not update password', (caught as Error).message);
    }
  });

  return (
    <div className="max-w-2xl space-y-3">
      <Card>
        <CardHeader title="Profile" description="Your name and how times are displayed." />
        <form onSubmit={saveAccount} className="space-y-4 p-5">
          <Field label="Name" htmlFor="account-name" error={accountForm.formState.errors.name?.message}>
            <Input id="account-name" {...accountForm.register('name')} />
          </Field>
          <Field label="Email" htmlFor="account-email" hint="Contact support to change your email address.">
            <Input id="account-email" value={user?.email ?? ''} disabled />
          </Field>
          <Field label="Timezone" htmlFor="account-timezone" hint="Used for incident times across the app.">
            <Select id="account-timezone" {...accountForm.register('timezone')}>
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between border-t border-paper-300 pt-4">
            <Badge tone={user?.emailVerified ? 'healthy' : 'warning'}>
              {user?.emailVerified ? 'Email verified' : 'Email not verified'}
            </Badge>
            <Button type="submit" size="sm" loading={accountForm.formState.isSubmitting}>
              Save profile
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Password" description="Changing your password signs out every other session." />
        <form onSubmit={savePassword} className="space-y-4 p-5">
          <Field label="Current password" htmlFor="current-password" error={passwordForm.formState.errors.currentPassword?.message}>
            <Input id="current-password" type="password" autoComplete="current-password" {...passwordForm.register('currentPassword')} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="new-password" error={passwordForm.formState.errors.newPassword?.message}>
              <Input id="new-password" type="password" autoComplete="new-password" {...passwordForm.register('newPassword')} />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password" error={passwordForm.formState.errors.confirmPassword?.message}>
              <Input id="confirm-password" type="password" autoComplete="new-password" {...passwordForm.register('confirmPassword')} />
            </Field>
          </div>
          <div className="flex justify-end border-t border-paper-300 pt-4">
            <Button type="submit" size="sm" loading={passwordForm.formState.isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
        <ul className="divide-y divide-paper-200">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-ink-800">{session.userAgent ?? 'Unknown device'}</p>
                <p className="text-[11.5px] text-ink-400">last active {relativeTime(session.lastSeenAt)}</p>
              </div>
              {session.current ? <Badge tone="healthy">this device</Badge> : null}
            </li>
          ))}
          {sessions.length === 0 ? <li className="px-5 py-4 text-[12.5px] text-ink-400">No active sessions found.</li> : null}
        </ul>
        <div className="flex justify-between border-t border-paper-300 px-5 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await api.post('/auth/sessions/revoke-all');
              toast.success('Other sessions signed out');
            }}
          >
            Sign out other sessions
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}

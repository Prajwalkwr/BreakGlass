import type { CheckRuntimeStatus, IncidentStatus, ProjectSummary } from '@breakglass/shared';
import { Badge, StatusDot, type Tone } from './ui';
import { INCIDENT_LABELS, STATUS_LABELS } from '../lib/format';

const HEALTH_TONES: Record<ProjectSummary['health'], { tone: Tone; label: string }> = {
  healthy: { tone: 'healthy', label: 'Healthy' },
  degraded: { tone: 'warning', label: 'Degraded' },
  down: { tone: 'critical', label: 'Incident' },
  unknown: { tone: 'neutral', label: 'Not monitored' },
  paused: { tone: 'neutral', label: 'Paused' },
};

export function ProjectHealthBadge({ health }: { health: ProjectSummary['health'] }) {
  const config = HEALTH_TONES[health];
  return (
    <Badge tone={config.tone} dot>
      {config.label}
    </Badge>
  );
}

const CHECK_TONES: Record<CheckRuntimeStatus, Tone> = {
  healthy: 'healthy',
  failing: 'critical',
  suspected: 'warning',
  paused: 'neutral',
  pending: 'info',
  misconfigured: 'warning',
  auth_failure: 'warning',
  worker_error: 'warning',
};

export function CheckStatusBadge({ status }: { status: CheckRuntimeStatus }) {
  return (
    <Badge tone={CHECK_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function CheckStatusDot({ status }: { status: CheckRuntimeStatus }) {
  return <StatusDot tone={CHECK_TONES[status]} pulse={status === 'failing' || status === 'suspected'} />;
}

const INCIDENT_TONES: Record<IncidentStatus, Tone> = {
  open: 'critical',
  acknowledged: 'warning',
  recovering: 'info',
  resolved: 'healthy',
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge tone={INCIDENT_TONES[status]} dot={status !== 'resolved'}>
      {INCIDENT_LABELS[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: 'critical' | 'major' | 'minor' }) {
  const tone: Tone = severity === 'critical' ? 'critical' : severity === 'major' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} className="capitalize">
      {severity}
    </Badge>
  );
}

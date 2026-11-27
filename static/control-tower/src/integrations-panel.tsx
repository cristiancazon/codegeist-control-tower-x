import { makeInvoke, rovo } from '@forge/bridge';
import { useEffect, useId, useState } from 'react';
import { INTEGRATIONS_GET, type IntegrationsResult } from '../../../src/shared/integrations';
import './integrations-panel.css';

const invoke = makeInvoke<{ [INTEGRATIONS_GET]: () => IntegrationsResult | undefined }>();

type Matrix = Extract<IntegrationsResult, { ok: true }>['data'];
type Capability = Matrix['capabilities'][number];
type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; data: Matrix }
  | { state: 'error'; message: string; retryable: boolean; requestId?: string };

const labels: Record<Capability['status'], string> = {
  VERIFIED: 'Verificada',
  DEGRADED: 'Degradada',
  DISABLED: 'Sin habilitar',
  UNVERIFIED: 'Sin verificar',
};
const loading = { state: 'loading' } as const;
const unavailable = {
  state: 'error', message: 'No se pudieron consultar las integraciones de este proyecto.', retryable: true,
} as const;
const observedTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
});

function CheckedAt({ value }: { value: string }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Sin fecha registrada';
  return <time dateTime={value}>{observedTime.format(date)}</time>;
}

async function observeRovo(matrix: Matrix): Promise<Matrix> {
  if (!matrix.capabilities.some(({ id }) => id === 'ROVO')) return matrix;
  let result: Pick<Capability, 'status' | 'detail' | 'fallback' | 'evidence'>;
  const fallback = 'Podés seguir consultando la Vista general y Futuros desde Jira.';
  try {
    result = await rovo.isEnabled() ? {
      status: 'VERIFIED',
      detail: 'La disponibilidad de Rovo Chat se comprobó en esta sesión de Jira.',
      fallback: undefined,
      evidence: { operation: 'rovo.isEnabled', observedAt: new Date().toISOString() },
    } : {
      status: 'DISABLED', detail: 'Rovo Chat está deshabilitado en esta sesión de Jira.', fallback, evidence: undefined,
    };
  } catch {
    result = {
      status: 'DEGRADED', detail: 'La disponibilidad de Rovo Chat quedó sin comprobar en esta sesión de Jira.',
      fallback, evidence: undefined,
    };
  }
  return { ...matrix, capabilities: matrix.capabilities.map((item) => item.id === 'ROVO' ? { ...item, ...result } : item) };
}

function CapabilityCard({ capability }: { capability: Capability }) {
  const { label, status, detail, fallback, evidence } = capability;
  return <li className="integration-capability">
    <div className="integration-capability-heading">
      <h3>{label}</h3>
      <span className="integration-capability-status" data-status={status}>{labels[status]}</span>
    </div>
    <p className="integration-capability-detail">{detail}</p>
    {fallback && <p className="integration-capability-fallback">{fallback}</p>}
    {evidence && <p className="integration-panel-support">
      Evidencia de <strong>{evidence.operation}</strong> · <CheckedAt value={evidence.observedAt} />
      {evidence.reference && <> · {evidence.reference}</>}
    </p>}
  </li>;
}

export function IntegrationsPanel() {
  const heading = useId();
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<LoadState>(loading);

  useEffect(() => {
    let active = true;
    async function fetchStatus() {
      try {
        const result = await invoke(INTEGRATIONS_GET);
        if (!active) return;
        if (result?.ok) {
          const data = await observeRovo(result.data);
          if (active) setLoad({ state: 'ready', data });
        } else if (result) {
          setLoad({
            state: 'error', message: result.error.message, retryable: result.error.retryable, requestId: result.requestId,
          });
        } else {
          setLoad(unavailable);
        }
      } catch {
        if (active) setLoad(unavailable);
      }
    }
    void fetchStatus();
    return () => { active = false; };
  }, [attempt]);

  function refresh() {
    setLoad(loading);
    setAttempt((value) => value + 1);
  }

  const checking = load.state === 'loading';
  const showRefresh = load.state !== 'error' || load.retryable;
  const populated = load.state === 'ready' && load.data.capabilities.length > 0;
  const announcement = checking ? 'Consultando el estado de las integraciones…'
    : populated ? 'Estados de integración actualizados.'
      : load.state === 'ready' ? 'Sin estados de integración registrados.' : '';

  return <section className="connection integration-panel" aria-labelledby={heading}>
    <div className="integration-panel-header">
      <h2 id={heading}>Integraciones del proyecto</h2>
      {showRefresh && <button type="button" disabled={checking} onClick={refresh}>
        {load.state === 'error' ? 'Reintentar consulta' : 'Actualizar integraciones'}
      </button>}
    </div>
    <p className="integration-panel-status" data-announcement-only={populated} role="status">{announcement}</p>
    <div aria-busy={checking}>
      {load.state === 'error' && <div role="alert">
        <p className="message-error">{load.message}</p>
        {load.requestId && <p className="integration-panel-support">Referencia de soporte <code>{load.requestId}</code></p>}
      </div>}
      {load.state === 'ready' && <>
        <p className="integration-panel-scope">Proyecto Jira <code>{load.data.projectId}</code> · Consultado <CheckedAt value={load.data.observedAt} /> (Buenos Aires)</p>
        {load.data.capabilities.length > 0 && <ul className="integration-capabilities" role="list">
          {load.data.capabilities.map((capability) => <CapabilityCard key={capability.id} capability={capability} />)}
        </ul>}
      </>}
    </div>
  </section>;
}

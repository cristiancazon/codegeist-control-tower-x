import { makeInvoke, router } from '@forge/bridge';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  DECISIONS_ACTIVATE_APPROVER, DECISIONS_APPROVE, DECISIONS_EXECUTE, DECISIONS_GET, DECISIONS_LIST, DECISIONS_PREPARE,
  DECISIONS_PROPOSE, DECISIONS_RECONCILE, DECISIONS_REJECT,
  type Decision, type DecisionActivity, type DecisionCard, type DecisionDraft, type DecisionEvidence, type DecisionProposal,
  type DecisionReference, type DecisionReview, type DecisionStatus, type DecisionsResult,
} from '../../../src/shared/decisions';
import './decisions.css';

const invoke = makeInvoke<{
  [DECISIONS_LIST]: () => DecisionsResult<DecisionCard[]>;
  [DECISIONS_GET]: (input: { decisionId: string }) => DecisionsResult<Decision>;
  [DECISIONS_PREPARE]: (input: { runId: string }) => DecisionsResult<DecisionDraft>;
  [DECISIONS_PROPOSE]: (input: DecisionProposal) => DecisionsResult<Decision>;
  [DECISIONS_APPROVE]: (input: DecisionReview) => DecisionsResult<Decision>;
  [DECISIONS_REJECT]: (input: DecisionReview) => DecisionsResult<Decision>;
  [DECISIONS_EXECUTE]: (input: DecisionReference) => DecisionsResult<Decision>;
  [DECISIONS_RECONCILE]: (input: DecisionReference) => DecisionsResult<Decision>;
  [DECISIONS_ACTIVATE_APPROVER]: (input: { confirmed: true }) => DecisionsResult<{ granted: true }>;
}>();

const statusLabels: Record<DecisionStatus, string> = {
  PROPOSED: 'Pendiente de aprobación', APPROVED: 'Aprobada', REJECTED: 'Rechazada', EXPIRED: 'Vencida',
  EXECUTING: 'Creación en curso', APPLIED: 'Incidencia confirmada', FAILED: 'Creación fallida',
  RECONCILIATION_REQUIRED: 'Conciliación pendiente',
};
const statusDescriptions: Partial<Record<DecisionStatus, string>> = {
  APPROVED: 'El proponente puede solicitar la creación en Jira con una confirmación separada y permisos vigentes.',
  REJECTED: 'La revisión quedó cerrada. Podés preparar una nueva propuesta desde la corrida si la evidencia sigue vigente.',
  EXPIRED: 'Venció la vigencia de esta propuesta. Podés preparar otra desde la corrida si la evidencia sigue vigente.',
  EXECUTING: 'Jira está procesando la solicitud. Actualizá el estado para ver la confirmación.',
  RECONCILIATION_REQUIRED: 'Jira no confirmó el resultado. La búsqueda intenta verificar una incidencia existente y conserva la conciliación pendiente si el resultado sigue siendo incierto.',
  FAILED: 'El intento terminó sin una creación confirmada. Si la propuesta admite otro intento, la creación requiere una confirmación nueva.',
};
const issueKeyPattern = /^[A-Z][A-Z0-9_]{0,39}-[1-9][0-9]{0,31}$/;
const moneyWhole = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
});
const summaryMax = 120;
const descriptionMax = 2_000;
const reviewMax = 400;

type Props = { decisionId?: string; runId?: string; onOpen(id: string): void; onBack(): void; onOpenRun(runId: string): void };
type Failure = Extract<DecisionsResult<unknown>, { ok: false }>['error'] & { requestId?: string };
type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; failure: Failure };
type Mutation = 'approve' | 'reject' | 'execute' | 'reconcile';

const unavailable: Failure = {
  code: 'UNAVAILABLE', message: 'No se pudo obtener una respuesta de Decisions. Volvé a consultar el estado.', retryable: true,
};

function failureOf(result: Extract<DecisionsResult<unknown>, { ok: false }>): Failure {
  return { ...result.error, requestId: result.requestId };
}

function useDecisionRead<T>(read: () => Promise<DecisionsResult<T> | undefined>) {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void read().then((result) => {
      if (!current) return;
      if (result?.ok) setLoad({ state: 'ready', data: result.data });
      else setLoad({ state: 'error', failure: result ? failureOf(result) : unavailable });
    }, () => { if (current) setLoad({ state: 'error', failure: unavailable }); });
    return () => { current = false; };
  }, [read, attempt]);
  function refresh() {
    setLoad({ state: 'loading' });
    setAttempt((value) => value + 1);
  }
  return { load, setLoad, refresh };
}

function DateValue({ value }: { value: string }) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return <time dateTime={value}>{value}</time>;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? <time dateTime={value}>{dateTime.format(timestamp)}</time> : <>Sin fecha disponible</>;
}

function usd(value: string) {
  if (!/^[0-9]+$/.test(value)) return 'Sin importe disponible';
  const amount = BigInt(value);
  return `USD ${moneyWhole.format(amount / 100n)},${String(amount % 100n).padStart(2, '0')}`;
}

function Status({ status }: { status: DecisionStatus }) {
  return <span className="dec-status" data-status={status}>{statusLabels[status]}</span>;
}

function Problem({ failure, retry }: { failure: Failure; retry?: () => void }) {
  return <div className="dec-problem" role="alert">
    <p>{failure.message}</p>
    {failure.requestId && <p className="dec-muted">Referencia de soporte <code>{failure.requestId}</code></p>}
    {failure.retryable && retry && <button type="button" className="dec-secondary" onClick={retry}>Reintentar consulta</button>}
  </div>;
}

function JiraLink({ issueKey }: { issueKey: string }) {
  const [unreachable, setUnreachable] = useState(false);
  if (!issueKeyPattern.test(issueKey)) return null;
  return <span className="dec-jira-link">
    <button type="button" className="dec-link" aria-label={`Abrir ${issueKey} en Jira en otra pestaña`}
      onClick={() => {
        setUnreachable(false);
        void router.open(`/browse/${encodeURIComponent(issueKey)}`).catch(() => setUnreachable(true));
      }}>{issueKey} <span aria-hidden="true">↗</span></button>
    {unreachable && <span role="status" className="dec-muted">No se pudo abrir la incidencia en Jira.</span>}
  </span>;
}

function Evidence({ evidence, onOpenRun }: { evidence: DecisionEvidence; onOpenRun(runId: string): void }) {
  return <details className="dec-evidence">
    <summary>Evidencia de Futuros</summary>
    <dl className="dec-facts">
      <div><dt>Escenario</dt><dd>{evidence.scenario}</dd></div>
      <div><dt>Plazo P80</dt><dd>{decimal.format(evidence.durationP80Days)} días</dd></div>
      <div><dt>Costo P80</dt><dd>{usd(evidence.costP80Cents)}</dd></div>
      <div><dt>Fecha de corte</dt><dd><DateValue value={evidence.asOf} /></dd></div>
      <div><dt>Modelo</dt><dd><code>{evidence.modelVersion}</code></dd></div>
      <div><dt>Origen Jira</dt><dd><JiraLink issueKey={evidence.sourceIssueKey} /></dd></div>
      <div><dt>Snapshot</dt><dd><code>{evidence.snapshotId}</code></dd></div>
      <div><dt>Huella del resultado</dt><dd><code>{evidence.resultHash}</code></dd></div>
      <div><dt>Corrida</dt><dd><code>{evidence.runId}</code></dd></div>
    </dl>
    <button type="button" className="dec-secondary" onClick={() => onOpenRun(evidence.runId)}>Abrir corrida en Futuros</button>
  </details>;
}

const readInbox = () => invoke(DECISIONS_LIST);

function Inbox({ onOpen }: Pick<Props, 'onOpen'>) {
  const { load, refresh } = useDecisionRead(readInbox);
  const [filter, setFilter] = useState<DecisionStatus | ''>('');
  const [activating, setActivating] = useState(false);
  const [activationFailure, setActivationFailure] = useState<Failure>();
  const matched = load.state === 'ready' ? load.data.filter(({ status }) => !filter || status === filter) : [];

  async function activate() {
    setActivating(true);
    setActivationFailure(undefined);
    try {
      const result = await invoke(DECISIONS_ACTIVATE_APPROVER, { confirmed: true });
      if (result?.ok) refresh();
      else setActivationFailure(result ? failureOf(result) : unavailable);
    } catch {
      setActivationFailure(unavailable);
    } finally {
      setActivating(false);
    }
  }

  return <>
    {load.state === 'loading' && <p role="status">Cargando propuestas…</p>}
    {load.state === 'error' && <Problem failure={load.failure} retry={refresh} />}
    {load.state === 'error' && load.failure.code === 'APPROVER_SETUP' && <>
      <button type="button" disabled={activating} onClick={() => void activate()}>
        {activating ? 'Activando rol…' : 'Activar revisión para mi cuenta'}
      </button>
      {activationFailure && <Problem failure={activationFailure} />}
    </>}
    {load.state === 'ready' && <>
      {load.data.length > 0 && <div className="dec-inbox-tools">
        <label className="dec-field">Estado
          <select value={filter} onChange={(event) => setFilter(event.target.value as DecisionStatus | '')}>
            <option value="">Todos los estados</option>
            {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="dec-secondary" onClick={refresh}>Actualizar bandeja</button>
      </div>}
      {matched.length > 0 ? <ul className="dec-inbox" role="list">
        {matched.map((decision) => <li key={decision.id}>
          <div>
            <button type="button" className="dec-link" onClick={() => onOpen(decision.id)}>{decision.summary}</button>
            <p className="dec-muted"><DateValue value={decision.proposedAt} />{decision.isMine && ' · Propuesta propia'}</p>
          </div>
          <Status status={decision.status} />
        </li>)}
      </ul> : <p role="status">{filter ? 'No hay propuestas con ese estado.' : 'Todavía no hay propuestas visibles. Podés preparar una desde una corrida elegible en Futuros.'}</p>}
    </>}
  </>;
}

function DraftForm({ draft, onOpen, onOpenRun }: { draft: DecisionDraft } & Pick<Props, 'onOpen' | 'onOpenRun'>) {
  const [summary, setSummary] = useState(draft.summary);
  const [description, setDescription] = useState(draft.description);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const lock = useRef(false);
  const active = useRef(true);
  const pending = useRef<{ content: string; key: string }>(null);
  const descriptionHint = useId();

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const normalized = { runId: draft.evidence.runId, summary: summary.trim(), description: description.trim() };
  const valid = normalized.summary.length > 0 && normalized.summary.length <= summaryMax
    && normalized.description.length > 0 && normalized.description.length <= descriptionMax;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      const content = JSON.stringify(normalized);
      const key = pending.current?.content === content ? pending.current.key : crypto.randomUUID();
      pending.current = { content, key };
      const result = await invoke(DECISIONS_PROPOSE, { ...normalized, idempotencyKey: key,
        expectedResultHash: draft.evidence.resultHash, expectedIssueTypeId: draft.target.issueTypeId,
        expectedProjectKey: draft.target.projectKey });
      if (!active.current) return;
      if (result?.ok) onOpen(result.data.id);
      else setFailure(result ? failureOf(result) : unavailable);
    } catch {
      if (active.current) setFailure({ ...unavailable, message: 'No se pudo confirmar el envío. Podés intentar de nuevo con el mismo texto.' });
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }

  return <div className="dec-card">
    <dl className="dec-facts dec-target">
      <div><dt>Proyecto de destino</dt><dd>{draft.target.projectKey}</dd></div>
      <div><dt>Tipo de incidencia en Jira</dt><dd><code>{draft.target.issueTypeId}</code></dd></div>
    </dl>
    <form className="dec-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <label className="dec-field">Resumen de la incidencia
        <input required value={summary} maxLength={summaryMax} disabled={busy} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label className="dec-field">Descripción de la incidencia
        <textarea required rows={7} value={description} maxLength={descriptionMax} disabled={busy}
          aria-describedby={descriptionHint} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <p className="dec-muted" id={descriptionHint}>El texto final incluirá la referencia a la evidencia. La propuesta quedará pendiente de revisión por otra cuenta.</p>
      {failure && <Problem failure={failure} />}
      <div className="dec-actions">
        <button type="submit" disabled={busy || !valid}>{busy ? 'Registrando propuesta…' : 'Enviar para aprobación'}</button>
      </div>
    </form>
    <Evidence evidence={draft.evidence} onOpenRun={onOpenRun} />
  </div>;
}

function Prepare({ runId, onOpen, onOpenRun }: { runId: string } & Pick<Props, 'onOpen' | 'onOpenRun'>) {
  const read = useCallback(() => invoke(DECISIONS_PREPARE, { runId }), [runId]);
  const { load, refresh } = useDecisionRead(read);
  if (load.state === 'loading') return <p role="status">Verificando la corrida y el destino Jira…</p>;
  if (load.state === 'error') return <Problem failure={load.failure} retry={refresh} />;
  return <DraftForm draft={load.data} onOpen={onOpen} onOpenRun={onOpenRun} />;
}

function Timeline({ decision }: { decision: Decision }) {
  const labels: Record<DecisionActivity['event'], string> = {
    proposed: 'Propuesta registrada', approved: 'Propuesta aprobada', rejected: 'Propuesta rechazada',
    execution_reserved: 'Creación solicitada', execution_failed: 'Creación rechazada',
    reconciliation_required: 'Conciliación pendiente', reconciled: 'Incidencia encontrada en Jira', applied: 'Incidencia confirmada',
  };
  const actors: Record<DecisionActivity['actor'], string> = {
    SELF: 'Tu cuenta', PLANNER: 'Proponente', APPROVER: 'Aprobador', SYSTEM: 'Control Tower X',
  };
  return <div className="dec-history">
    <h3>Actividad</h3>
    <ol>{decision.activity.map(({ id, event, at, actor }) => <li key={id}>
      <strong>{labels[event]}</strong><span><DateValue value={at} /> · {actors[actor]}</span>
    </li>)}</ol>
    {decision.reviewReason && <div className="dec-review-reason"><strong>Motivo de revisión</strong><p>{decision.reviewReason}</p></div>}
  </div>;
}

function DecisionDetail({ decisionId, onOpenRun }: { decisionId: string } & Pick<Props, 'onOpenRun'>) {
  const read = useCallback(() => invoke(DECISIONS_GET, { decisionId }), [decisionId]);
  const { load, setLoad, refresh } = useDecisionRead(read);
  const [action, setAction] = useState<Mutation>();
  const [failure, setFailure] = useState<Failure>();
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [notify, setNotify] = useState('');
  const [reason, setReason] = useState('');
  const [confirmCreate, setConfirmCreate] = useState(false);
  const lock = useRef(false);
  const confirmHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (confirmCreate) confirmHeading.current?.focus(); }, [confirmCreate]);

  function update() {
    setFailure(undefined);
    setRefreshRequired(false);
    setNotify('');
    setReason('');
    setConfirmCreate(false);
    refresh();
  }

  if (load.state === 'loading') return <p role="status">Cargando la propuesta…</p>;
  if (load.state === 'error') return <Problem failure={load.failure} retry={update} />;
  const decision = load.data;
  const busy = action !== undefined;
  const canReview = !refreshRequired && decision.canReview && decision.status === 'PROPOSED' && !decision.isMine;
  const canExecute = !refreshRequired && decision.canExecute && decision.isMine
    && (decision.status === 'APPROVED' || decision.status === 'FAILED');
  const canReconcile = !refreshRequired && decision.canReconcile && decision.status === 'RECONCILIATION_REQUIRED';
  const note = decision.status === 'PROPOSED' && decision.isMine
    ? 'La propuesta espera la revisión de una cuenta distinta.' : statusDescriptions[decision.status];
  const reviewReason = reason.trim();

  async function mutate(kind: Mutation, apply: () => Promise<DecisionsResult<Decision> | undefined>) {
    if (lock.current) return;
    lock.current = true;
    setAction(kind);
    setFailure(undefined);
    setNotify('');
    try {
      const result = await apply();
      if (result?.ok) {
        setLoad({ state: 'ready', data: result.data });
        setReason('');
        setConfirmCreate(false);
        setNotify(kind === 'reconcile' && result.data.status === 'RECONCILIATION_REQUIRED'
          ? 'La búsqueda sigue sin confirmar una incidencia. La conciliación permanece pendiente.'
          : `Propuesta actualizada. ${statusLabels[result.data.status]}.`);
      } else if (result) {
        const problem = failureOf(result);
        if (['AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(problem.code)) {
          setLoad({ state: 'error', failure: problem });
        } else {
          setFailure(problem);
          if (kind === 'execute' || kind === 'reconcile' || problem.code === 'CONFLICT' || problem.retryable) {
            setRefreshRequired(true);
            setConfirmCreate(false);
          }
        }
      } else {
        setFailure(unavailable);
        setRefreshRequired(true);
        setConfirmCreate(false);
      }
    } catch {
      setFailure(unavailable);
      setRefreshRequired(true);
      setConfirmCreate(false);
    } finally {
      lock.current = false;
      setAction(undefined);
    }
  }

  const reference: DecisionReference = {
    decisionId: decision.id, expectedRevision: decision.revision, expectedHash: decision.hash, confirmed: true,
  };

  return <div className="dec-card">
    <div className="dec-detail-heading">
      <div><h2>{decision.summary}</h2><Status status={decision.status} /></div>
      <button type="button" className="dec-secondary" disabled={busy} onClick={update}>Actualizar propuesta</button>
    </div>
    {note && <p className="dec-status-note" data-status={decision.status}>{note}</p>}
    <dl className="dec-facts dec-target">
      <div><dt>Proyecto de destino</dt><dd>{decision.target.projectKey}</dd></div>
      <div><dt>Tipo de incidencia en Jira</dt><dd><code>{decision.target.issueTypeId}</code></dd></div>
      <div><dt>Revisión</dt><dd>{decision.revision}</dd></div>
      <div><dt>Huella del contenido</dt><dd><code>{decision.hash}</code></dd></div>
      {decision.expiresAt && <div><dt>Vigencia hasta</dt><dd><DateValue value={decision.expiresAt} /></dd></div>}
    </dl>
    <div className="dec-description"><h3>Descripción para Jira</h3><p>{decision.description}</p></div>
    <Evidence evidence={decision.evidence} onOpenRun={onOpenRun} />
    <Timeline decision={decision} />
    {decision.status === 'APPLIED' && decision.issueKey && <p className="dec-applied">
      <strong>Incidencia confirmada en Jira</strong> <JiraLink issueKey={decision.issueKey} />
    </p>}
    {decision.errorCode && <p className="dec-muted">Código del último intento <code>{decision.errorCode}</code></p>}
    <p className="dec-notice" role="status">{notify}</p>
    {failure && <Problem failure={failure} />}
    {refreshRequired && <p className="dec-muted">Actualizá la propuesta antes de volver a solicitar una acción.</p>}
    {canReview && <fieldset className="dec-review" disabled={busy}>
      <legend>Revisar propuesta · Revisión {decision.revision}</legend>
      <label className="dec-field">Motivo de aprobación o rechazo
        <textarea required rows={3} maxLength={reviewMax} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="dec-actions">
        <button type="button" disabled={!reviewReason} onClick={() => void mutate('approve', () =>
          invoke(DECISIONS_APPROVE, { ...reference, reason: reviewReason }))}>
          {action === 'approve' ? 'Registrando aprobación…' : 'Aprobar propuesta'}
        </button>
        <button type="button" className="dec-secondary" disabled={!reviewReason} onClick={() => void mutate('reject', () =>
          invoke(DECISIONS_REJECT, { ...reference, reason: reviewReason }))}>
          {action === 'reject' ? 'Registrando rechazo…' : 'Rechazar propuesta'}
        </button>
      </div>
    </fieldset>}
    {canExecute && (confirmCreate ? <div className="dec-confirm" aria-labelledby="dec-confirm-title">
      <h3 id="dec-confirm-title" ref={confirmHeading} tabIndex={-1}>Confirmar creación en Jira</h3>
      <p>Jira recibirá la revisión {decision.revision} aprobada para {decision.target.projectKey} con tu cuenta.</p>
      <div className="dec-actions">
        <button type="button" disabled={busy} onClick={() => void mutate('execute', () => invoke(DECISIONS_EXECUTE, reference))}>
          {action === 'execute' ? 'Solicitando creación…' : 'Confirmar creación de incidencia'}
        </button>
        <button type="button" className="dec-secondary" disabled={busy} onClick={() => setConfirmCreate(false)}>Volver</button>
      </div>
    </div> : <div className="dec-actions">
      <button type="button" disabled={busy} onClick={() => setConfirmCreate(true)}>
        {decision.status === 'FAILED' ? 'Preparar reintento' : 'Preparar creación en Jira'}
      </button>
    </div>)}
    {canReconcile && <div className="dec-actions">
      <button type="button" disabled={busy} onClick={() => void mutate('reconcile', () => invoke(DECISIONS_RECONCILE, reference))}>
        {action === 'reconcile' ? 'Buscando en Jira…' : 'Buscar incidencia en Jira'}
      </button>
    </div>}
  </div>;
}

export function DecisionsDashboard({ decisionId, runId, onOpen, onBack, onOpenRun }: Props) {
  const heading = useId();
  return <section className="connection dec-dashboard" aria-labelledby={heading}>
    <header className="dec-header">
      <h1 id={heading}>{runId && !decisionId ? 'Preparar propuesta' : 'Decisiones'}</h1>
      {(decisionId || runId) && <button type="button" className="dec-secondary" onClick={onBack}>Volver a la bandeja</button>}
    </header>
    {decisionId ? <DecisionDetail decisionId={decisionId} onOpenRun={onOpenRun} key={decisionId} />
      : runId ? <Prepare runId={runId} onOpen={onOpen} onOpenRun={onOpenRun} key={runId} />
        : <Inbox onOpen={onOpen} />}
  </section>;
}

import { makeInvoke, router } from '@forge/bridge';
import { useEffect, useState, type FormEvent } from 'react';
import {
  OVERVIEW_ALERT, OVERVIEW_GET, type Overview, type OverviewAlert, type OverviewAlertDetail,
  type OverviewErrorCode, type OverviewFilters, type OverviewMetric, type OverviewResult, type OverviewSource,
} from '../../../src/shared/overview';
import './overview.css';

const invoke = makeInvoke<{
  [OVERVIEW_GET]: (filters: OverviewFilters) => OverviewResult<Overview> | undefined;
  [OVERVIEW_ALERT]: (input: OverviewFilters & { code: 'A-17' }) => OverviewResult<OverviewAlertDetail> | undefined;
}>();

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; code: OverviewErrorCode; message: string; requestId?: string };

const loading = { status: 'loading' } as const;
const unavailable = {
  status: 'error',
  code: 'UNAVAILABLE',
  message: 'No se pudo conectar con Control Tower X. Volvé a intentar.',
} as const;

function loaded<T>(response: OverviewResult<T> | undefined): LoadState<T> {
  if (!response) return unavailable;
  return response.ok
    ? { status: 'ready', data: response.data }
    : { status: 'error', ...response.error, requestId: response.requestId };
}

const sourceNames = { JIRA: 'Jira', FORGE: 'Forge' };
const sourceStates = { READY: 'Disponible', PARTIAL: 'Parcial', UNAVAILABLE: 'No disponible' };
const issueKeyPattern = /^[A-Z][A-Z0-9_]{0,39}-[1-9][0-9]{0,31}$/;
const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 1 });
const civilDate = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});
const localTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
});

function DateValue({ value }: { value: string | null }) {
  if (!value) return 'Sin fecha disponible';
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(civil ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime()) || (civil && date.toISOString().slice(0, 10) !== value)) {
    return 'Sin fecha disponible';
  }
  return <time dateTime={value}>{(civil ? civilDate : localTime).format(date)}</time>;
}

function metricValue(metric: OverviewMetric, currency: string) {
  if (metric.value === null || !Number.isFinite(metric.value)) {
    return metric.denominator === 0 ? 'Sin base de cálculo' : 'Sin datos';
  }
  if (metric.unit === 'percent') return percent.format(metric.value / 100);
  if (metric.unit === 'cents') {
    const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'XXX';
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: safeCurrency, currencyDisplay: 'code',
    }).format(metric.value / 100);
  }
  return number.format(metric.value);
}

function stateLabel(state: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Operativa',
    AVAILABLE: 'Disponible',
    MAINTENANCE: 'En mantenimiento',
    UNAVAILABLE: 'No disponible',
    INACTIVE: 'Inactiva',
    AT_RISK: 'En riesgo',
    PLANNED: 'Planificada',
  };
  return Object.hasOwn(labels, state) ? labels[state] : 'Sin estado clasificado';
}

function JiraButton({ issueKey }: { issueKey: string }) {
  const [failed, setFailed] = useState(false);
  if (!issueKeyPattern.test(issueKey)) return null;
  return (
    <span className="ov-jira-link">
      <button type="button" className="ov-text-button" aria-label={`Abrir ${issueKey} en Jira en otra pestaña`}
        onClick={() => {
          setFailed(false);
          void router.open(`/browse/${encodeURIComponent(issueKey)}`).catch(() => setFailed(true));
        }}>
        {issueKey} <span aria-hidden="true">↗</span>
      </button>
      {failed && <span role="status" className="ov-inline-error">No se pudo abrir Jira.</span>}
    </span>
  );
}

function Problem({ state, retry }: { state: Extract<LoadState<unknown>, { status: 'error' }>; retry(): void }) {
  const denied = state.code === 'FORBIDDEN' || state.code === 'AUTH_REQUIRED';
  const title = denied ? 'Acceso a Overview' : state.code === 'NOT_READY' ? 'Overview aún no está disponible' : 'No se pudo cargar la vista';
  return (
    <div className="ov-message">
      <div role="alert">
        <strong>{title}</strong>
        <p>{state.message}</p>
        {state.requestId && <p className="ov-note">Referencia de soporte <code>{state.requestId}</code></p>}
      </div>
      {(state.code === 'NOT_READY' || state.code === 'UNAVAILABLE') &&
        <button type="button" className="ov-secondary" onClick={retry}>Reintentar</button>}
    </div>
  );
}

function MetricCard({ metric, currency }: { metric: OverviewMetric; currency: string }) {
  const available = metric.value !== null && Number.isFinite(metric.value);
  return (
    <details className="ov-metric" data-metric={metric.id}>
      <summary aria-label={`${metric.title}, ${metricValue(metric, currency)}. Ver desglose`}>
        <span className="ov-metric-name">{metric.title}</span>
        <strong className="ov-metric-value" data-unavailable={!available}>{metricValue(metric, currency)}</strong>
        {metric.numerator !== null && metric.denominator !== null && metric.denominator > 0 &&
          <span className="ov-metric-base">{number.format(metric.numerator)} de {number.format(metric.denominator)}</span>}
        {available && metric.unit === 'percent' && metric.value !== null &&
          <progress className="ov-progress" aria-label={metric.title} max={100} value={Math.min(100, Math.max(0, metric.value))} />}
      </summary>
      <div className="ov-metric-detail">
        <p>{metric.detail}</p>
        <dl className="ov-metric-origin">
          <div><dt>Fuente</dt><dd>{sourceNames[metric.source]}</dd></div>
          <div><dt>Cobertura</dt><dd>{metric.coverage === null ? 'Sin dato' : percent.format(metric.coverage)}</dd></div>
        </dl>
        {!!metric.evidence.length && <ul className="ov-evidence">
          {metric.evidence.map((item, index) => (
            <li key={`${item.label}-${item.issueKey ?? index}`}>
              <span><strong>{item.label}</strong><span>{item.value}</span></span>
              {item.issueKey && <JiraButton issueKey={item.issueKey} />}
            </li>
          ))}
        </ul>}
      </div>
    </details>
  );
}

function AlertDetail({ filters, id }: { filters: OverviewFilters; id: string }) {
  const [load, setLoad] = useState<LoadState<OverviewAlertDetail>>(loading);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void invoke(OVERVIEW_ALERT, { ...filters, code: 'A-17' }).then(
      (response) => { if (active) setLoad(loaded(response)); },
      () => { if (active) setLoad(unavailable); },
    );
    return () => { active = false; };
  }, [filters, attempt]);

  return (
    <section className="ov-alert-detail" id={id} aria-labelledby={`${id}-heading`} aria-busy={load.status === 'loading'}>
      <h4 id={`${id}-heading`}>Cadena de impacto</h4>
      {load.status === 'loading' && <p role="status">Consultando los datos vinculados a A-17…</p>}
      {load.status === 'error' && <Problem state={load} retry={() => {
        setLoad(loading);
        setAttempt((value) => value + 1);
      }} />}
      {load.status === 'ready' && (
        <>
          <div className="ov-impact">
            <div className="ov-impact-item">
              <h5>Equipo</h5>
              {load.data.asset ? <>
                <strong>{load.data.asset.name}</strong>
                <p>{load.data.asset.code} · {stateLabel(load.data.asset.status)}</p>
                {load.data.asset.nextAvailableDate && <p>Disponibilidad prevista <DateValue value={load.data.asset.nextAvailableDate} /></p>}
              </> : <p>Sin equipo disponible para este corte.</p>}
            </div>
            <div className="ov-impact-item">
              <h5>Contratista</h5>
              {load.data.contractor ? <>
                <strong>{load.data.contractor.name}</strong><p>{load.data.contractor.code}</p>
              </> : <p>Sin datos del contratista para este corte.</p>}
            </div>
          </div>
          <h5>Trabajo vinculado</h5>
          {load.data.work.length ? <ul className="ov-evidence ov-work-list">
            {load.data.work.map((work) => (
              <li key={work.code}><span><strong>{work.code}</strong><span>{work.title}</span></span>
                <JiraButton issueKey={work.issueKey} /></li>
            ))}
          </ul> : <p>Sin ítems de trabajo visibles.</p>}
          {load.data.simulationInput && <div className="ov-handoff">
            <div>
              <h5>Insumo para Futuros</h5>
              <p>Escenario {load.data.simulationInput.scenarioCode} · Retraso de suministro</p>
              <p className="ov-note">Corte <DateValue value={load.data.simulationInput.snapshotAsOf} /></p>
            </div>
            <strong>{number.format(load.data.simulationInput.value)} días</strong>
          </div>}
        </>
      )}
    </section>
  );
}

function AlertCard({ alert, filters, onOpenLogistics }: {
  alert: OverviewAlert; filters: OverviewFilters; onOpenLogistics?: (code: OverviewAlert['code']) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = `ov-alert-${alert.code}-detail`;
  return (
    <article className="ov-alert">
      <div className="ov-alert-main">
        <div className="ov-alert-sign" aria-hidden="true">!</div>
        <div className="ov-alert-copy">
          <p className="ov-alert-meta"><strong>{alert.code}</strong><span>Prioridad alta</span></p>
          <h3>{alert.title}</h3>
          <p>Original <DateValue value={alert.baselineEta} /> <span aria-hidden="true">→</span>{' '}
            <span className="ov-sr-only">,</span> Estimada <DateValue value={alert.currentEta} /></p>
        </div>
        <div className="ov-alert-action">
          <strong>{number.format(alert.delayDays)} días de atraso</strong>
          <button type="button" className="ov-secondary" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined}
            onClick={() => setExpanded(!expanded)}>{expanded ? 'Ocultar cadena' : 'Ver cadena de impacto'}</button>
        </div>
      </div>
      {expanded && <>
        <AlertDetail id={detailId} filters={filters} />
        {onOpenLogistics && <button type="button" className="ov-secondary"
          onClick={() => onOpenLogistics(alert.code)}>Abrir A-17 en Logística</button>}
      </>}
    </article>
  );
}

function Facilities({ points }: { points: Overview['map'] }) {
  const locations = points.map((point) => ({
    ...point,
    position: Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
      ? { column: Math.min(10, Math.floor(point.x * 10) + 1), row: Math.min(8, Math.floor(point.y * 8) + 1) }
      : null,
  }));
  const hasPositions = locations.some(({ position }) => position !== null);
  return (
    <section className="ov-panel" aria-labelledby="ov-facilities">
      <h2 id="ov-facilities">Instalaciones</h2>
      {points.length ? (
        <>
          <p className="ov-note">{hasPositions ? 'Mapa esquemático de ubicaciones sintéticas' : 'Ubicaciones sintéticas del proyecto'}</p>
          {hasPositions && (
            <div className="ov-map" aria-hidden="true">
              {locations.map((point) => point.position && (
                <span className="ov-map-marker" key={point.code} data-column={point.position.column}
                  data-row={point.position.row} data-state={point.status}>{point.code}</span>
              ))}
            </div>
          )}
          <div className="ov-table-scroll">
            <table className="ov-table">
              <caption className="ov-sr-only">Instalaciones representadas en el mapa esquemático</caption>
              <thead><tr><th scope="col">Código</th><th scope="col">Instalación</th><th scope="col">Estado</th>
                {hasPositions && <th scope="col">Posición</th>}</tr></thead>
              <tbody>{locations.map((point) => (
                <tr key={point.code}><th scope="row">{point.code}</th><td>{point.name}</td><td>{stateLabel(point.status)}</td>
                  {hasPositions && <td>{point.position ? `Fila ${point.position.row}, columna ${point.position.column}` : 'Sin posición'}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      ) : <p className="ov-note">Sin instalaciones para estos filtros.</p>}
    </section>
  );
}

function Sources({ sources }: { sources: OverviewSource[] }) {
  return (
    <section className="ov-panel ov-source-panel" aria-labelledby="ov-sources">
      <h2 id="ov-sources">Estado de las fuentes</h2>
      {sources.length ? <ul className="ov-sources">
        {sources.map((source) => (
          <li key={source.source}>
            <div className="ov-source-title">
              <strong>{sourceNames[source.source]}</strong>
              <span className="ov-source-state" data-state={source.state}>{sourceStates[source.state]}</span>
            </div>
            <p>{source.detail}</p>
            <p className="ov-note"><DateValue value={source.observedAt} /></p>
          </li>
        ))}
      </ul> : <p className="ov-note">Sin información de origen.</p>}
    </section>
  );
}

export function OverviewDashboard({ onOpenLogistics }: {
  onOpenLogistics?: (code: OverviewAlert['code']) => void;
}) {
  const [load, setLoad] = useState<LoadState<Overview>>(loading);
  const [phases, setPhases] = useState<Overview['phases']>([]);
  const [draftPhase, setDraftPhase] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [request, setRequest] = useState<{ filters: OverviewFilters }>({ filters: {} });

  useEffect(() => {
    let active = true;
    void invoke(OVERVIEW_GET, request.filters).then(
      (response) => {
        if (!active) return;
        const next = loaded(response);
        if (next.status === 'ready') setPhases(next.data.phases);
        if (next.status === 'error' && (next.code === 'FORBIDDEN' || next.code === 'AUTH_REQUIRED')) setPhases([]);
        setLoad(next);
      },
      () => { if (active) setLoad(unavailable); },
    );
    return () => { active = false; };
  }, [request]);

  function refresh(filters: OverviewFilters) {
    setLoad(loading);
    setRequest({ filters });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    refresh({ ...(draftPhase ? { phaseCode: draftPhase } : {}), ...(draftDate ? { asOf: draftDate } : {}) });
  }

  const overview = load.status === 'ready' ? load.data : null;
  const blocked = load.status === 'error' && (load.code === 'FORBIDDEN' || load.code === 'AUTH_REQUIRED');
  const filtersUnchanged = draftPhase === (request.filters.phaseCode ?? '') && draftDate === (request.filters.asOf ?? '');
  const sourceCoverage = overview?.sources.some((source) => source.state !== 'READY')
    ? overview.sources.every((source) => source.state === 'UNAVAILABLE') ? 'No hay fuentes disponibles.' : 'Cobertura parcial.'
    : null;
  return (
    <section className="ov-dashboard" aria-labelledby="ov-title">
      <header className="ov-hero">
        <div className="ov-hero-main">
          <p className="ov-kicker">Vista general</p>
          <h1 id="ov-title">{overview?.project.name ?? 'Control del proyecto'}</h1>
          {overview && <p className="ov-project">{overview.project.key} <span>·</span> Proyecto Jira</p>}
        </div>
        {overview && <dl className="ov-hero-cutoff">
          <div><dt>Fecha de corte</dt><dd><DateValue value={overview.asOf} /></dd></div>
          <div><dt>Snapshot</dt><dd><DateValue value={overview.snapshot?.asOf ?? null} /></dd></div>
        </dl>}
      </header>

      {!blocked && <form className="ov-toolbar" onSubmit={submit} aria-label="Filtros de Overview">
        <label>Fase<select value={draftPhase} onChange={(event) => setDraftPhase(event.target.value)}>
          <option value="">Todas las fases</option>
          {draftPhase && !phases.some((phase) => phase.code === draftPhase) && <option value={draftPhase}>{draftPhase}</option>}
          {phases.map((phase) => <option value={phase.code} key={phase.code}>{phase.name}</option>)}
        </select></label>
        <label>Fecha de corte<input type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} /></label>
        <div className="ov-toolbar-actions">
          <button type="submit" className="ov-primary" disabled={load.status === 'loading'}>
            {filtersUnchanged ? 'Actualizar vista' : 'Aplicar filtros'}
          </button>
          <button type="button" className="ov-secondary" disabled={load.status === 'loading' || (!draftPhase && !draftDate &&
              !request.filters.phaseCode && !request.filters.asOf)}
            onClick={() => { setDraftPhase(''); setDraftDate(''); refresh({}); }}>Restablecer</button>
        </div>
      </form>}

      <div className="ov-sr-only" role="status">
        {load.status === 'loading' ? 'Cargando el estado del proyecto…' : overview ? 'Vista actualizada.' : ''}
      </div>
      <div className="ov-results" data-state={load.status} aria-busy={load.status === 'loading'}>
        {load.status === 'loading' && <div className="ov-loading"><p aria-hidden="true">Cargando el estado del proyecto…</p>
          <div aria-hidden="true"><span /><span /><span /></div></div>}
        {load.status === 'error' && <Problem state={load} retry={() => refresh(request.filters)} />}
        {overview && <>
          {sourceCoverage &&
            <p className="ov-coverage" role="status">{sourceCoverage} El estado de cada fuente figura al pie de la vista.</p>}
          {!!overview.alerts.length && <section aria-labelledby="ov-alerts">
            <h2 className="ov-section-title" id="ov-alerts">Alertas prioritarias</h2>
            {overview.alerts.map((alert) => <AlertCard alert={alert} filters={request.filters}
              onOpenLogistics={onOpenLogistics} key={alert.code} />)}
          </section>}
          <section aria-labelledby="ov-indicators">
            <h2 className="ov-section-title" id="ov-indicators">Indicadores</h2>
            {overview.metrics.length ? <div className="ov-metrics">
              {overview.metrics.map((metric) => <MetricCard metric={metric} currency={overview.project.currency} key={metric.id} />)}
            </div> : <div className="ov-message"><p>Sin registros para los filtros elegidos.</p></div>}
          </section>
          <div className="ov-bottom">
            <Facilities points={overview.map} />
            <Sources sources={overview.sources} />
          </div>
        </>}
      </div>
    </section>
  );
}

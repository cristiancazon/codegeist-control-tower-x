import { makeInvoke, router } from '@forge/bridge';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  OPERATIONS_DETAIL, OPERATIONS_LIST, operationsSections, type OperationsDetail, type OperationsField,
  type OperationsFilters, type OperationsPage, type OperationsResult, type OperationsSection, type OperationsSource,
  type OperationsTarget,
} from '../../../src/shared/operations';
import type { OverviewErrorCode } from '../../../src/shared/overview';
import './operations.css';

const invoke = makeInvoke<{
  [OPERATIONS_LIST]: (input: { section: OperationsSection } & OperationsFilters) => OperationsResult<OperationsPage> | undefined;
  [OPERATIONS_DETAIL]: (target: OperationsTarget) => OperationsResult<OperationsDetail> | undefined;
}>();

const sections: Record<OperationsSection, { tab: string; title: string }> = {
  work: { tab: 'Proyectos', title: 'Paquetes de trabajo' },
  operations: { tab: 'Operaciones', title: 'Instalaciones y operaciones' },
  assets: { tab: 'Activos', title: 'Activos y equipos' },
  contractors: { tab: 'Contratistas', title: 'Contratistas y proveedores' },
  logistics: { tab: 'Logística', title: 'Envíos y suministros' },
  hse: { tab: 'HSE', title: 'Salud, seguridad y ambiente' },
  financial: { tab: 'Finanzas', title: 'Costos del proyecto' },
  knowledge: { tab: 'Conocimiento', title: 'Documentación y conocimiento' },
};
const sourceNames: Record<OperationsSource['source'], string> = {
  JIRA: 'Jira', FORGE: 'Forge', ASSETS: 'Assets', JSM: 'Jira Service Management', CONFLUENCE: 'Confluence',
};
const sourceStates: Record<OperationsSource['state'], string> = {
  READY: 'Disponible', PARTIAL: 'Parcial', UNAVAILABLE: 'No disponible', DISABLED: 'Sin habilitar',
};
const dateLabels: Partial<Record<OperationsSection, string>> = {
  work: 'Vencimiento Jira', logistics: 'Llegada estimada', hse: 'Fecha del incidente', financial: 'Fecha de costo',
};
const issueKeyPattern = /^[A-Z][A-Z0-9_]{0,39}-[1-9][0-9]{0,31}$/;
const number = new Intl.NumberFormat('es-AR');
const civilDate = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});
const localTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
});

type Failed = { status: 'error'; code: OverviewErrorCode; message: string; requestId?: string };
type ReadState<T> = { status: 'loading' } | { status: 'ready'; data: T } | Failed;
type Read<T> = () => Promise<OperationsResult<T> | undefined>;

const loading = { status: 'loading' } as const;
const disconnected: Failed = {
  status: 'error', code: 'UNAVAILABLE', message: 'No se pudo conectar con Control Tower X.',
};

function useOperationRead<T>(read: Read<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ read: Read<T>; attempt: number; state: ReadState<T> }>();

  useEffect(() => {
    let current = true;
    const finish = (state: ReadState<T>) => {
      if (current) setResult({ read, attempt, state });
    };
    void read().then((response) => {
      if (!response) finish(disconnected);
      else if (response.ok) finish({ status: 'ready', data: response.data });
      else finish({ status: 'error', ...response.error, requestId: response.requestId });
    }, () => finish(disconnected));
    return () => { current = false; };
  }, [read, attempt]);

  return {
    state: result?.read === read && result.attempt === attempt ? result.state : loading,
    retry: () => setAttempt((value) => value + 1),
  };
}

function DateValue({ value }: { value: string | null }) {
  if (!value) return 'Sin fecha disponible';
  const calendarDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(calendarDay ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime()) || (calendarDay && date.toISOString().slice(0, 10) !== value)) {
    return 'Sin fecha disponible';
  }
  return <time dateTime={value}>{(calendarDay ? civilDate : localTime).format(date)}</time>;
}

function Problem({ failure, retry, section }: { failure: Failed; retry(): void; section: OperationsSection }) {
  const denied = failure.code === 'AUTH_REQUIRED' || failure.code === 'FORBIDDEN';
  const restricted = denied && section === 'hse';
  return (
    <div className="ops-message" data-state={denied ? 'denied' : 'error'}>
      <div role="alert">
        <strong>{denied ? 'Acceso restringido' : failure.code === 'NOT_READY' ? 'Vista sin preparar' : 'No se pudo completar la consulta'}</strong>
        <p>{restricted ? 'Tu cuenta no tiene acceso a esta vista.' : failure.message}</p>
        {failure.requestId && <p className="ops-muted">Referencia de soporte <code>{failure.requestId}</code></p>}
      </div>
      {(failure.code === 'NOT_READY' || failure.code === 'UNAVAILABLE') &&
        <button className="ops-secondary" type="button" onClick={retry}>Reintentar</button>}
    </div>
  );
}

function JiraButton({ issueKey, label }: { issueKey: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  if (!issueKeyPattern.test(issueKey)) return null;

  return (
    <span className="ops-jira">
      <button className="ops-link" type="button" aria-label={`Abrir ${issueKey} en Jira en otra pestaña`} onClick={() => {
        setFailed(false);
        void router.open(`/browse/${encodeURIComponent(issueKey)}`).catch(() => setFailed(true));
      }}>{label ?? issueKey} <span aria-hidden="true">↗</span></button>
      {failed && <span className="ops-inline-error" role="status">No se pudo abrir Jira.</span>}
    </span>
  );
}

function Sources({ sources }: { sources: readonly OperationsSource[] }) {
  return (
    <section className="ops-sources" aria-label="Estado de las fuentes">
      <h3>Estado de las fuentes</h3>
      {sources.length ? <ul>
        {sources.map((source) => (
          <li key={source.source} data-source={source.source} data-state={source.state}>
            <div className="ops-source-title">
              <strong>{sourceNames[source.source]}</strong>
              <span className="ops-source-state" data-state={source.state}>{sourceStates[source.state]}</span>
              {source.quality &&
                <span className="ops-quality">{source.quality === 'SYNTHETIC' ? 'Datos sintéticos' : 'Datos del origen'}</span>}
            </div>
            {source.detail && <p>{source.detail}</p>}
            <p className="ops-muted"><DateValue value={source.observedAt} /></p>
          </li>
        ))}
      </ul> : <p className="ops-muted">Sin información de origen.</p>}
    </section>
  );
}

function Fields({ fields }: { fields: readonly OperationsField[] }) {
  if (!fields.length) return null;
  return <dl className="ops-fields">{fields.map(({ label, value }, index) => (
    <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value ?? 'Sin dato'}</dd></div>
  ))}</dl>;
}

function Notes({ notes }: { notes?: readonly string[] }) {
  if (!notes?.length) return null;
  return <ul className="ops-notes">{notes.map((note, index) => <li key={`${note}-${index}`}>{note}</li>)}</ul>;
}

function ListFilters({ section, facets, initial, update }: {
  section: OperationsSection;
  facets: NonNullable<OperationsPage['facets']>;
  initial: OperationsFilters;
  update(filters: OperationsFilters): void;
}) {
  const [draft, setDraft] = useState(initial);
  const dateLabel = dateLabels[section];
  const activeFilters = [draft, initial].some((filters) => Object.entries(filters).some(([name, value]) => name !== 'page' && !!value));

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters: OperationsFilters = { ...Object.fromEntries(Object.entries(draft).filter(([, value]) => !!value)), page: 1 };
    const q = filters.q?.trim();
    if (q) filters.q = q;
    else delete filters.q;
    update(filters);
  }

  return (
    <form className="ops-filters" onSubmit={apply} aria-label="Filtros del listado">
      <label className="ops-search">
        Buscar
        <input type="search" name="q" maxLength={80} value={draft.q ?? ''} placeholder="Código o nombre"
          onChange={(event) => setDraft((value) => ({ ...value, q: event.target.value || undefined }))} />
      </label>
      {facets.map((facet) => {
        const selected = draft[facet.name];
        return <label key={facet.name}>{facet.label}
          <select name={facet.name} value={selected ?? ''}
            onChange={(event) => setDraft((value) => ({ ...value, [facet.name]: event.target.value || undefined }))}>
            <option value="">Todas las opciones</option>
            {selected && !facet.options.some(({ value }) => value === selected) && <option value={selected}>{selected}</option>}
            {facet.options.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>;
      })}
      {dateLabel && <>
        <label>{dateLabel} desde
          <input type="date" name="from" max={draft.to} value={draft.from ?? ''}
            onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value || undefined }))} />
        </label>
        <label>Hasta
          <input type="date" name="to" aria-label={`${dateLabel} hasta`} min={draft.from} value={draft.to ?? ''}
            onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value || undefined }))} />
        </label>
      </>}
      {section === 'work' && <label className="ops-check">
        <input type="checkbox" name="overdueOnly" checked={draft.overdueOnly === true}
          onChange={(event) => setDraft((value) => ({ ...value, overdueOnly: event.target.checked || undefined }))} />
        Solo vencidos
      </label>}
      <div className="ops-filter-actions">
        <button className="ops-primary" type="submit">Aplicar filtros</button>
        <button className="ops-secondary" type="button" disabled={!activeFilters} onClick={() => {
          setDraft({});
          update({});
        }}>Limpiar</button>
      </div>
    </form>
  );
}

function EmptyList({ sources, retry }: { sources: readonly OperationsSource[]; retry(): void }) {
  const hasDataSource = sources.some(({ state }) => state === 'READY' || state === 'PARTIAL');
  const allDisabled = sources.length > 0 && sources.every(({ state }) => state === 'DISABLED');
  const incomplete = sources.some(({ state }) => state === 'PARTIAL' || state === 'UNAVAILABLE');
  const title = allDisabled ? 'Conector sin habilitar' : !hasDataSource ? 'Fuente no disponible'
    : incomplete ? 'Sin resultados en las fuentes disponibles' : 'Sin resultados';
  const message = !hasDataSource ? 'Consultá el estado de las fuentes para conocer la cobertura de esta vista.'
    : 'Probá con otra búsqueda o ajustá los filtros.';
  return <div className="ops-message" data-state={hasDataSource ? 'empty' : 'source-missing'}>
    <strong>{title}</strong><p>{message}</p>
    {!hasDataSource && !allDisabled && <button className="ops-secondary" type="button" onClick={retry}>Actualizar listado</button>}
  </div>;
}

function RecordsTable({ data, open }: { data: OperationsPage; open(code: string): void }) {
  const jira = data.rows.some(({ issueKey }) => issueKey !== undefined && issueKeyPattern.test(issueKey));

  return (
    <div className="ops-table-scroll" tabIndex={0} role="region" aria-label="Tabla de registros">
      <table className="ops-table">
        <thead><tr><th scope="col">Código</th>
          {data.columns.map((column, index) => <th scope="col" key={`${column}-${index}`}>{column}</th>)}
          {jira && <th scope="col">Jira</th>}
        </tr></thead>
        <tbody>{data.rows.map((row) => (
          <tr key={row.code} data-code={row.code}>
            <th scope="row"><button type="button" className="ops-link" aria-label={`Ver ${row.code}`} onClick={() => open(row.code)}>
              {row.code}
            </button></th>
            {data.columns.map((column, index) => <td key={`${column}-${index}`}>{row.cells[index] ?? 'Sin dato'}</td>)}
            {jira && <td>{row.issueKey && <JiraButton issueKey={row.issueKey} />}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function RecordsList({ section, filters, update, open, focusHeading }: {
  section: OperationsSection; filters: OperationsFilters; update(filters: OperationsFilters): void;
  open(code: string): void; focusHeading: boolean;
}) {
  const read = useCallback(() => invoke(OPERATIONS_LIST, { ...filters, section }), [section, filters]);
  const { state, retry } = useOperationRead(read);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  function applyFilters(next: OperationsFilters) {
    heading.current?.focus();
    update(next);
  }

  const data = state.status === 'ready' ? state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canFilter = data?.sources.some(({ state }) => state === 'READY' || state === 'PARTIAL');
  const degradedSources = data?.sources.filter(({ state }) => state === 'PARTIAL' || state === 'UNAVAILABLE') ?? [];
  return (
    <>
      <header className="ops-section-header">
        <h2 id="ops-records-heading" ref={heading} tabIndex={-1}>{sections[section].title}</h2>
        {data && <div className="ops-context">
          <span>{data.project.name} <strong>{data.project.key}</strong></span>
          <span>Corte <DateValue value={data.asOf} /></span>
        </div>}
      </header>
      <p className="ops-sr-only" role="status">{state.status === 'loading' ? 'Cargando el listado…' : data ? 'Listado actualizado.' : ''}</p>
      <div id="ops-results" data-state={state.status} aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p className="ops-message" aria-hidden="true">Cargando el listado…</p>}
        {state.status === 'error' && <Problem failure={state} retry={retry} section={section} />}
        {data && <>
          {canFilter && !!degradedSources.length && <p className="ops-coverage" role="status">
            <strong>Cobertura parcial</strong>{' '}
            {degradedSources.map(({ source, state }) => `${sourceNames[source]} (${sourceStates[state].toLocaleLowerCase('es-AR')})`).join(', ')}
          </p>}
          {canFilter && <ListFilters section={section} facets={data.facets ?? []} initial={filters} update={applyFilters} />}
          {data.highlights && data.highlights.length > 0 && <div className="ops-highlights"><Fields fields={data.highlights} /></div>}
          <Notes notes={data.notes} />
          {data.rows.length ? <RecordsTable data={data} open={open} /> : <EmptyList sources={data.sources} retry={retry} />}
          {(pages > 1 || data.page > 1) && (
            <nav className="ops-pagination" aria-label="Paginación del listado">
              <button className="ops-secondary" type="button" disabled={data.page <= 1}
                onClick={() => applyFilters({ ...filters, page: data.page - 1 })}>Anterior</button>
              <span>Página {number.format(data.page)} de {number.format(pages)}</span>
              <button className="ops-secondary" type="button" disabled={data.page >= pages}
                onClick={() => applyFilters({ ...filters, page: data.page + 1 })}>Siguiente</button>
            </nav>
          )}
          {section !== 'hse' && data.rows.length > 0 &&
            <p className="ops-result-count">{number.format(data.total)} {data.total === 1 ? 'registro' : 'registros'}</p>}
          <Sources sources={data.sources} />
        </>}
      </div>
    </>
  );
}

function RecordDetail({ section, code, close, open }: {
  section: OperationsSection; code: string; close(): void; open(target: OperationsTarget): void;
}) {
  const read = useCallback(() => invoke(OPERATIONS_DETAIL, { section, code }), [section, code]);
  const { state, retry } = useOperationRead(read);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, [section, code]);

  const detail = state.status === 'ready' ? state.data : null;
  return (
    <section className="ops-record" id="ops-detail" data-state={state.status} aria-labelledby="ops-detail-heading">
      <button className="ops-secondary ops-back" type="button" onClick={close}>
        <span aria-hidden="true">‹</span> Volver al listado
      </button>
      <header className="ops-record-heading">
        {detail && <span className="ops-code">{detail.code}</span>}
        <h2 id="ops-detail-heading" ref={title} tabIndex={-1}>{detail?.title ?? 'Detalle del registro'}</h2>
      </header>
      <p className="ops-sr-only" role="status">{state.status === 'loading' ? 'Cargando el detalle…' : detail ? 'Detalle disponible.' : ''}</p>
      <div aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p className="ops-message" aria-hidden="true">Cargando el detalle…</p>}
        {state.status === 'error' && <Problem failure={state} retry={retry} section={section} />}
        {detail && <>
          <Fields fields={detail.fields} />
          {detail.groups?.map((group, index) => <section className="ops-field-group" key={`${group.label}-${index}`}>
            <h3>{group.label}</h3><Fields fields={group.fields} />
          </section>)}
          <Notes notes={detail.notes} />
          {!!detail.links.length && <section className="ops-related" aria-label="Referencias vinculadas">
            <h3>Referencias vinculadas</h3>
            <ul>{detail.links.map((link, index) => (
              <li key={`${link.label}-${index}`}>{link.kind === 'jira'
                ? <JiraButton issueKey={link.issueKey} label={link.label} />
                : <button className="ops-link" type="button" data-section={link.section} data-code={link.code}
                  onClick={() => open({ section: link.section, code: link.code })}>{link.label}</button>}</li>
            ))}</ul>
          </section>}
          <Sources sources={detail.sources} />
        </>}
      </div>
    </section>
  );
}

function SectionPanel({ section, code, close, open }: {
  section: OperationsSection; code?: string; close(): void; open(target: OperationsTarget): void;
}) {
  const [filters, setFilters] = useState<OperationsFilters>({});
  const [focusList, setFocusList] = useState(false);

  return (
    <div className="ops-section-panel" role="tabpanel" id="ops-section-panel" aria-labelledby={`ops-tab-${section}`}>
      {code ? <RecordDetail section={section} code={code} open={open} close={() => {
        setFocusList(true);
        close();
      }} /> : <RecordsList section={section} filters={filters} update={setFilters} focusHeading={focusList}
        open={(recordCode) => open({ section, code: recordCode })} />}
    </div>
  );
}

type Navigation = { section: OperationsSection; code?: string };

export function OperationsDashboard({ initialTarget }: { initialTarget?: OperationsTarget }) {
  const [navigation, setNavigation] = useState<Navigation>(() => initialTarget ?? { section: 'work' });
  const [tabStop, setTabStop] = useState<OperationsSection>(() => initialTarget?.section ?? 'work');
  const tabs = useRef<HTMLDivElement>(null);
  const initialSection = initialTarget?.section;
  const initialCode = initialTarget?.code;
  useEffect(() => {
    if (initialSection && initialCode) {
      setNavigation({ section: initialSection, code: initialCode });
      setTabStop(initialSection);
    }
  }, [initialSection, initialCode]);

  function goTo(next: Navigation) {
    setTabStop(next.section);
    setNavigation(next);
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = operationsSections.length - 1;
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % operationsSections.length
      : event.key === 'ArrowLeft' ? (index + lastIndex) % operationsSections.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = operationsSections[nextIndex];
    if (next) {
      setTabStop(next);
      tabs.current?.querySelector<HTMLButtonElement>(`#ops-tab-${next}`)?.focus();
    }
  }

  return (
    <section className="ops-dashboard" aria-labelledby="ops-title">
      <header className="ops-hero"><h1 id="ops-title">Operaciones del proyecto</h1></header>
      <div role="tablist" aria-label="Secciones operativas" className="ops-tabs" ref={tabs}>
        {operationsSections.map((section, index) => (
          <button type="button" role="tab" key={section} id={`ops-tab-${section}`}
            aria-selected={navigation.section === section} aria-controls="ops-section-panel"
            tabIndex={tabStop === section ? 0 : -1} onKeyDown={(event) => moveTab(event, index)}
            onClick={() => goTo({ section })}>{sections[section].tab}</button>
        ))}
      </div>
      <SectionPanel key={navigation.section} {...navigation} open={goTo} close={() => goTo({ section: navigation.section })} />
    </section>
  );
}

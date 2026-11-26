import { makeInvoke, rovo } from '@forge/bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FUTUROS_CANCEL, FUTUROS_COMPARE, FUTUROS_CREATE_SCENARIO, FUTUROS_GRANT, FUTUROS_RETRY, FUTUROS_RUN,
  FUTUROS_SCENARIOS, FUTUROS_START, type FuturosCatalog, type FuturosComparison, type FuturosFailure,
  type FuturosResponse, type FuturosRun, type FuturosRunCard, type FuturosScenario, type FuturosScenarioEdit,
  type FuturosStatus,
} from '../../../src/shared/futuros';
import { futurosPollIntervalMs, futurosPollWait } from '../../../src/shared/futuros-poll';
import { FuturosEditor } from './futuros-editor';
import { FuturosComparisonPanel, FuturosResults } from './futuros-results';

const invoke = makeInvoke<{
  [FUTUROS_SCENARIOS]: () => FuturosResponse<FuturosCatalog>;
  [FUTUROS_CREATE_SCENARIO]: (payload: FuturosScenarioEdit) => FuturosResponse<FuturosScenario>;
  [FUTUROS_GRANT]: (payload: { confirmed: true }) => FuturosResponse<{ granted: true }>;
  [FUTUROS_START]: (payload: {
    scenarioId: string; seed: string; sampleCount: number; idempotencyKey: string;
  }) => FuturosResponse<FuturosRun>;
  [FUTUROS_RETRY]: (payload: { runId: string; idempotencyKey: string }) => FuturosResponse<FuturosRun>;
  [FUTUROS_RUN]: (payload: { runId: string }) => FuturosResponse<FuturosRun>;
  [FUTUROS_CANCEL]: (payload: { runId: string }) => FuturosResponse<FuturosRun>;
  [FUTUROS_COMPARE]: (payload: { baselineRunId: string; alternativeRunIds: string[] }) => FuturosResponse<FuturosComparison>;
}>();

const statuses: Record<FuturosStatus, string> = {
  QUEUED: 'En cola', RUNNING: 'En ejecución', SUCCEEDED: 'Resultado publicado',
  FAILED: 'Falló', CANCELED: 'Cancelada',
};
const runErrors: Record<string, string> = {
  RUN_TIMEOUT: 'La corrida superó su plazo.',
  STALE_INPUT: 'La entrada de la corrida ya no está disponible.',
  MODEL_UNAVAILABLE: 'Esta versión del modelo ya no está disponible.',
  RESOURCE_INFEASIBLE: 'Las restricciones de recursos impidieron resolver el cronograma.',
  INSUFFICIENT_DATA: 'Faltan datos para resolver el escenario.',
};
const numeric = new Intl.NumberFormat('es-AR');
const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const defaultSeed = '00000000000000000000000020261125';

type Failure = Extract<FuturosResponse<unknown>, { ok: false }>['error'];
type Props = { focusedRunId?: string; onFocusRun: (runId: string) => void };

async function openAgent(prompt: string) {
  if (!await rovo.isEnabled()) throw new Error('Rovo no está habilitado en este sitio.');
  await rovo.open({ type: 'forge', agentKey: 'control-tower-agent-x', agentName: 'Agent X', prompt });
}

function isActive(status: FuturosStatus) {
  return status === 'QUEUED' || status === 'RUNNING';
}

function uncertain(code: FuturosFailure) {
  return code === 'RATE_LIMITED' || code === 'UNAVAILABLE';
}

function mergeRun(previous: FuturosRun | undefined, next: FuturosRun) {
  if (!previous) return next;
  if (!isActive(previous.status) && isActive(next.status)) return previous;
  if (previous.status === 'RUNNING' && next.status === 'QUEUED') return previous;
  return next.materializedCount < previous.materializedCount && isActive(next.status) ? previous : next;
}

function RunState({ run, detail, focused }: { run: FuturosRunCard; detail?: FuturosRun; focused: boolean }) {
  const count = detail?.materializedCount ?? (run.status === 'SUCCEEDED' ? run.sampleCount : undefined);
  return (
    <div className="futuros-run-state" role={focused ? 'status' : undefined}>
      <strong>{statuses[run.status]}</strong>
      {count !== undefined && <p>{numeric.format(count)} de {numeric.format(run.sampleCount)} muestras</p>}
      {isActive(run.status) && <progress value={count} max={run.sampleCount} aria-label="Muestras procesadas" />}
      {detail?.retryOfId && <p>Reintento con la semilla original</p>}
      {detail?.canRetry && isActive(detail.status) && <p>Plazo vencido.</p>}
      {detail?.errorCode && <p>{runErrors[detail.errorCode] ?? 'La corrida terminó con un error.'} <code>{detail.errorCode}</code></p>}
    </div>
  );
}

export function FuturosRunner({ focusedRunId, onFocusRun }: Props) {
  const [catalog, setCatalog] = useState<FuturosCatalog>();
  const [runs, setRuns] = useState<Record<string, FuturosRun>>({});
  const [unavailableRuns, setUnavailableRuns] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ data?: FuturosComparison; failure?: Failure }>();
  const [comparisonIds, setComparisonIds] = useState<[string, string, string]>();
  const [scenarioId, setScenarioId] = useState('');
  const [sampleCount, setSampleCount] = useState('4000');
  const [seed, setSeed] = useState(defaultSeed);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollNotice, setPollNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [admission, setAdmission] = useState<{ runId: string; elapsedMs: number }>();
  const requestKeys = useRef(new Map<string, string>());
  const trioRequest = useRef<{ key: string; runs: FuturosRun[] }>(null);
  const inFlight = useRef(new Map<string, Promise<FuturosRun | undefined>>());
  const actionLocked = useRef(false);
  const accessVersion = useRef(0);
  const readsAfter = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const wantsFocus = useRef(false);

  const remember = useCallback((run: FuturosRun) => {
    setRuns((current) => ({ ...current, [run.id]: mergeRun(current[run.id], run) }));
  }, []);

  const removeAccess = useCallback((message: string) => {
    accessVersion.current += 1;
    setCatalog(undefined);
    setRuns({});
    setUnavailableRuns([]);
    setComparison(undefined);
    setPollNotice('');
    setAdmission(undefined);
    setError(message);
  }, []);

  const loadCatalog = useCallback(async () => {
    const version = accessVersion.current;
    try {
      const response = await invoke(FUTUROS_SCENARIOS);
      if (version !== accessVersion.current) return;
      if (response.ok) {
        setCatalog(response.data);
        setError('');
      } else if (response.error.code === 'FORBIDDEN' || response.error.code === 'AUTH_REQUIRED') {
        removeAccess(response.error.message);
      } else {
        setError(response.error.message);
      }
    } catch {
      if (version === accessVersion.current) setError('No se pudo consultar Futuros.');
    }
  }, [removeAccess]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const readRun = useCallback((runId: string) => {
    const pending = inFlight.current.get(runId);
    if (pending) return pending;
    if (Date.now() < readsAfter.current) return Promise.resolve(undefined);
    const version = accessVersion.current;
    const request = invoke(FUTUROS_RUN, { runId }).then((response) => {
      if (version !== accessVersion.current) return undefined;
      if (response.ok) {
        remember(response.data);
        setPollNotice('');
        return response.data;
      }
      const { error: failure } = response;
      if (failure.code === 'RATE_LIMITED') {
        readsAfter.current = Math.max(readsAfter.current, Date.now() + 1_000 * (failure.retryAfterSeconds ?? 10));
        setPollNotice('Jira limitó temporalmente las consultas. Reanudaremos el seguimiento automáticamente.');
      } else if (failure.code === 'UNAVAILABLE') {
        setPollNotice('No se pudo actualizar la corrida. Volveremos a consultar.');
      } else if (failure.code === 'FORBIDDEN' || failure.code === 'AUTH_REQUIRED') {
        removeAccess(failure.message);
      } else {
        setRuns((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== runId)));
        setCatalog((current) => current && { ...current, runs: current.runs.filter(({ id }) => id !== runId) });
        setUnavailableRuns((current) => [...current, runId]);
        setError(failure.message);
      }
      return undefined;
    }).catch(() => {
      if (version === accessVersion.current) setPollNotice('Se interrumpió la consulta. Volveremos a intentar.');
      return undefined;
    }).finally(() => inFlight.current.delete(runId));
    inFlight.current.set(runId, request);
    return request;
  }, [remember, removeAccess]);

  const scenarios = catalog?.scenarios ?? [];
  const selected = scenarios.find(({ id }) => id === scenarioId) ?? scenarios[0];
  const byScenario = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const displayedRuns: FuturosRunCard[] = [
    ...Object.values(runs), ...(catalog?.runs ?? []).filter((run) => !runs[run.id]),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const activeKey = displayedRuns.filter(({ status }) => isActive(status)).map(({ id }) => id).sort().join(',');
  const detail = focusedRunId ? runs[focusedRunId] : undefined;
  const readFocused = !!catalog && !!focusedRunId && !detail && !unavailableRuns.includes(focusedRunId);

  useEffect(() => {
    if (!activeKey && !readFocused) return;
    const ids = activeKey ? activeKey.split(',') : [];
    if (readFocused && focusedRunId && !ids.includes(focusedRunId)) ids.unshift(focusedRunId);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let nextDelay = futurosPollIntervalMs;
    function schedule(delay: number) {
      timer = setTimeout(() => void poll(), delay);
    }
    async function poll() {
      if (document.visibilityState === 'hidden') {
        schedule(futurosPollIntervalMs);
        return;
      }
      const remaining = readsAfter.current - Date.now();
      if (remaining > 0) {
        schedule(futurosPollWait(nextDelay, remaining, false).timeoutMs);
        return;
      }
      let transientFailure = false;
      for (const id of ids) {
        if (stopped) return;
        if (!await readRun(id)) {
          transientFailure = true;
          break;
        }
      }
      const jitter = transientFailure ? Math.floor(Math.random() * 1_000) : 0;
      const wait = futurosPollWait(nextDelay, readsAfter.current - Date.now(), transientFailure, jitter);
      nextDelay = wait.nextMs;
      if (!stopped) schedule(wait.timeoutMs);
    }
    schedule(readFocused ? 0 : futurosPollIntervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [activeKey, focusedRunId, readFocused, readRun]);

  useEffect(() => {
    if (detail && wantsFocus.current) {
      wantsFocus.current = false;
      detailHeading.current?.focus();
    }
  }, [detail]);

  async function execute(action: () => Promise<void>) {
    if (actionLocked.current) return;
    actionLocked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la acción.');
    } finally {
      actionLocked.current = false;
      setBusy(false);
    }
  }

  async function submit<T>(key: string, send: (idempotencyKey: string) => Promise<FuturosResponse<T>>) {
    const idempotencyKey = requestKeys.current.get(key) ?? crypto.randomUUID();
    requestKeys.current.set(key, idempotencyKey);
    const version = accessVersion.current;
    const response = await send(idempotencyKey);
    if (response.ok || !uncertain(response.error.code)) requestKeys.current.delete(key);
    if (version !== accessVersion.current) throw new Error('Cambió el acceso al proyecto. Volvé a consultar Futuros.');
    if (!response.ok) throw new Error(response.error.message);
    return response.data;
  }

  function openRun(runId: string) {
    setError('');
    setUnavailableRuns((current) => current.filter((id) => id !== runId));
    if (runId === focusedRunId && detail) {
      detailHeading.current?.focus();
      return;
    }
    wantsFocus.current = true;
    onFocusRun(runId);
  }

  async function requestRun(id: string) {
    const key = [id, seed, sampleCount].join(':');
    const run = await submit(key, async (idempotencyKey) => {
      const started = performance.now();
      const response = await invoke(FUTUROS_START, { scenarioId: id, seed, sampleCount: Number(sampleCount), idempotencyKey });
      if (catalog?.stagingTiming && response.ok) {
        setAdmission({ runId: response.data.id, elapsedMs: Math.round(performance.now() - started) });
      }
      return response;
    });
    remember(run);
    return run;
  }

  async function requestTrio(scenarios: FuturosScenario[]) {
    const key = [seed, sampleCount, ...scenarios.map(({ id }) => id)].join(':');
    const group = trioRequest.current?.key === key ? trioRequest.current : { key, runs: [] };
    trioRequest.current = group;
    for (const scenario of scenarios.slice(group.runs.length)) {
      const run = await requestRun(scenario.id);
      group.runs.push(run);
      if (group.runs.length === 1) openRun(run.id);
    }
    trioRequest.current = null;
  }

  async function retry(runId: string) {
    const run = await submit('retry:' + runId, (idempotencyKey) => invoke(FUTUROS_RETRY, { runId, idempotencyKey }));
    remember(run);
    openRun(run.id);
    await readRun(runId);
  }

  async function publish(draft: Omit<FuturosScenarioEdit, 'idempotencyKey'>) {
    const scenario = await submit('scenario:' + JSON.stringify(draft),
      (idempotencyKey) => invoke(FUTUROS_CREATE_SCENARIO, { ...draft, idempotencyKey }));
    setCatalog((current) => current && {
      ...current, scenarios: [...current.scenarios.filter(({ id }) => id !== scenario.id), scenario],
    });
    setScenarioId(scenario.id);
    setNotice('Revisión ' + scenario.revision + ' publicada: ' + scenario.name + '.');
    await loadCatalog();
  }

  function runName(run: FuturosRunCard) {
    const scenario = byScenario.get(run.scenarioId);
    return scenario ? scenario.code + ' · ' + scenario.name + ' · r' + scenario.revision : 'Escenario';
  }

  const published = displayedRuns.filter(({ status }) => status === 'SUCCEEDED');
  const trio = ['S0', 'S1', 'S2'].flatMap((code) => scenarios.find((item) => item.code === code) ?? []);
  const preferred = trio.map((scenario) => published.find((run) =>
    run.scenarioId === scenario.id && run.seed === seed && run.sampleCount === Number(sampleCount))?.id ?? '');
  const baseId = comparisonIds?.[0] ?? (preferred[0] || published[0]?.id || '');
  const alternativeIds: [string, string] = [
    comparisonIds?.[1] ?? (preferred[1] || published.find(({ id }) => id !== baseId)?.id || ''),
    comparisonIds?.[2] ?? preferred[2] ?? '',
  ];
  const compareIds = [baseId, ...new Set(alternativeIds.filter((id) => id && id !== baseId))];
  const comparisonRuns = compareIds.flatMap((id) => runs[id] ? [{ run: runs[id], label: runName(runs[id]) }] : []);
  const validInput = /^[0-9a-f]{32}$/.test(seed) && /^\d+$/.test(sampleCount) &&
    Number(sampleCount) >= 1000 && Number(sampleCount) <= 10000;

  function chooseComparison(index: 0 | 1 | 2, id: string) {
    const next: [string, string, string] = [baseId, alternativeIds[0], alternativeIds[1]];
    next[index] = id;
    for (let i = 0; i < next.length; i += 1) {
      if (i !== index && next[i] === id) next[i] = '';
    }
    setComparisonIds(next);
    setComparison(undefined);
  }

  async function compare() {
    setComparison(undefined);
    if (!baseId || compareIds.length < 2) return;
    const version = accessVersion.current;
    for (const runId of compareIds) {
      if (!await readRun(runId)) return;
    }
    const result = await invoke(FUTUROS_COMPARE, { baselineRunId: baseId, alternativeRunIds: compareIds.slice(1) });
    if (version !== accessVersion.current) return;
    setComparison(result.ok ? { data: result.data } : { failure: result.error });
  }

  function comparisonOptions(exclude: string[]) {
    return published.filter(({ id }) => !exclude.includes(id)).map((run) =>
      <option key={run.id} value={run.id}>
        {runName(run)} · {dateTime.format(new Date(run.createdAt))} · {numeric.format(run.sampleCount)} muestras · {run.seed.slice(-8)} · {run.id.slice(0, 8)}
      </option>);
  }

  return (
    <section className="connection futuros-runner" aria-labelledby="futuros-title">
      <h1 id="futuros-title">Futuros</h1>
      {!catalog && !error && <p role="status">Consultando escenarios publicados…</p>}
      {!catalog && error && <button type="button" onClick={() => void loadCatalog()}>Consultar Futuros</button>}
      {error && <p className="message-error" role="alert">{error}</p>}
      {catalog && error && <button type="button" disabled={busy}
        onClick={() => void execute(loadCatalog)}>Actualizar catálogo</button>}
      {notice && <p role="status">{notice}</p>}
      {pollNotice && <p role="status">{pollNotice}</p>}
      {catalog?.canConfigureDemoPlanner && (
        <>
          <p>Para ejecutar escenarios de PED, asigná el rol PLANNER a tu cuenta actual de Jira.</p>
          <label className="demo-confirm"><input type="checkbox" checked={configured}
            onChange={(event) => setConfigured(event.target.checked)} /> Confirmo la asignación en este proyecto de demostración.</label>
          <button type="button" disabled={!configured || busy} onClick={() => void execute(async () => {
            const result = await invoke(FUTUROS_GRANT, { confirmed: true });
            if (!result.ok) throw new Error(result.error.message);
            await loadCatalog();
          })}>Asignar mi rol PLANNER en PED</button>
        </>
      )}
      {catalog && !selected && <p>Faltan escenarios publicados para el proyecto y snapshot actuales.</p>}
      {selected && <section aria-labelledby="futuros-scenarios">
        <h2 id="futuros-scenarios">Escenarios publicados</h2>
        <div className="futuros-settings">
          <label>Escenario<select value={selected.id} onChange={(event) => setScenarioId(event.target.value)} disabled={busy}>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>{scenario.code} · {scenario.name} · r{scenario.revision}</option>
            ))}
          </select></label>
          {catalog?.canStart && <>
            <label>Muestras<input type="number" min="1000" max="10000" step="1" value={sampleCount}
              disabled={busy} onChange={(event) => setSampleCount(event.target.value)} /></label>
            <label>Semilla compartida<input type="text" maxLength={32} value={seed}
              disabled={busy} onChange={(event) => setSeed(event.target.value)} aria-describedby="futuros-seed-help" /></label>
          </>}
        </div>
        <p>Patagonia Energy Development · Corte {selected.asOf} · Revisión {selected.revision}</p>
        {catalog?.canStart && <>
          <p id="futuros-seed-help">Usá de 1.000 a 10.000 muestras y una semilla de 32 caracteres hexadecimales en minúscula.</p>
          <div className="demo-actions">
            <button type="button" disabled={busy || !validInput} onClick={() => void execute(async () => {
              openRun((await requestRun(selected.id)).id);
            })}>Ejecutar escenario</button>
            {trio.length === 3 && <button type="button" disabled={busy || !validInput}
              onClick={() => void execute(() => requestTrio(trio))}>Ejecutar S0, S1 y S2</button>}
          </div>
          {catalog.stagingTiming && admission && <p>Admisión en staging {admission.elapsedMs} ms · Corrida {admission.runId}</p>}
          {selected.editor && <FuturosEditor key={selected.id} scenario={{ ...selected, editor: selected.editor }}
            disabled={busy} onPublish={(draft) => void execute(() => publish(draft))} />}
        </>}
      </section>}
      {!!displayedRuns.length && <section aria-labelledby="futuros-runs">
        <h2 id="futuros-runs">Corridas</h2>
        {!!activeKey && <button type="button" disabled={busy} onClick={() => void execute(async () => {
          for (const runId of activeKey.split(',')) if (!await readRun(runId)) break;
        })}>Actualizar corridas activas</button>}
        <ul className="futuros-runs">
          {displayedRuns.map((run) => <li key={run.id} data-focused={run.id === focusedRunId}>
            <h3>{runName(run)}</h3>
            <p>{dateTime.format(new Date(run.createdAt))}</p>
            <RunState run={run} detail={runs[run.id]} focused={run.id === focusedRunId} />
            <button type="button" disabled={busy} onClick={() => openRun(run.id)}
              aria-label={'Ver corrida ' + (byScenario.get(run.scenarioId)?.code ?? '') + ' ' + run.id.slice(0, 8)}>
              Ver corrida {byScenario.get(run.scenarioId)?.code}
            </button>
          </li>)}
        </ul>
      </section>}
      {focusedRunId && catalog && <section className="futuros-detail" aria-labelledby="futuros-detail-title">
        <h2 id="futuros-detail-title" tabIndex={-1} ref={detailHeading}>Detalle de corrida</h2>
        {!detail && !error && <p role="status">Consultando la corrida…</p>}
        {detail && <>
          <p>{runName(detail)} · {statuses[detail.status]}</p>
          <div className="demo-actions">
            {detail.canRetry && <button type="button" disabled={busy}
              onClick={() => void execute(() => retry(detail.id))}>Reintentar corrida</button>}
            {detail.canCancel && <button type="button" disabled={busy} onClick={() => void execute(async () => {
              const result = await invoke(FUTUROS_CANCEL, { runId: detail.id });
              if (!result.ok) throw new Error(result.error.message);
              remember(result.data);
            })}>Cancelar corrida</button>}
          </div>
          <FuturosResults run={detail} projectReference={catalog.jiraProjectId}
            openAgent={catalog.jiraProjectId ? openAgent : undefined} />
        </>}
      </section>}
      {published.length >= 2 && <section aria-labelledby="futuros-compare">
        <h2 id="futuros-compare">Comparar corridas</h2>
        <div className="futuros-settings futuros-comparison-controls">
          <label>Corrida base<select value={baseId} disabled={busy} onChange={(event) => chooseComparison(0, event.target.value)}>
            <option value="">Elegí la base</option>{comparisonOptions(alternativeIds)}
          </select></label>
          <label>Primera alternativa<select value={alternativeIds[0]} disabled={busy} onChange={(event) => chooseComparison(1, event.target.value)}>
            <option value="">Elegí una alternativa</option>{comparisonOptions([baseId, alternativeIds[1]])}
          </select></label>
          <label>Segunda alternativa<select value={alternativeIds[1]} disabled={busy} onChange={(event) => chooseComparison(2, event.target.value)}>
            <option value="">Sin segunda alternativa</option>{comparisonOptions([baseId, alternativeIds[0]])}
          </select></label>
        </div>
        <button type="button" disabled={busy || !baseId || compareIds.length < 2}
          onClick={() => void execute(compare)}>Comparar resultados</button>
        {comparison && <FuturosComparisonPanel baselineId={baseId} runs={comparisonRuns}
          comparison={comparison.data} failure={comparison.failure} />}
      </section>}
    </section>
  );
}

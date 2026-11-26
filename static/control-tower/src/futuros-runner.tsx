import { makeInvoke } from '@forge/bridge';
import { useEffect, useRef, useState } from 'react';
import {
  FUTUROS_CANCEL, FUTUROS_COMPARE, FUTUROS_GRANT, FUTUROS_RETRY, FUTUROS_RUN, FUTUROS_SCENARIOS, FUTUROS_START,
  type FuturosCatalog, type FuturosComparison, type FuturosResponse, type FuturosRun, type FuturosStatus,
} from '../../../src/shared/futuros';

const invoke = makeInvoke<{
  [FUTUROS_SCENARIOS]: () => FuturosResponse<FuturosCatalog>;
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
const numeric = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });
const probability = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 2 });
const defaultSeed = '00000000000000000000000020261125';

function isActive(status: FuturosStatus) {
  return status === 'QUEUED' || status === 'RUNNING';
}

function days(value: number | null) {
  return value === null ? 'Sin estimación' : numeric.format(value) + ' días';
}

function cost(value: string | null) {
  return value === null ? 'Sin estimación' : currency.format(Number(value) / 100);
}

function RunResult({ run }: { run: FuturosRun }) {
  const { result } = run;
  if (!result) return null;
  const joint = result.success.joint;
  return (
    <div className="futuros-result">
      <dl>
        <div><dt>Plazo P80</dt><dd>{days(result.finishDay.percentiles.p80)}</dd></div>
        {run.logical && <div><dt>CPM lógico modal</dt><dd>{days(run.logical.finishDay)}</dd></div>}
        <div><dt>Costo P80</dt><dd>{cost(result.costCents.percentiles.p80)}</dd></div>
        <div><dt>Cumplimiento de plazo y costo</dt>
          <dd>{joint.probability !== null ? probability.format(joint.probability)
            : joint.bounds ? joint.bounds.map((value) => probability.format(value)).join(' a ') : 'Sin estimación'}</dd></div>
        <div><dt>Muestras fuera del horizonte</dt><dd>{numeric.format(result.censoredCount)}</dd></div>
      </dl>
      <p>Corte {run.snapshotAsOf ?? 'sin fecha'} · Modelo {run.modelVersion}</p>
      <p className="futuros-digest">Hash del resultado <code>{run.resultHash}</code></p>
    </div>
  );
}

export function FuturosRunner() {
  const [catalog, setCatalog] = useState<FuturosCatalog>();
  const [runs, setRuns] = useState<Record<string, FuturosRun>>({});
  const [comparison, setComparison] = useState<FuturosComparison>();
  const [scenarioId, setScenarioId] = useState('');
  const [sampleCount, setSampleCount] = useState('4000');
  const [seed, setSeed] = useState(defaultSeed);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestKeys = useRef(new Map<string, string>());

  async function loadCatalog() {
    try {
      const response = await invoke(FUTUROS_SCENARIOS);
      if (response.ok) setCatalog(response.data);
      else setError(response.error.message);
    } catch {
      setError('No se pudo consultar Futuros.');
    }
  }

  useEffect(() => { void loadCatalog(); }, []);

  function remember(run: FuturosRun) {
    setRuns((current) => ({ ...current, [run.id]: run }));
  }

  async function refreshRuns(ids: string[]) {
    for (const runId of ids) {
      try {
        const response = await invoke(FUTUROS_RUN, { runId });
        if (response.ok) remember(response.data);
        else if (response.error.code === 'FORBIDDEN' || response.error.code === 'AUTH_REQUIRED') {
          setCatalog(undefined);
          setRuns({});
          setComparison(undefined);
          setError(response.error.message);
          return;
        } else {
          setRuns((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== runId)));
          setCatalog((current) => current ? { ...current, runs: current.runs.filter(({ id }) => id !== runId) } : undefined);
          setError(response.error.message);
        }
      } catch {
        setError('No se pudo actualizar el estado de la corrida.');
      }
    }
  }

  async function requestRun(id: string) {
    const key = [id, seed, sampleCount].join(':');
    const idempotencyKey = requestKeys.current.get(key) ?? crypto.randomUUID();
    requestKeys.current.set(key, idempotencyKey);
    const result = await invoke(FUTUROS_START, { scenarioId: id, seed, sampleCount: Number(sampleCount), idempotencyKey });
    if (result.ok || result.error.code !== 'UNAVAILABLE') requestKeys.current.delete(key);
    if (!result.ok) throw new Error(result.error.message);
    remember(result.data);
  }

  async function retry(runId: string) {
    const key = 'retry:' + runId;
    const idempotencyKey = requestKeys.current.get(key) ?? crypto.randomUUID();
    requestKeys.current.set(key, idempotencyKey);
    const result = await invoke(FUTUROS_RETRY, { runId, idempotencyKey });
    if (result.ok || result.error.code !== 'UNAVAILABLE') requestKeys.current.delete(key);
    if (!result.ok) throw new Error(result.error.message);
    remember(result.data);
    await refreshRuns([runId]);
  }

  async function execute(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  const scenarios = catalog?.scenarios ?? [];
  const completeRuns = Object.values(runs);
  const byScenario = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const selected = scenarioId || scenarios[0]?.id || '';
  const validInput = /^[0-9a-f]{32}$/.test(seed) && /^\d+$/.test(sampleCount) &&
    Number(sampleCount) >= 1000 && Number(sampleCount) <= 10000;
  const displayedRuns = [
    ...completeRuns,
    ...(catalog?.runs ?? []).filter((run) => !runs[run.id]),
  ];
  const activeIds = displayedRuns.filter(({ status }) => isActive(status)).map(({ id }) => id);
  const trio = ['S0', 'S1', 'S2'].flatMap((code) => {
    const scenario = scenarios.find((item) => item.code === code);
    return scenario ? [scenario] : [];
  });
  const published = trio.map((scenario) => completeRuns.find((run) =>
    run.scenarioId === scenario.id && run.status === 'SUCCEEDED' && run.seed === seed && run.sampleCount === Number(sampleCount)));
  const compatible = published.length === 3 && published.every(Boolean);

  return (
    <section className="connection futuros-runner" aria-labelledby="futuros-title">
      <h1 id="futuros-title">Futuros</h1>
      {!catalog && !error && <p role="status">Consultando escenarios publicados…</p>}
      {error && <p className="message-error" role="alert">{error}</p>}
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
      {!!scenarios.length && <section aria-labelledby="futuros-scenarios">
        <h2 id="futuros-scenarios">Escenarios publicados</h2>
        <p>Snapshot de Patagonia · {scenarios[0]?.asOf}</p>
        {catalog?.canStart && (
          <div className="futuros-settings">
            <label>Escenario<select value={selected} onChange={(event) => setScenarioId(event.target.value)}>
              {scenarios.map((scenario) =>
                <option key={scenario.id} value={scenario.id}>{scenario.code} · {scenario.name}</option>)}
            </select></label>
            <label>Muestras<input type="number" min="1000" max="10000" step="1" value={sampleCount}
              onChange={(event) => setSampleCount(event.target.value)} /></label>
            <label>Semilla compartida<input type="text" maxLength={32} value={seed} onChange={(event) => setSeed(event.target.value)} /></label>
            <div className="demo-actions">
              <button type="button" disabled={busy || !validInput} onClick={() => void execute(() => requestRun(selected))}>Ejecutar escenario</button>
              {trio.length === 3 && <button type="button" disabled={busy || !validInput} onClick={() => void execute(async () => {
                for (const scenario of trio) await requestRun(scenario.id);
              })}>Ejecutar S0, S1 y S2</button>}
            </div>
          </div>
        )}
      </section>}
      {!!displayedRuns.length && <section aria-labelledby="futuros-runs">
        <h2 id="futuros-runs">Corridas</h2>
        <div className="demo-actions">
          {!!activeIds.length && <button type="button" disabled={busy}
            onClick={() => void execute(() => refreshRuns(activeIds))}>Actualizar corridas activas</button>}
          {compatible && <button type="button" disabled={busy} onClick={() => void execute(async () => {
            const [base, s1, s2] = published;
            const result = await invoke(FUTUROS_COMPARE, { baselineRunId: base!.id, alternativeRunIds: [s1!.id, s2!.id] });
            if (!result.ok) throw new Error(result.error.message);
            setComparison(result.data);
          })}>Comparar S0, S1 y S2</button>}
        </div>
        <ul className="futuros-runs">
          {displayedRuns.map((run) => {
            const detail = runs[run.id];
            const code = byScenario.get(run.scenarioId)?.code ?? 'Escenario';
            return <li key={run.id}>
              <h3>{code} · {statuses[run.status]}</h3>
              <p>{numeric.format(detail?.materializedCount ?? 0)} de {numeric.format(run.sampleCount)} muestras</p>
              {detail?.retryOfId && <p>Reintento con la semilla original</p>}
              {detail?.canRetry && isActive(detail.status) && <p>Plazo vencido.</p>}
              {detail?.errorCode && <p>{detail.errorCode}</p>}
              {detail && <RunResult run={detail} />}
              {!detail && <button type="button" disabled={busy} onClick={() => void execute(() => refreshRuns([run.id]))}>Ver corrida {code}</button>}
              {detail?.canRetry && <button type="button" disabled={busy}
                onClick={() => void execute(() => retry(run.id))}>Reintentar corrida {code}</button>}
              {detail?.canCancel && <button type="button" disabled={busy} onClick={() => void execute(async () => {
                const result = await invoke(FUTUROS_CANCEL, { runId: run.id });
                if (!result.ok) throw new Error(result.error.message);
                remember(result.data);
              })}>Cancelar corrida {code}</button>}
            </li>;
          })}
        </ul>
      </section>}
      {comparison && <section aria-labelledby="futuros-comparison">
        <h2 id="futuros-comparison">Comparación emparejada</h2>
        <ul>{comparison.items.map(({ runId, comparison: result }) => (
          <li key={runId}>
            <strong>{byScenario.get(runs[runId]?.scenarioId ?? '')?.code ?? 'Alternativa'}</strong>{' '}
            · Δ P80 de plazo {days(result.finishDay.p80Delta)} · Δ P80 de costo {cost(result.costCents.p80Delta)}
          </li>
        ))}</ul>
      </section>}
    </section>
  );
}

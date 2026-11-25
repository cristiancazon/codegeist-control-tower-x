import { makeInvoke } from '@forge/bridge';
import { useEffect, useRef, useState } from 'react';
import { DEMO_APPLY, DEMO_PREVIEW, type DemoProgress, type DemoResponse } from '../../../src/shared/demo';

const invoke = makeInvoke<{
  [DEMO_PREVIEW]: () => DemoResponse;
  [DEMO_APPLY]: (input: { fixtureHash: string }) => DemoResponse;
}>();

const labels: Record<DemoProgress['state'], string> = {
  NOT_STARTED: 'Listo para cargar',
  IMPORTING: 'Carga en curso',
  PUBLISHING: 'Guardando el modelo en Forge',
  COMPLETE: 'Carga completa',
  REVIEW: 'Pendiente de conciliación',
};

export function DemoBootstrap() {
  const [progress, setProgress] = useState<DemoProgress>();
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'inspect' | 'apply'>();
  const [retryAt, setRetryAt] = useState<number>();
  const stopped = useRef(false);

  useEffect(() => () => { stopped.current = true; }, []);
  useEffect(() => {
    if (retryAt !== undefined) {
      const remainingMs = retryAt - Date.now();
      if (remainingMs <= 0) {
        setRetryAt(undefined);
        return;
      }
      const timer = window.setTimeout(() => setRetryAt(undefined), remainingMs);
      return () => window.clearTimeout(timer);
    }
  }, [retryAt]);

  function showError(failure: Extract<DemoResponse, { ok: false }>['error']) {
    if (failure.retryAfterSeconds !== undefined) {
      // Keep timers within the browser limit. Jira and the server can enforce longer delays.
      setRetryAt(Date.now() + Math.min(failure.retryAfterSeconds * 1000, 2_147_483_647));
    }
    setError(failure.message);
  }

  async function inspect() {
    setError(undefined);
    setBusy('inspect');
    try {
      const result = await invoke(DEMO_PREVIEW);
      if (result.ok) {
        setProgress(result.data);
      } else {
        showError(result.error);
      }
    } catch {
      setError('Forge no pudo consultar el estado de carga.');
    } finally {
      setBusy(undefined);
    }
  }

  async function apply() {
    if (!progress || !confirmed || busy || retryAt !== undefined) {
      return;
    }
    setError(undefined);
    setBusy('apply');
    stopped.current = false;
    let previous = progress;
    try {
      // Bounded chunks preserve Jira's active-user authority for each write.
      const maxRequests = previous.issuesTotal + 1;
      for (let index = 0; index < maxRequests && !stopped.current; index += 1) {
        const result = await invoke(DEMO_APPLY, { fixtureHash: previous.fixtureHash });
        if (!result.ok) {
          showError(result.error);
          break;
        }
        const current = result.data;
        setProgress(current);
        if (current.state !== 'IMPORTING' || current.issuesMapped <= previous.issuesMapped) {
          break;
        }
        previous = current;
      }
    } catch {
      setError('La carga quedó en pausa. Consultá el estado antes de reanudar.');
    } finally {
      setBusy(undefined);
    }
  }

  const completed = progress?.state === 'COMPLETE';
  const canApply = progress && !completed && confirmed && !busy && retryAt === undefined;
  return (
    <section className="connection demo-bootstrap" aria-labelledby="demo-heading">
      <h2 id="demo-heading">Datos de demostración</h2>
      <div role="status" aria-live="polite">
        {progress && (
          <>
            <p><strong>{progress.fixtureName}</strong> · {progress.jiraProjectKey}</p>
            <p>Datos ficticios. {progress.phases} fases, {progress.assets} activos, {progress.contractors} contratistas y {progress.historicalPeriods} meses de historia.</p>
            <p id="demo-progress">{labels[progress.state]} · {progress.issuesMapped} de {progress.issuesTotal} ítems vinculados</p>
            <progress aria-labelledby="demo-progress" value={progress.issuesMapped} max={progress.issuesTotal} />
            {progress.firstIssueKey && <p>Envío A-17 · <code>{progress.firstIssueKey}</code></p>}
          </>
        )}
        {busy === 'inspect' && <p>Consultando el estado…</p>}
        {error && <p className="message-error">{error}</p>}
        {retryAt !== undefined && <p>Podés reintentar cuando termine la espera indicada por Jira.</p>}
      </div>
      {!!progress && !completed && (
        <label className="demo-confirm">
          <input
            type="checkbox" checked={confirmed} disabled={!!busy}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Autorizo la carga de {progress.issuesTotal} ítems sintéticos en {progress.jiraProjectKey}.
        </label>
      )}
      <div className="demo-actions">
        <button type="button" disabled={!!busy || retryAt !== undefined} onClick={() => void inspect()}>
          {progress ? 'Actualizar estado' : 'Ver plan de carga'}
        </button>
        {progress && !completed && (
          <button type="button" disabled={!canApply} onClick={() => void apply()}>
            {progress.state === 'NOT_STARTED' ? 'Cargar datos' : 'Reanudar carga'}
          </button>
        )}
        {busy === 'apply' && <button type="button" onClick={() => { stopped.current = true; }}>Pausar</button>}
      </div>
    </section>
  );
}

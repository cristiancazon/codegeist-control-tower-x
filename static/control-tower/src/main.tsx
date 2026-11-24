import { makeInvoke, view } from '@forge/bridge';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HEALTH_OPERATION, type HealthResponse, type HealthStatus } from '../../../src/shared/health.js';
import './styles.css';

const invoke = makeInvoke<{ [HEALTH_OPERATION]: () => HealthResponse | undefined }>();

type HealthCheck =
  | { state: 'loading' }
  | { state: 'complete'; response: HealthResponse }
  | { state: 'unreachable' };

const statusLabels: Record<HealthStatus, string> = {
  READY: 'Operativa',
  DEGRADED: 'Degradada',
  UNAVAILABLE: 'No disponible',
};

function App() {
  const [attempt, setAttempt] = useState(0);
  const [check, setCheck] = useState<HealthCheck>({ state: 'loading' });

  useEffect(() => {
    let active = true;

    async function checkConnection() {
      try {
        const response = await invoke(HEALTH_OPERATION);
        if (active) {
          setCheck(response ? { state: 'complete', response } : { state: 'unreachable' });
        }
      } catch {
        if (active) {
          setCheck({ state: 'unreachable' });
        }
      }
    }

    void checkConnection();
    return () => {
      active = false;
    };
  }, [attempt]);

  const response = check.state === 'complete' ? check.response : undefined;
  const retryable =
    check.state === 'unreachable' ||
    (response && (response.ok ? response.data.status !== 'READY' : response.error.retryable));

  function retry() {
    setCheck({ state: 'loading' });
    setAttempt((current) => current + 1);
  }

  return (
    <main className="page">
      <h1>Control Tower X</h1>
      <section className="connection" aria-labelledby="connection-heading">
        <h2 id="connection-heading">Conexión con Forge</h2>
        <div className="connection-result" role="status" aria-atomic="true">
          {check.state === 'loading' && <p>Verificando la conexión…</p>}
          {check.state === 'unreachable' && (
            <p className="message-error">No se pudo conectar con Forge. Volvé a intentarlo.</p>
          )}
          {response?.ok && (
            <>
              <p className="connection-state" data-status={response.data.status}>
                <span className="state-indicator" aria-hidden="true" />
                {statusLabels[response.data.status]}
              </p>
              <dl className="details">
                <dt>ID de proyecto Jira</dt>
                <dd><code>{response.data.projectId}</code></dd>
              </dl>
            </>
          )}
          {response && !response.ok && (
            <>
              <p className="message-error">{response.error.message}</p>
              <dl className="details">
                <dt>Referencia de soporte</dt>
                <dd><code>{response.requestId}</code></dd>
              </dl>
            </>
          )}
        </div>
        {retryable && <button type="button" onClick={retry}>Reintentar</button>}
      </section>
    </main>
  );
}

// The health check remains available if the host theme cannot be loaded.
void view.theme.enable().catch(() => undefined);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}

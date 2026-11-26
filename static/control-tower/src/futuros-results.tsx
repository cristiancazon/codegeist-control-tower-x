import { useId, useRef, useState, type ReactNode } from 'react';
import type { Distribution, HistogramBin, PairedComparison, StatisticsSummary } from '../../../src/domain/futuros/statistics';
import type { FuturosComparison, FuturosFailure, FuturosRun } from '../../../src/shared/futuros';
import './futuros-results.css';

const whole = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const percent = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 2 });
const civilDate = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: 'UTC' });
const completionTime = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires',
});
const noEstimate = 'Sin estimación';
const percentileColumns = [
  { key: 'p05', label: 'P05' }, { key: 'p10', label: 'P10' }, { key: 'p50', label: 'P50' },
  { key: 'p80', label: 'P80' }, { key: 'p90', label: 'P90' }, { key: 'p95', label: 'P95' },
] as const;
const successLabels = { deadline: 'Plazo', budget: 'Costo', joint: 'Plazo y costo' } as const;
const successKeys = ['deadline', 'budget', 'joint'] as const;

type Format<T> = (value: T) => string;
type Success = StatisticsSummary['success']['joint'];
type SuccessKey = typeof successKeys[number];
type ChartMetric = 'finishDay' | 'costCents' | 'waitDays' | 'utilization' | 'productivity';
type ComparisonMetric = 'finishDay' | 'costCents';
type RunChoice = { run: FuturosRun; label: string };
type CompareFailure = { code: FuturosFailure; message: string };

function usd(value: string, showPositive = false): string {
  const cents = BigInt(value);
  const magnitude = cents < 0n ? -cents : cents;
  const sign = cents < 0n ? '−' : showPositive && cents > 0n ? '+' : '';
  return `${sign}USD ${whole.format(magnitude / 100n)},${String(magnitude % 100n).padStart(2, '0')}`;
}

function days(value: number): string {
  return `${decimal.format(value)} d`;
}

function dateAt(asOf: string | null, day: number): string | null {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.ceil(day));
  return Number.isFinite(date.getTime()) ? civilDate.format(date) : null;
}

function dateAndDays(asOf: string | null, day: number): string {
  const date = dateAt(asOf, day);
  return date ? `${date} · ${days(day)}` : days(day);
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${completionTime.format(date)} (Buenos Aires)` : value;
}

function coverage(observed: number, total: number): string {
  return `${whole.format(observed)} de ${whole.format(total)}`;
}

function quantile<T>(distribution: Distribution<T>, key: keyof Distribution<T>['percentiles'], format: Format<T>): string {
  const point = distribution.percentiles[key];
  const floor = distribution.lowerBounds[key];
  if (point !== null) return format(point);
  if (floor !== null) return `≥ ${format(floor)}`;
  return noEstimate;
}

function range([low, high]: [number, number]): string {
  return `${percent.format(low)} a ${percent.format(high)}`;
}

function estimatedSuccess(success: Success): string {
  if (success.probability !== null) return percent.format(success.probability);
  return success.bounds ? range(success.bounds) : noEstimate;
}

function probabilityUncertainty(value: Success): string {
  if (value.wilson95) return `Wilson al 95 % · ${range(value.wilson95)}`;
  if (value.bounds) return `Límites por censura · ${range(value.bounds)}`;
  return 'Sin resultados observados';
}

function SummaryTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
    {note && <dd className="fr-tile-note">{note}</dd>}
  </div>;
}

function DataTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="fr-table-wrap" tabIndex={0} role="region" aria-label={label}>
    <table className="fr-table">
      <caption>{label}</caption>
      {children}
    </table>
  </div>;
}

function QuantileRow<T>({ label, distribution, format, lowerTail = false }: {
  label: string; distribution: Distribution<T>; format: Format<T>; lowerTail?: boolean;
}) {
  return <tr>
    <th scope="row">{label}</th>
    {percentileColumns.map(({ key }) => <td key={key}>
      {key === 'p10' && !lowerTail ? '—' : quantile(distribution, key, format)}
    </td>)}
    <td>{coverage(distribution.observedCount, distribution.totalCount)}</td>
  </tr>;
}

function QuantileTable({ result, asOf }: { result: StatisticsSummary; asOf: string | null }) {
  return <>
    <DataTable label="Percentiles y cobertura por métrica">
      <thead><tr>
        <th scope="col">Métrica</th>
        {percentileColumns.map(({ label }) => <th key={label} scope="col">{label}</th>)}
        <th scope="col">Muestras observadas</th>
      </tr></thead>
      <tbody>
        <QuantileRow label="Fin de proyecto" distribution={result.finishDay} format={(value) => dateAndDays(asOf, value)} />
        <QuantileRow label="Costo total" distribution={result.costCents} format={usd} />
        <QuantileRow label="Espera acumulada" distribution={result.waitDays} format={days} />
        <QuantileRow label="Utilización de equipos" distribution={result.utilization} lowerTail format={(value) => percent.format(value)} />
        <QuantileRow label="Productividad" distribution={result.productivity} lowerTail format={(value) => `${decimal.format(value)} ×`} />
      </tbody>
    </DataTable>
    <p className="fr-note">P05 a P95 muestra la dispersión dentro del modelo. Las fechas corresponden a días civiles a partir del corte, con el día redondeado hacia arriba.</p>
  </>;
}

function ProbabilityTable({ values }: { values: StatisticsSummary['success'] }) {
  return <>
    <DataTable label="Objetivos de cumplimiento">
      <thead><tr>
        <th scope="col">Objetivo</th><th scope="col">Probabilidad</th><th scope="col">Incertidumbre</th>
        <th scope="col">Éxitos conocidos</th><th scope="col">Resultados desconocidos</th>
      </tr></thead>
      <tbody>{successKeys.map((key) => {
        const value = values[key];
        return <tr key={key}>
          <th scope="row">{successLabels[key]}</th>
          <td>{value.probability === null ? noEstimate : percent.format(value.probability)}</td>
          <td>{probabilityUncertainty(value)}</td>
          <td>{coverage(value.successes, value.successes + value.failures)}</td>
          <td>{whole.format(value.unknown)}</td>
        </tr>;
      })}</tbody>
    </DataTable>
    <p className="fr-note">Los intervalos de Wilson reflejan la precisión Monte Carlo para estos supuestos.</p>
  </>;
}

type ChartSeries<T> = { name: string; bins: Array<HistogramBin<T>>; observed: number };

function Histogram<T>({ title, series, total, format }: {
  title: string; series: ChartSeries<T>[]; total: number; format: Format<T>;
}) {
  const bins = series[0]?.bins ?? [];
  if (bins.length === 0) return <p className="fr-note">No hay muestras observadas para {title.toLowerCase()}.</p>;
  const maximum = Math.max(1, ...series.flatMap(({ bins }) => bins.map(({ count }) => count)));
  return <figure className="fr-histogram">
    <figcaption>{title}</figcaption>
    <ul className="fr-chart-legend">
      {series.map(({ name, observed }, index) => <li key={name}>
        <span className={`fr-chart-swatch fr-series-${index}`} aria-hidden="true" />
        {name} · {coverage(observed, total)} muestras
      </li>)}
    </ul>
    <div className="fr-chart" aria-hidden="true">
      <div className="fr-chart-scale"><span>{whole.format(maximum)}</span><span>0</span></div>
      <div className="fr-chart-plot">
        {bins.map((_, index) => <div className="fr-chart-group" key={index}>
          {series.map(({ name, bins }, seriesIndex) => <span key={name}
            className={`fr-chart-bar fr-series-${seriesIndex}`}
            style={{ height: `${100 * (bins[index]?.count ?? 0) / maximum}%` }} />)}
        </div>)}
      </div>
      <span className="fr-axis-first">{format(bins[0]!.from)}</span>
      <span className="fr-axis-last">{format(bins.at(-1)!.to)}</span>
    </div>
    <details className="fr-table-disclosure">
      <summary>Ver recuentos por intervalo</summary>
      <DataTable label={`${title} · recuentos por intervalo`}>
        <thead><tr>
          <th scope="col">Desde</th><th scope="col">Hasta</th>
          {series.map(({ name }) => <th key={name} scope="col">{name}</th>)}
        </tr></thead>
        <tbody>{bins.map(({ from, to }, index) => <tr key={index}>
          <td>{format(from)}</td><td>{format(to)}</td>
          {series.map(({ name, bins }) => <td key={name}>{whole.format(bins[index]?.count ?? 0)}</td>)}
        </tr>)}</tbody>
      </DataTable>
      <p className="fr-note">El último intervalo incluye su extremo superior.</p>
    </details>
  </figure>;
}

function RunHistogram<T>({ name, distribution, format }: { name: string; distribution: Distribution<T>; format: Format<T> }) {
  return <Histogram title={name} total={distribution.totalCount} format={format}
    series={[{ name: 'Frecuencia', bins: distribution.histogram, observed: distribution.observedCount }]} />;
}

function DistributionExplorer({ result }: { result: StatisticsSummary }) {
  const [metric, setMetric] = useState<ChartMetric>('finishDay');
  const byMetric: Record<ChartMetric, ReactNode> = {
    finishDay: <RunHistogram name="Día de finalización" distribution={result.finishDay} format={days} />,
    costCents: <RunHistogram name="Costo total" distribution={result.costCents} format={usd} />,
    waitDays: <RunHistogram name="Espera acumulada" distribution={result.waitDays} format={days} />,
    utilization: <RunHistogram name="Utilización de equipos" distribution={result.utilization} format={(value) => percent.format(value)} />,
    productivity: <RunHistogram name="Productividad" distribution={result.productivity} format={(value) => `${decimal.format(value)} ×`} />,
  };
  return <div className="fr-distribution">
    <label className="fr-select-label">Variable de distribución
      <select value={metric} onChange={(event) => setMetric(event.target.value as ChartMetric)}>
        <option value="finishDay">Plazo</option><option value="costCents">Costo</option>
        <option value="waitDays">Espera</option><option value="utilization">Utilización</option>
        <option value="productivity">Productividad</option>
      </select>
    </label>
    {byMetric[metric]}
  </div>;
}

function factorLabel(factor: string): ReactNode {
  const [kind, id, measure] = factor.split(':');
  if (kind === 'task' && id && measure === 'duration') return `Duración de ${id}`;
  if (kind === 'gate' && id && measure === 'eta') return <>Llegada de insumo <code>{id}</code></>;
  if (factor === 'operational-risk:cost') return 'Costo del riesgo operativo';
  return <code>{factor}</code>;
}

function SensitivityTable({ result }: { result: StatisticsSummary }) {
  const groups = [
    { label: 'Plazo', factors: result.sensitivity.finishDay },
    { label: 'Costo', factors: result.sensitivity.costCents },
  ];
  if (groups.every(({ factors }) => factors.length === 0)) return <p className="fr-note">Sin factores con datos de sensibilidad.</p>;
  return <>
    <DataTable label="Sensibilidad de plazo y costo">
      <thead><tr><th scope="col">Resultado</th><th scope="col">Factor</th><th scope="col">Spearman (ρ)</th><th scope="col">Muestras observadas</th></tr></thead>
      <tbody>{groups.flatMap(({ label, factors }) => factors.map(({ factor, rho, observedCount }) => <tr key={`${label}:${factor}`}>
        <td>{label}</td>
        <th scope="row">{factorLabel(factor)}</th>
        <td>{rho === null ? 'Indefinido' : signed.format(rho)}</td>
        <td>{coverage(observedCount, result.sampleCount)}</td>
      </tr>))}</tbody>
    </DataTable>
    <p className="fr-note">La correlación describe una asociación en las muestras observadas. Los factores constantes tienen correlación indefinida.</p>
  </>;
}

function Milestones({ result, asOf }: { result: StatisticsSummary; asOf: string | null }) {
  if (result.milestones.length === 0) return null;
  return <DataTable label="Hitos pendientes simulados">
    <thead><tr>
      <th scope="col">Referencia de hito</th><th scope="col">P50</th><th scope="col">P80</th><th scope="col">P90</th><th scope="col">Muestras observadas</th>
    </tr></thead>
    <tbody>{result.milestones.map(({ taskId, ...distribution }) => <tr key={taskId}>
      <th scope="row"><code>{taskId}</code></th>
      <td>{quantile(distribution, 'p50', (value) => dateAndDays(asOf, value))}</td>
      <td>{quantile(distribution, 'p80', (value) => dateAndDays(asOf, value))}</td>
      <td>{quantile(distribution, 'p90', (value) => dateAndDays(asOf, value))}</td>
      <td>{coverage(distribution.observedCount, distribution.totalCount)}</td>
    </tr>)}</tbody>
  </DataTable>;
}

function Evidence({ run }: { run: FuturosRun }) {
  return <details className="fr-disclosure fr-evidence">
    <summary>Origen y reproducibilidad</summary>
    <dl>
      <div><dt>Corrida</dt><dd><code>{run.id}</code></dd></div>
      <div><dt>Escenario</dt><dd><code>{run.scenarioId}</code></dd></div>
      <div><dt>Snapshot sellado</dt><dd><code>{run.snapshotId}</code></dd></div>
      <div><dt>Fecha de corte</dt><dd>{dateAt(run.snapshotAsOf, 0) ?? 'Sin fecha publicada'}</dd></div>
      {run.finishedAt && <div><dt>Publicación</dt><dd>{timestamp(run.finishedAt)}</dd></div>}
      <div><dt>Muestras</dt><dd>{whole.format(run.sampleCount)}</dd></div>
      <div><dt>Semilla</dt><dd><code>{run.seed}</code></dd></div>
      <div><dt>Modelo</dt><dd><code>{run.modelVersion}</code></dd></div>
      <div><dt>Versión del motor</dt><dd><code>{run.engineBuild}</code></dd></div>
      <div><dt>Generador de muestras</dt><dd><code>{run.rngVersion}</code></dd></div>
      <div><dt>Huella de entrada</dt><dd><code>{run.inputHash}</code></dd></div>
      <div><dt>Huella de resultado</dt><dd><code>{run.resultHash}</code></dd></div>
    </dl>
  </details>;
}

function AgentHandoff({ runId, projectReference, openAgent }: {
  runId: string; projectReference?: string; openAgent?: (prompt: string) => Promise<void>;
}) {
  const promptId = useId();
  const text = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState('');
  const [opening, setOpening] = useState(false);
  const ref = projectReference?.trim();
  const validProject = !!ref && /^[1-9][0-9]{0,31}$/.test(ref);
  const scope = validProject ? `del proyecto Jira con ID ${ref}` : 'del proyecto abierto en Jira';
  const prompt = `Consultá en Futuros la corrida ${runId} ${scope}. Verificá mi acceso y explicá el resultado publicado con sus referencias, supuestos y límites.`;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('Consulta copiada.');
    } catch {
      text.current?.focus();
      text.current?.select();
      setStatus('La consulta quedó seleccionada. Copiala con el atajo de tu dispositivo.');
    }
  }

  async function openChat() {
    if (!openAgent || opening) return;
    setOpening(true);
    setStatus('');
    try {
      await openAgent(prompt);
    } catch {
      setStatus('No se pudo abrir Agent X desde esta vista. Podés copiar la consulta y abrir Rovo Chat en Jira.');
    } finally {
      setOpening(false);
    }
  }

  return <details className="fr-disclosure fr-agent">
    <summary>Consultar a Agent X</summary>
    <p>Abrí Rovo Chat en Jira. Si Agent X está disponible, seleccionalo y pegá esta consulta.</p>
    <label htmlFor={promptId}>Consulta para copiar</label>
    <textarea id={promptId} rows={3} value={prompt} readOnly ref={text} />
    <div className="fr-agent-actions">
      {openAgent && validProject && <button type="button" disabled={opening} onClick={() => void openChat()}>
        {opening ? 'Abriendo Agent X…' : 'Abrir Agent X'}
      </button>}
      <button type="button" onClick={() => void copyPrompt()}>Copiar consulta</button>
    </div>
    <p className="fr-note" role="status">{status}</p>
  </details>;
}

export function FuturosResults({ run, projectReference, openAgent }: {
  run: FuturosRun; projectReference?: string; openAgent?: (prompt: string) => Promise<void>;
}) {
  const { result } = run;
  if (run.status !== 'SUCCEEDED' || !result || !run.resultHash) return null;
  const { joint } = result.success;
  const formatDate = (value: number) => dateAndDays(run.snapshotAsOf, value);
  return <div className="fr-surface fr-result">
    <dl className="fr-tiles">
      <SummaryTile label="Plazo P80" value={quantile(result.finishDay, 'p80', formatDate)} />
      <SummaryTile label="Costo P80" value={quantile(result.costCents, 'p80', usd)} />
      <SummaryTile label="Cumplimiento conjunto" value={estimatedSuccess(joint)}
        note={joint.wilson95 ? probabilityUncertainty(joint) : joint.bounds ? 'Límites por censura' : undefined} />
    </dl>
    <p className="fr-result-context">
      {whole.format(result.sampleCount)} muestras
      {run.snapshotAsOf && <> · Corte {dateAt(run.snapshotAsOf, 0) ?? run.snapshotAsOf}</>}
      {!!result.censoredCount && <> · {whole.format(result.censoredCount)} fuera del horizonte</>}
    </p>
    {result.distributionIncomplete && <p className="fr-warning">Distribución incompleta por censura del horizonte.</p>}
    <details className="fr-disclosure">
      <summary>Ver detalle de resultados</summary>
      <div className="fr-result-detail">
        {run.logical && <p className="fr-note">Fin según CPM lógico modal · {formatDate(run.logical.finishDay)}. Las distribuciones incluyen las restricciones de recursos del modelo.</p>}
        <QuantileTable result={result} asOf={run.snapshotAsOf} />
        {result.costCents.observedCount < result.costCents.totalCount && (
          <p className="fr-note">Los cuantiles de costo requieren cobertura completa de las muestras.</p>
        )}
        <DistributionExplorer result={result} />
        <ProbabilityTable values={result.success} />
        <Milestones result={result} asOf={run.snapshotAsOf} />
        <SensitivityTable result={result} />
      </div>
    </details>
    <Evidence run={run} />
    <AgentHandoff key={run.id} runId={run.id} projectReference={projectReference} openAgent={openAgent} />
  </div>;
}

const pairingFields = [
  ['snapshotId', 'snapshot'], ['seed', 'semilla'], ['sampleCount', 'cantidad de muestras'],
  ['modelVersion', 'modelo'], ['engineBuild', 'versión del motor'], ['rngVersion', 'generador de muestras'],
] as const;

function listingDifference(base: RunChoice, runs: readonly RunChoice[]): string[] {
  return pairingFields.filter(([field]) => runs.some(({ run }) => run[field] !== base.run[field])).map(([, label]) => label);
}

function PairedHistogram({ result, baseName, altName }: { result: PairedComparison; baseName: string; altName: string }) {
  const [variable, setVariable] = useState<ComparisonMetric>('finishDay');
  return <div className="fr-distribution">
    <label className="fr-select-label">Distribución compartida
      <select value={variable} onChange={(event) => setVariable(event.target.value as ComparisonMetric)}>
        <option value="finishDay">Plazo</option><option value="costCents">Costo</option>
      </select>
    </label>
    {variable === 'finishDay'
      ? <Histogram title="Día de finalización" total={result.sampleCount} format={days}
        series={[
          { name: baseName, bins: result.finishDay.histogram.base, observed: result.finishDay.observedCount.base },
          { name: altName, bins: result.finishDay.histogram.alternative, observed: result.finishDay.observedCount.alternative },
        ]} />
      : <Histogram title="Costo total" total={result.sampleCount} format={usd}
        series={[
          { name: baseName, bins: result.costCents.histogram.base, observed: result.costCents.observedCount.base },
          { name: altName, bins: result.costCents.histogram.alternative, observed: result.costCents.observedCount.alternative },
        ]} />}
  </div>;
}

function PairedDeltasRow<T>({ label, metric, format }: {
  label: string; metric: { p80Delta: T | null; pairedDeltas: Distribution<T> }; format: Format<T>;
}) {
  return <tr>
    <th scope="row">{label}</th>
    <td>{metric.p80Delta === null ? noEstimate : format(metric.p80Delta)}</td>
    {(['p05', 'p50', 'p95'] as const).map((point) => <td key={point}>{quantile(metric.pairedDeltas, point, format)}</td>)}
    <td>{coverage(metric.pairedDeltas.observedCount, metric.pairedDeltas.totalCount)}</td>
  </tr>;
}

function PairedObjectiveRow({ label, value }: { label: string; value: PairedComparison['success'][SuccessKey] }) {
  const delta = value.deltaPercentagePoints;
  const error = value.standardErrorPercentagePoints;
  const precision = value.unknownPairs > 0 ? `${whole.format(value.unknownPairs)} pares con resultados desconocidos`
    : delta === 0 ? 'Empate observado'
      : value.signRobust === true ? 'Dirección estable con la precisión Monte Carlo'
        : value.signRobust === false ? 'Dirección incierta con la precisión Monte Carlo' : 'Precisión insuficiente';
  return <tr>
    <th scope="row">{label}</th>
    <td>{delta === null ? noEstimate : `${signed.format(delta)} pp`}</td>
    <td>{error === null ? noEstimate : `${decimal.format(error)} pp`}</td>
    <td>{precision}</td>
  </tr>;
}

function PairedResult({ result, baseName, altName }: { result: PairedComparison; baseName: string; altName: string }) {
  return <article className="fr-paired">
    <h3>{altName} frente a {baseName}</h3>
    <DataTable label="Diferencias de costo y plazo">
      <thead><tr>
        <th scope="col">Métrica</th><th scope="col">Diferencia entre P80</th><th scope="col">Δ P05</th>
        <th scope="col">Δ P50</th><th scope="col">Δ P95</th><th scope="col">Pares observados</th>
      </tr></thead>
      <tbody>
        <PairedDeltasRow label="Plazo" metric={result.finishDay} format={(value) => `${signed.format(value)} d`} />
        <PairedDeltasRow label="Costo" metric={result.costCents} format={(value) => usd(value, true)} />
      </tbody>
    </DataTable>
    <p className="fr-note">Los cuantiles Δ resumen la diferencia muestra a muestra. Los signos se leen como alternativa menos referencia.</p>
    <DataTable label="Diferencias de probabilidad de cumplimiento">
      <thead><tr><th scope="col">Objetivo</th><th scope="col">Diferencia</th><th scope="col">Error estándar</th><th scope="col">Precisión</th></tr></thead>
      <tbody>{successKeys.map((key) => <PairedObjectiveRow key={key} label={successLabels[key]} value={result.success[key]} />)}</tbody>
    </DataTable>
    <PairedHistogram result={result} baseName={baseName} altName={altName} />
  </article>;
}

export function FuturosComparisonPanel({ baselineId, runs, comparison, failure, loading = false }: {
  baselineId: string; runs: readonly RunChoice[]; comparison?: FuturosComparison; failure?: CompareFailure; loading?: boolean;
}) {
  if (failure?.code === 'FORBIDDEN' || failure?.code === 'AUTH_REQUIRED' || failure?.code === 'NOT_FOUND' || failure?.code === 'STALE_INPUT') {
    return <p className="fr-surface fr-warning" role="status">{failure.message}</p>;
  }
  const base = runs.find(({ run }) => run.id === baselineId);
  if (!base || runs.length < 2) return null;
  const alternatives = runs.filter(({ run }) => run.id !== baselineId);
  const differences = listingDifference(base, alternatives);
  const complete = runs.every(({ run }) => run.status === 'SUCCEEDED' && run.result && run.resultHash);
  const items = new Map(comparison?.items.map(({ runId, comparison }) => [runId, comparison]));
  const paired = complete && !loading && !failure && differences.length === 0 && comparison?.baselineId === baselineId
    && items.size === alternatives.length && alternatives.every(({ run }) => items.get(run.id)?.sampleCount === run.sampleCount);
  let message = 'Elegí Comparar resultados para consultar las diferencias.';
  if (loading) message = 'Consultando la comparación emparejada…';
  else if (differences.length) message = `Corridas incompatibles para el emparejamiento. Difieren en ${differences.join(', ')}.`;
  else if (failure?.code === 'SAMPLES_EXPIRED') message = 'El detalle emparejado venció. Los resultados publicados siguen disponibles.';
  else if (failure?.code === 'INCOMPATIBLE_RUNS') message = 'Los supuestos o parámetros de estas corridas impiden el emparejamiento.';
  else if (failure) message = failure.message;
  else if (!complete) message = 'La comparación requiere resultados publicados de todas las corridas seleccionadas.';

  return <div className="fr-surface fr-comparison" aria-busy={loading}>
    <DataTable label="Resultados publicados de cada corrida">
      <thead><tr><th scope="col">Corrida</th><th scope="col">Plazo P80</th><th scope="col">Costo P80</th><th scope="col">Cumplimiento conjunto</th><th scope="col">Muestras</th></tr></thead>
      <tbody>{[base, ...alternatives].map(({ run, label }) => {
        const result = run.status === 'SUCCEEDED' && run.resultHash ? run.result : null;
        return <tr key={run.id}>
          <th scope="row">{label}{run.id === baselineId && <span className="fr-row-note">Referencia</span>}<code className="fr-row-note">{run.id}</code></th>
          <td>{result ? quantile(result.finishDay, 'p80', (value) => dateAndDays(run.snapshotAsOf, value)) : noEstimate}</td>
          <td>{result ? quantile(result.costCents, 'p80', usd) : noEstimate}</td>
          <td>{result ? estimatedSuccess(result.success.joint) : noEstimate}</td>
          <td>{whole.format(run.sampleCount)}</td>
        </tr>;
      })}</tbody>
    </DataTable>
    {paired
      ? <div className="fr-pairs">{alternatives.map(({ run, label }) => <PairedResult key={run.id}
        result={items.get(run.id)!} baseName={base.label} altName={label} />)}</div>
      : <p role="status" className={loading ? 'fr-note' : 'fr-warning'}>{message}</p>}
  </div>;
}

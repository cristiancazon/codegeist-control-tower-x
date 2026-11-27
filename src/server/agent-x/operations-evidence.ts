import api, { NeedsAuthenticationError, route } from '@forge/api';
import type { OperationsField, OperationsLink, OperationsSource } from '../../shared/operations';
import { isDateOnly, isIssueKey, isRecord } from '../data/jira/normalize';
import { operationsResolvers } from '../operations/resolvers';
import { actorFrom, resolveJiraProjectReference, rovoProjectContext } from './context';

const focusOptions = ['assets', 'logistics', 'contractors', 'hse', 'financial'] as const;
const recordCode = /^[A-Z0-9_-]{1,48}$/;
const maxEvidence = 10;
const maxResults = 5;
const maxBytes = 32 * 1024;
const publicErrors = {
  AUTH_REQUIRED: 'Iniciá sesión en Jira para consultar evidencias de Control Tower X.',
  INVALID_REFERENCE: 'Proporcioná un proyecto y un filtro válidos para la consulta.',
  NOT_AVAILABLE: 'La evidencia solicitada no está disponible para esta consulta.',
  TEMPORARILY_UNAVAILABLE: 'No se pudo verificar la evidencia. Volvé a consultar más tarde.',
} as const;

type ErrorCode = keyof typeof publicErrors;
type Evidence = { sourceType: 'JIRA' | 'FORGE'; sourceId: string; label: string; observedAt: string | null; url?: string };
type Dependencies = {
  read: typeof operationsResolvers;
  resolveProject: typeof resolveJiraProjectReference;
  jiraOrigin: () => Promise<string | undefined>;
};

function failure(code: ErrorCode) {
  return { ok: false as const, error: { code, message: publicErrors[code] } };
}

function boundaryFailure(code: string) {
  return failure(code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED'
    : code === 'INVALID_FILTER' ? 'INVALID_REFERENCE'
      : code === 'UNAVAILABLE' ? 'TEMPORARILY_UNAVAILABLE' : 'NOT_AVAILABLE');
}

function text(value: string, limit = 160): string {
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/(?:[a-z][a-z\d+.-]*:\/\/|(?:javascript|data|file|mailto):|\/\/)\S+/gi, ' ')
    .replace(/[<>\[\]`]/g, '')
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, limit);
}

function instant(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function mayDisplayJiraOrigin(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !/^[a-z\d-]+\.atlassian\.net$/.test(url.hostname) ||
        url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

async function readJiraOrigin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/serverInfo`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) return undefined;
  const body: unknown = await response.json();
  return isRecord(body) ? mayDisplayJiraOrigin(body.baseUrl) : undefined;
}

async function scopedOrigin(links: OperationsLink[], resolve: Dependencies['jiraOrigin']) {
  if (!links.some((link) => link.kind === 'jira' && isIssueKey(link.issueKey))) return undefined;
  try {
    return mayDisplayJiraOrigin(await resolve());
  } catch {
    // The authorized source identifier remains useful if host metadata is unavailable.
    return undefined;
  }
}

function sourceData(sources: OperationsSource[]) {
  return sources.slice(0, 5).map(({ source, state, quality, observedAt }) =>
    ({ source, state, quality, observedAt: instant(observedAt) }));
}

function resultStatus(sources: OperationsSource[], hasData: boolean) {
  if (sources.some(({ state }) => state === 'UNAVAILABLE' || state === 'PARTIAL')) {
    return hasData ? 'PARTIAL' as const : 'UNAVAILABLE' as const;
  }
  return 'READY' as const;
}

function typedEvidence(links: OperationsLink[], sources: ReturnType<typeof sourceData>, jiraOrigin?: string): Evidence[] {
  const evidence = new Map<string, Evidence>();
  for (const link of links) {
    if (evidence.size === maxEvidence) break;
    if (link.kind === 'jira' && isIssueKey(link.issueKey)) {
      const key = link.issueKey;
      evidence.set(`JIRA/${key}`, {
        sourceType: 'JIRA', sourceId: key, label: text(link.label) || key,
        observedAt: sources.find(({ source }) => source === 'JIRA')?.observedAt ?? null,
        ...(jiraOrigin ? { url: `${jiraOrigin}/browse/${key}` } : {}),
      });
    } else if (link.kind === 'record' && recordCode.test(link.code)) {
      evidence.set(`FORGE/${link.code}`, {
        sourceType: 'FORGE', sourceId: link.code, label: text(link.label) || link.code,
        observedAt: sources.find(({ source }) => source === 'FORGE')?.observedAt ?? null,
      });
    }
  }
  return [...evidence.values()];
}

function fieldsFor(fields: OperationsField[], limit: number) {
  return fields.slice(0, limit).map(({ label, value }) => ({ label: text(label), value: value === null ? null : text(value, 240) }));
}

function bounded<T>(data: T) {
  return Buffer.byteLength(JSON.stringify(data), 'utf8') <= maxBytes ? data : failure('TEMPORARILY_UNAVAILABLE');
}

function projectSelector(payload: Record<string, unknown>) {
  return payload.projectRef ?? payload.jiraProjectId;
}

const dayMilliseconds = 86_400_000;

function registeredDelay(fields: OperationsField[]) {
  const base = fields.find(({ label }) => label === 'ETA original')?.value;
  const latest = fields.find(({ label }) => label === 'ETA vigente')?.value;
  return isDateOnly(base) && isDateOnly(latest) ? (Date.parse(latest) - Date.parse(base)) / dayMilliseconds : null;
}

const searchText = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-AR');

export function createOperationsEvidence({
  read = operationsResolvers, resolveProject = resolveJiraProjectReference, jiraOrigin = readJiraOrigin,
}: Partial<Dependencies> = {}) {
  async function readOperationalExposure(payload: unknown, context: unknown) {
    const actor = actorFrom(context);
    if (!actor) return failure('AUTH_REQUIRED');
    if (!isRecord(payload) || typeof payload.focus !== 'string') return failure('INVALID_REFERENCE');
    const focus = focusOptions.find((value) => value === payload.focus);
    const itemRef = payload.itemRef;
    if (!focus || (itemRef !== undefined && (typeof itemRef !== 'string' || !recordCode.test(itemRef)))) {
      return failure('INVALID_REFERENCE');
    }

    try {
      const projectId = await resolveProject(projectSelector(payload));
      if (!projectId) return failure('INVALID_REFERENCE');
      const scoped = rovoProjectContext(actor, projectId);
      if (itemRef) {
        const response = await read.detail({ context: scoped, payload: { section: focus, code: itemRef } });
        if (!response.ok) return boundaryFailure(response.error.code);
        if (response.data.code !== itemRef) return failure('NOT_AVAILABLE');
        const record = response.data;
        const coverage = sourceData(record.sources);
        const observedAt = coverage.find(({ source }) => source === 'FORGE')?.observedAt ?? null;
        const links = focus === 'hse' ? [] : record.links;
        const selected = focus === 'hse'
          ? record.fields.filter(({ label }) => ['Categoría', 'Severidad', 'Estado', 'Área', 'Fecha'].includes(label))
          : record.fields;
        const retainedEvidence = typedEvidence(links, coverage, await scopedOrigin(links, jiraOrigin)).slice(0, maxEvidence - 1);
        return bounded({
          ok: true as const, status: resultStatus(record.sources, true), focus, asOf: observedAt, coverage,
          record: {
            code: record.code, title: focus === 'hse' ? record.code : text(record.title), fields: fieldsFor(selected, 10),
            ...(focus === 'logistics' && itemRef === 'A-17' ? { registeredEtaChangeDays: registeredDelay(selected) } : {}),
            ...(focus === 'hse' ? {} : { context: record.groups?.slice(0, 2)
              .map(({ label, fields }) => ({ label: text(label), fields: fieldsFor(fields, 4) })) ?? [] }),
          },
          evidence: [{ sourceType: 'FORGE', sourceId: record.code, label: focus === 'hse' ? record.code : text(record.title),
            observedAt }, ...retainedEvidence],
          requestId: response.requestId,
        });
      }

      const response = await read.list({ context: scoped, payload: { section: focus } });
      if (!response.ok) return boundaryFailure(response.error.code);
      const { sources, project, rows, columns } = response.data;
      const coverage = sourceData(sources);
      const selected = rows.filter(({ code }) => recordCode.test(code)).slice(0, maxResults);
      const links = selected.map(({ issueKey, code }): OperationsLink => issueKey && focus !== 'hse'
        ? { kind: 'jira', issueKey, label: `Jira · ${code}` } : { kind: 'record', section: focus, code, label: code });
      return bounded({
        ok: true as const, status: resultStatus(sources, selected.length > 0), focus,
        asOf: coverage.find(({ source }) => source === 'FORGE')?.observedAt ?? null, coverage,
        project: { key: text(project.key), name: text(project.name) },
        rows: selected.map(({ code, cells }) => ({
          code,
          fields: fieldsFor(columns.map((label, index) => ({ label, value: cells[index] ?? null }))
            .filter(({ label }) => focus !== 'hse' || ['Categoría', 'Severidad', 'Estado', 'Área', 'Fecha'].includes(label)), 8),
        })),
        evidence: typedEvidence(links, coverage, await scopedOrigin(links, jiraOrigin)),
        requestId: response.requestId,
      });
    } catch (error) {
      return failure(error instanceof NeedsAuthenticationError ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    }
  }

  async function searchProjectKnowledge(payload: unknown, context: unknown) {
    const actor = actorFrom(context);
    if (!actor) return failure('AUTH_REQUIRED');
    if (!isRecord(payload) || typeof payload.query !== 'string' || payload.query.length > 160 ||
        /[\p{Cc}\p{Cf}]/u.test(payload.query) || !payload.query.trim() ||
        (payload.source !== undefined && payload.source !== 'local' && payload.source !== 'confluence')) {
      return failure('INVALID_REFERENCE');
    }

    try {
      const projectId = await resolveProject(projectSelector(payload));
      if (!projectId) return failure('INVALID_REFERENCE');
      const scoped = rovoProjectContext(actor, projectId);
      const response = await read.list({ context: scoped, payload: { section: 'knowledge' } });
      if (!response.ok) return boundaryFailure(response.error.code);
      const coverage = sourceData(response.data.sources);
      const asOf = coverage.find(({ source }) => source === 'FORGE')?.observedAt ?? null;
      if (payload.source === 'confluence') {
        return { ok: true as const, status: 'SOURCE_DISABLED' as const, asOf,
          coverage, evidence: [], requestId: response.requestId };
      }

      const query = searchText(payload.query.trim().replace(/\s+/g, ' '));
      const matches = response.data.rows.filter(({ code, cells }) =>
        recordCode.test(code) && [code, ...cells].some((cell) => cell !== null && searchText(cell).includes(query)),
      ).slice(0, maxResults);
      const details = await Promise.all(matches.map(({ code }) =>
        read.detail({ context: scoped, payload: { section: 'knowledge', code } })));
      const documents = details.flatMap((row, index) => {
        if (!row.ok || row.data.code !== matches[index]?.code ||
            !row.data.sources.some(({ source, state, quality }) => source === 'FORGE' && state === 'READY' && quality === 'SYNTHETIC')) {
          return [];
        }
        const { code, title, fields, links } = row.data;
        const excerpt = fields.find(({ label }) => label === 'Referencia sintética')?.value;
        const version = fields.find(({ label }) => label === 'Versión')?.value;
        const date = fields.find(({ label }) => label === 'Fecha verificada')?.value;
        return [{ sourceId: code, title: text(title), excerpt: excerpt ? text(excerpt, 300) : null,
          version: version ? text(version, 80) : null, verifiedDate: isDateOnly(date) ? date : null, links }];
      });
      const links = documents.flatMap(({ links }) => links);
      const jiraEvidence = typedEvidence(links, coverage, await scopedOrigin(links, jiraOrigin)).slice(0, maxEvidence - documents.length);
      return bounded({
        ok: true as const,
        status: details.length !== documents.length ? 'PARTIAL' as const : resultStatus(response.data.sources, documents.length > 0),
        source: 'SYNTHETIC_DEMO' as const, asOf, coverage,
        documents: documents.map(({ sourceId, title, excerpt, version, verifiedDate }) => ({ sourceId, title, excerpt, version, verifiedDate })),
        evidence: [...documents.map(({ sourceId, title }) => ({
          sourceType: 'FORGE', sourceId, label: title, observedAt: asOf,
        })), ...jiraEvidence],
        requestId: response.requestId,
      });
    } catch (error) {
      return failure(error instanceof NeedsAuthenticationError ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    }
  }

  return { readOperationalExposure, searchProjectKnowledge };
}

export const { readOperationalExposure, searchProjectKnowledge } = createOperationsEvidence();

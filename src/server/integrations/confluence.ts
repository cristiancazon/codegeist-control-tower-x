import { NeedsAuthenticationError } from '@forge/api';
import { readDemoActor } from '../data/bootstrap/demo-access';
import { JiraBoundaryError, type JiraProjectAdapter } from '../data/jira';
import { isDateOnly, isJiraId, isRecord } from '../data/jira/normalize';
import type { getProjectAccess } from '../data/sql/projects';

type PageReference = { pageId: string; phaseCode?: string; subjectCode?: string };
type Settings = { enabled?: string; cloudId?: string; jiraProjectId?: string; spaceId?: string; pageIndex?: string };
type InstallationContext = { cloudId?: string; toString(): string };
type Runtime = { installation?: { contexts: readonly InstallationContext[] } };
type Response = { status: number; headers?: { get(name: string): string | null }; text(): Promise<string> };
type Jira = Pick<JiraProjectAdapter, 'projectId' | 'assertBrowsePermission'>;
type Dependencies = {
  settings(): Settings;
  runtime(): Runtime;
  jira(context: unknown): Jira;
  access: typeof getProjectAccess;
  requestPage(pageId: string, signal: AbortSignal): Promise<Response>;
  now(): Date;
};

export type ConfluenceFilters = { query?: string; phaseCode?: string; pageId?: string };
export type ConfluenceKnowledgeState = 'READY' | 'EMPTY' | 'PARTIAL' | 'DISABLED' | 'UNAVAILABLE';
type Reason = 'NOT_CONFIGURED' | 'OUTSIDE_SCOPE' | 'PRODUCT_NOT_CONNECTED' | 'INVALID_CONFIGURATION' |
  'SOURCE_AUTH_REQUIRED' | 'SOURCE_UNAVAILABLE' | 'RATE_LIMITED' | 'AUTH_REQUIRED' | 'NOT_AVAILABLE' | 'INVALID_REFERENCE';
export type ConfluenceCapability = {
  source: 'CONFLUENCE'; state: ConfluenceKnowledgeState; observedAt: string | null;
  reason: Reason | null; retryAfterSeconds?: number;
};
export type ConfluenceDocument = {
  sourceType: 'CONFLUENCE'; quality: 'LIVE'; sourceId: string; title: string; excerpt: string | null;
  contentTrust: 'UNTRUSTED_SOURCE_TEXT'; phaseCode: string | null; version: number; updatedAt: string;
  observedAt: string; url: string;
};
export type ConfluenceKnowledgeResult = ConfluenceCapability & { documents: ConfluenceDocument[] };

const phasePattern = /^[A-Z0-9-]{1,24}$/;
const subjectPattern = /^[A-Z0-9_-]{1,40}$/;
const cloudPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const pagePattern = /^[1-9][0-9]{0,18}$/;
const maxPages = 12;
const maxResults = 5;
const maxResponseBytes = 192 * 1024;
const batchSize = 3;
const requestTimeout = 3_000;
const searchTimeout = 8_000;
const contentNodes = new Set(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote']);

function isId(value: unknown): value is string {
  return typeof value === 'string' && pagePattern.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

function readSettings(settings: Settings) {
  const { cloudId, jiraProjectId, spaceId, pageIndex } = settings;
  if (!cloudId || !cloudPattern.test(cloudId) || !isJiraId(jiraProjectId) || !isId(spaceId) ||
      typeof pageIndex !== 'string' || Buffer.byteLength(pageIndex) > 8192) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(pageIndex);
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxPages) return undefined;
  const pages: PageReference[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'pageId' && key !== 'phaseCode' && key !== 'subjectCode') ||
        !isId(value.pageId) || ids.has(value.pageId) ||
        (value.phaseCode !== undefined && (typeof value.phaseCode !== 'string' || !phasePattern.test(value.phaseCode))) ||
        (value.subjectCode !== undefined && (typeof value.subjectCode !== 'string' || !subjectPattern.test(value.subjectCode)))) {
      return undefined;
    }
    pages.push({ pageId: value.pageId, phaseCode: value.phaseCode, subjectCode: value.subjectCode });
    ids.add(value.pageId);
  }
  return { cloudId, jiraProjectId, spaceId, pages };
}

function textOf(value: unknown, limit: number) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text ? Array.from(text).slice(0, limit).join('') : null;
}

function searchText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-AR');
}

export function readConfluenceFilters(input: Record<string, unknown>): ConfluenceFilters | undefined {
  const { query, phaseCode, pageId } = input;
  if ((query !== undefined && (typeof query !== 'string' || query.length > 160 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(query) || !query.trim())) ||
      (phaseCode !== undefined && (typeof phaseCode !== 'string' || !phasePattern.test(phaseCode))) ||
      (pageId !== undefined && !isId(pageId))) return undefined;
  return { query: typeof query === 'string' ? textOf(query, 160) ?? undefined : undefined, phaseCode, pageId };
}

function siteProducts(runtime: Runtime, cloudId: string) {
  const products = new Set<string>();
  for (const entry of runtime.installation?.contexts ?? []) {
    const product = /^ari:cloud:(jira|confluence):/.exec(entry.toString())?.[1];
    if (!product) continue;
    if (entry.cloudId !== cloudId) return new Set<string>();
    products.add(product);
  }
  return products;
}

function versionTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !isDateOnly(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function excerptFrom(body: unknown) {
  if (!isRecord(body) || !isRecord(body.atlas_doc_format)) return null;
  const value = body.atlas_doc_format.value;
  if (typeof value !== 'string' || value.length > maxResponseBytes) return null;
  let document: unknown;
  try {
    document = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(document) || document.type !== 'doc') return null;
  const fragments: string[] = [];
  let nodes = 0;
  let length = 0;
  function visit(node: unknown, depth: number) {
    if (depth > 8 || nodes >= 128 || length >= 320 || !isRecord(node) || typeof node.type !== 'string') return;
    nodes += 1;
    if (node.type === 'text' && typeof node.text === 'string') {
      const fragment = node.text.slice(0, 320 - length);
      fragments.push(fragment);
      length += fragment.length;
    } else if (contentNodes.has(node.type) && Array.isArray(node.content)) {
      for (const child of node.content.slice(0, 128)) visit(child, depth + 1);
    }
  }
  visit(document, 0);
  return textOf(fragments.join(' '), 320);
}

function status(state: ConfluenceKnowledgeState, reason: Reason | null, observedAt: string | null = null,
  retryAfterSeconds?: number): ConfluenceCapability {
  return { source: 'CONFLUENCE', state, reason, observedAt, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
}

function retryAfter(response: Response, now: Date) {
  const value = response.headers?.get('Retry-After');
  if (!value) return undefined;
  if (/^\d{1,9}$/.test(value)) return Number(value);
  if (!/^[A-Z][a-z]{2}, \d\d [A-Z][a-z]{2} \d{4} \d\d:\d\d:\d\d GMT$/.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
  return Math.max(0, Math.ceil((Date.parse(value) - now.valueOf()) / 1000));
}

type PageRead = { kind: 'visible'; document: ConfluenceDocument } | { kind: 'hidden' } |
  { kind: 'failed'; reason: 'SOURCE_AUTH_REQUIRED' | 'SOURCE_UNAVAILABLE' | 'RATE_LIMITED'; retryAfterSeconds?: number };

export function createConfluenceKnowledge(dependencies: Dependencies) {
  async function readPage(reference: PageReference, spaceId: string, signal: AbortSignal): Promise<PageRead> {
    try {
      const response = await dependencies.requestPage(reference.pageId, signal);
      if (response.status === 403 || response.status === 404) return { kind: 'hidden' };
      if (response.status === 401) return { kind: 'failed', reason: 'SOURCE_AUTH_REQUIRED' };
      if (response.status === 429) return { kind: 'failed', reason: 'RATE_LIMITED', retryAfterSeconds: retryAfter(response, dependencies.now()) };
      const contentLength = response.headers?.get('content-length');
      if (response.status !== 200 || (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes)) {
        return { kind: 'failed', reason: 'SOURCE_UNAVAILABLE' };
      }
      const serialized = await response.text();
      if (Buffer.byteLength(serialized) > maxResponseBytes) return { kind: 'failed', reason: 'SOURCE_UNAVAILABLE' };
      const page: unknown = JSON.parse(serialized);
      if (!isRecord(page) || !isId(page.id) || !isId(page.spaceId) || typeof page.status !== 'string') {
        return { kind: 'failed', reason: 'SOURCE_UNAVAILABLE' };
      }
      if (page.id !== reference.pageId || page.spaceId !== spaceId || page.status !== 'current') return { kind: 'hidden' };
      const title = textOf(page.title, 160);
      const version = isRecord(page.version) ? page.version.number : undefined;
      const updatedAt = isRecord(page.version) ? versionTime(page.version.createdAt) : null;
      if (!title || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || !updatedAt) {
        return { kind: 'failed', reason: 'SOURCE_UNAVAILABLE' };
      }
      return { kind: 'visible', document: { sourceType: 'CONFLUENCE', quality: 'LIVE', sourceId: reference.pageId, title,
        excerpt: excerptFrom(page.body), contentTrust: 'UNTRUSTED_SOURCE_TEXT', phaseCode: reference.phaseCode ?? null,
        version, updatedAt, observedAt: dependencies.now().toISOString(), url: `/wiki/pages/viewpage.action?pageId=${reference.pageId}` } };
    } catch (error) {
      return { kind: 'failed', reason: error instanceof NeedsAuthenticationError ? 'SOURCE_AUTH_REQUIRED' : 'SOURCE_UNAVAILABLE' };
    }
  }

  async function search(context: unknown, filters: ConfluenceFilters = {}, probe = false): Promise<ConfluenceKnowledgeResult> {
    const finish = (decision: ConfluenceCapability, documents: ConfluenceDocument[] = []) => ({ ...decision, documents });
    try {
      const actor = readDemoActor(context);
      if (!actor) return finish(status('UNAVAILABLE', 'AUTH_REQUIRED'));
      const jira = dependencies.jira(context);
      await jira.assertBrowsePermission();
      const access = await dependencies.access(jira.projectId, actor);
      if (!access?.roles.some((role) => role !== 'HSE_READER')) return finish(status('UNAVAILABLE', 'NOT_AVAILABLE'));
      const settings = dependencies.settings();
      if (settings.enabled !== 'true') return finish(status('DISABLED', 'NOT_CONFIGURED'));
      const config = readSettings(settings);
      if (!config) return finish(status('UNAVAILABLE', 'INVALID_CONFIGURATION'));
      if (jira.projectId !== config.jiraProjectId) return finish(status('DISABLED', 'OUTSIDE_SCOPE'));
      const products = siteProducts(dependencies.runtime(), config.cloudId);
      if (!products.has('jira')) return finish(status('DISABLED', 'OUTSIDE_SCOPE'));
      if (!products.has('confluence')) return finish(status('DISABLED', 'PRODUCT_NOT_CONNECTED'));
      const candidates = probe ? config.pages.slice(0, 1) : config.pages.filter(({ phaseCode, pageId }) =>
        (filters.phaseCode === undefined || filters.phaseCode === phaseCode) && (filters.pageId === undefined || filters.pageId === pageId));
      const query = filters.query ? searchText(filters.query) : null;
      const searchSignal = AbortSignal.timeout(searchTimeout);
      const documents: ConfluenceDocument[] = [];
      const failures: Array<Extract<PageRead, { kind: 'failed' }>> = [];
      let observedAt: string | null = null;
      for (let start = 0; start < candidates.length && documents.length < maxResults; start += batchSize) {
        const batch = candidates.slice(start, start + batchSize);
        const signal = AbortSignal.any([searchSignal, AbortSignal.timeout(requestTimeout)]);
        const results = await Promise.all(batch.map((item) => readPage(item, config.spaceId, signal)));
        for (const [index, result] of results.entries()) {
          if (result.kind === 'failed') failures.push(result);
          if (result.kind !== 'visible') continue;
          observedAt = result.document.observedAt;
          if (!query || searchText(result.document.title).includes(query) ||
              searchText(batch[index]?.subjectCode ?? '').includes(query)) documents.push(result.document);
        }
        if (failures.some(({ reason }) => reason === 'RATE_LIMITED' || reason === 'SOURCE_AUTH_REQUIRED')) break;
        if (searchSignal.aborted && start + batchSize < candidates.length) {
          failures.push({ kind: 'failed', reason: 'SOURCE_UNAVAILABLE' });
          break;
        }
      }
      if (!failures.length) return finish(status(documents.length ? 'READY' : 'EMPTY', null, observedAt), documents.slice(0, maxResults));
      const throttled = failures.filter(({ reason }) => reason === 'RATE_LIMITED');
      const retry = throttled.flatMap(({ retryAfterSeconds }) => retryAfterSeconds === undefined ? [] : [retryAfterSeconds]);
      const reason = throttled.length ? 'RATE_LIMITED'
        : failures.some(({ reason }) => reason === 'SOURCE_AUTH_REQUIRED') ? 'SOURCE_AUTH_REQUIRED' : 'SOURCE_UNAVAILABLE';
      return finish(status(observedAt ? 'PARTIAL' : 'UNAVAILABLE', reason, observedAt, retry.length ? Math.max(...retry) : undefined),
        documents.slice(0, maxResults));
    } catch (error) {
      if (error instanceof NeedsAuthenticationError || (error instanceof JiraBoundaryError && error.code === 'AUTH_REQUIRED')) {
        return finish(status('UNAVAILABLE', 'AUTH_REQUIRED'));
      }
      if (error instanceof JiraBoundaryError && error.code === 'FORBIDDEN') return finish(status('UNAVAILABLE', 'NOT_AVAILABLE'));
      if (error instanceof JiraBoundaryError && error.code === 'RATE_LIMITED') {
        return finish(status('UNAVAILABLE', 'RATE_LIMITED', null, error.retryAfterSeconds));
      }
      return finish(status('UNAVAILABLE', 'SOURCE_UNAVAILABLE'));
    }
  }

  return {
    search,
    async probe(context: unknown): Promise<ConfluenceCapability> {
      const { source, state, reason, observedAt, retryAfterSeconds } = await search(context, {}, true);
      return { source, state, reason, observedAt, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
    },
  };
}

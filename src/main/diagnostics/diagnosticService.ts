import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  DIAGNOSTIC_BYTE_LIMIT,
  DIAGNOSTIC_EVENT_BYTE_LIMIT,
  DIAGNOSTIC_EVENT_LIMIT,
  diagnosticContextSchema,
  diagnosticEventInputSchema,
  type DiagnosticBufferStats,
  type DiagnosticContext,
  type DiagnosticEvent,
  type DiagnosticEventInput,
  type DiagnosticInspectInput,
  type DiagnosticInspectResult,
  type DiagnosticInstance,
  type DiagnosticLevel,
  type DiagnosticProvider,
  type DiagnosticSnapshot,
  type DiagnosticSource,
  type DiagnosticValue,
} from '../../shared/diagnostics';

const DEVELOPMENT_PROVIDERS = new Set<DiagnosticProvider>([
  'caches',
  'journal',
  'renderer',
  'scenes',
]);
const SECRET_KEY = /(?:auth|credential|hash|key|password|private|secret|token)/i;
const MAX_VALUE_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 1_000;

type Provider = (
  input: DiagnosticInspectInput,
) => unknown | Promise<unknown>;

interface DiagnosticServiceOptions {
  development: boolean;
  instance: Omit<DiagnosticInstance, 'id' | 'startedAt'> & {
    id?: string;
    startedAt?: string;
  };
  redactRoots?: string[];
}

function emptyDiscarded(): Record<DiagnosticLevel, number> {
  return { debug: 0, error: 0, info: 0, warn: 0 };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): DiagnosticValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value);
  }
  if (typeof value === 'undefined') return '[undefined]';
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (depth >= MAX_VALUE_DEPTH) return '[maximum depth reached]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_COLLECTION_ENTRIES)
      .map((entry) => normalizeValue(entry, depth + 1, seen));
    if (value.length > result.length) {
      result.push(`[${value.length - result.length} entries omitted]`);
    }
    return result;
  }
  const result: Record<string, DiagnosticValue> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, entry] of entries.slice(0, MAX_COLLECTION_ENTRIES)) {
    result[key] = SECRET_KEY.test(key)
      ? '[redacted]'
      : normalizeValue(entry, depth + 1, seen);
  }
  if (entries.length > MAX_COLLECTION_ENTRIES) {
    result['[omitted]'] = `${entries.length - MAX_COLLECTION_ENTRIES} entries`;
  }
  return result;
}

export class DiagnosticService extends EventEmitter {
  private bytes = 0;
  private readonly context: DiagnosticContext = { screen: 'connection' };
  private readonly development: boolean;
  private readonly discarded = emptyDiscarded();
  private readonly events: Array<{ bytes: number; event: DiagnosticEvent }> = [];
  private readonly instance: DiagnosticInstance;
  private nextId = 1;
  private readonly providers = new Map<DiagnosticProvider, Provider>();
  private readonly redactRoots: string[];
  private truncated = 0;

  constructor({ development, instance, redactRoots = [] }: DiagnosticServiceOptions) {
    super();
    this.development = development;
    this.instance = {
      ...instance,
      id: instance.id ?? randomUUID(),
      startedAt: instance.startedAt ?? new Date().toISOString(),
    };
    this.redactRoots = redactRoots
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    this.registerBuiltInProviders();
  }

  get capabilities() {
    return {
      development: this.development,
      providers: [...this.providers.keys()].filter(
        (provider) => this.development || !DEVELOPMENT_PROVIDERS.has(provider),
      ),
    };
  }

  clear(): void {
    this.events.splice(0);
    this.bytes = 0;
    this.truncated = 0;
    Object.assign(this.discarded, emptyDiscarded());
  }

  inspect(input: DiagnosticInspectInput): Promise<DiagnosticInspectResult> {
    if (!this.development && DEVELOPMENT_PROVIDERS.has(input.provider)) {
      return Promise.reject(new Error('This diagnostic provider is development-only.'));
    }
    if (input.content && !this.development) {
      return Promise.reject(new Error('Authored diagnostic content is development-only.'));
    }
    const provider = this.providers.get(input.provider);
    if (!provider) {
      return Promise.reject(new Error('The diagnostic provider is unavailable.'));
    }
    return Promise.resolve(provider(input)).then((value) => ({
      provider: input.provider,
      value: this.sanitizeValue(normalizeValue(value)),
    }));
  }

  record(
    source: DiagnosticSource,
    input: DiagnosticEventInput,
  ): DiagnosticEvent | null {
    const parsed = diagnosticEventInputSchema.safeParse(input);
    if (!parsed.success) return null;
    let event: DiagnosticEvent = {
      ...parsed.data,
      id: this.nextId,
      occurredAt: new Date().toISOString(),
      source,
      ...(parsed.data.details
        ? { details: this.sanitizeValue(normalizeValue(parsed.data.details)) }
        : {}),
      ...(parsed.data.stack
        ? { stack: this.sanitizeText(parsed.data.stack) }
        : {}),
    };
    event.message = this.sanitizeText(event.message);
    let size = byteLength(event);
    if (size > DIAGNOSTIC_EVENT_BYTE_LIMIT) {
      this.truncated += 1;
      event = {
        ...event,
        details: '[event details truncated]',
        message: `${event.message.slice(0, 8_192)} [truncated]`,
        ...(event.stack
          ? { stack: `${event.stack.slice(0, 16_384)}\n[truncated]` }
          : {}),
      };
      size = byteLength(event);
      if (size > DIAGNOSTIC_EVENT_BYTE_LIMIT) {
        delete event.stack;
        event.message = `${event.message.slice(0, 4_096)} [truncated]`;
        size = byteLength(event);
      }
    }
    this.nextId += 1;
    this.events.push({ bytes: size, event });
    this.bytes += size;
    this.evictOverflow();
    this.emit('event', structuredClone(event));
    return event;
  }

  registerProvider(name: DiagnosticProvider, provider: Provider): () => void {
    this.providers.set(name, provider);
    return () => {
      if (this.providers.get(name) === provider) this.providers.delete(name);
    };
  }

  snapshot(): DiagnosticSnapshot {
    return {
      capabilities: this.capabilities,
      context: structuredClone(this.context),
      events: this.events.map(({ event }) => structuredClone(event)),
      instance: structuredClone(this.instance),
      stats: this.stats(),
    };
  }

  updateContext(input: unknown): void {
    const parsed = diagnosticContextSchema.safeParse(input);
    if (!parsed.success) return;
    Object.assign(this.context, parsed.data);
  }

  private evictOverflow(): void {
    while (
      this.events.length > DIAGNOSTIC_EVENT_LIMIT ||
      this.bytes > DIAGNOSTIC_BYTE_LIMIT
    ) {
      const removed = this.events.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
      this.discarded[removed.event.level] += 1;
    }
  }

  private registerBuiltInProviders(): void {
    this.registerProvider('instance', () => this.instance);
    this.registerProvider('ui', () => ({
      activeLayer: this.context.activeLayer ?? null,
      activeSceneId: this.context.activeSceneId ?? null,
      activeSceneName: this.context.activeSceneName ?? null,
      activeSidebar: this.context.activeSidebar ?? null,
      activeTool: this.context.activeTool ?? null,
      preparation: this.context.preparation ?? null,
      screen: this.context.screen ?? 'connection',
    }));
    this.registerProvider('session', () => ({
      campaignId: this.context.campaignId ?? null,
      campaignName: this.context.campaignName ?? null,
      role: this.context.role ?? null,
      runtimeKind: this.context.runtimeKind ?? null,
      systemId: this.context.systemId ?? null,
      userId: this.context.userId ?? null,
      username: this.context.username ?? null,
    }));
    this.registerProvider('network', () => ({
      clientState: this.context.clientState ?? null,
      hostState: this.context.hostState ?? null,
    }));
    this.registerProvider('campaign', () => ({
      campaignId: this.context.campaignId ?? null,
      campaignName: this.context.campaignName ?? null,
      systemId: this.context.systemId ?? null,
    }));
    this.registerProvider('persistence', () => ({
      campaignOpen: Boolean(this.context.campaignId),
      health: this.context.campaignId ? 'available' : 'not_open',
      note: 'A fresh integrity check is not registered for this runtime.',
    }));
    this.registerProvider('assets', () => ({
      preparation: this.context.preparation ?? null,
      state: this.context.campaignId ? 'campaign_open' : 'not_open',
    }));
    this.registerProvider('operations', () =>
      this.events
        .map(({ event }) => event)
        .filter(({ kind }) => kind === 'operation')
        .slice(-200),
    );
    this.registerProvider('renderer', () => ({
      state: 'reported through the renderer context provider',
    }));
    this.registerProvider('scenes', () => ({
      activeSceneId: this.context.activeSceneId ?? null,
      activeSceneName: this.context.activeSceneName ?? null,
    }));
    this.registerProvider('journal', () => ({
      state: this.context.campaignId ? 'campaign_open' : 'not_open',
    }));
    this.registerProvider('caches', () => ({
      preparation: this.context.preparation ?? null,
    }));
  }

  private sanitizeText(value: string): string {
    const withoutSecrets = value
      .replace(
        /\b(authorization|credential|password|private[_ -]?key|secret|session[_ -]?key|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        '$1=[redacted]',
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
    if (this.development) return withoutSecrets;
    return this.redactRoots.reduce(
      (text, root) => text.replaceAll(root, '[profile]'),
      withoutSecrets,
    );
  }

  private sanitizeValue(value: DiagnosticValue): DiagnosticValue {
    if (typeof value === 'string') return this.sanitizeText(value);
    if (Array.isArray(value)) {
      return value.map((entry) => this.sanitizeValue(entry));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          this.sanitizeValue(entry),
        ]),
      );
    }
    return value;
  }

  private stats(): DiagnosticBufferStats {
    return {
      bytes: this.bytes,
      discarded: { ...this.discarded },
      events: this.events.length,
      truncated: this.truncated,
    };
  }
}

import { z } from 'zod';

export const diagnosticIpcChannels = {
  changed: 'diagnostics:changed',
  clear: 'diagnostics:clear',
  inspect: 'diagnostics:inspect',
  openRequested: 'diagnostics:open-requested',
  record: 'diagnostics:record',
  snapshot: 'diagnostics:snapshot',
  updateContext: 'diagnostics:update-context',
} as const;

export const DIAGNOSTIC_EVENT_LIMIT = 10_000;
export const DIAGNOSTIC_BYTE_LIMIT = 16 * 1024 * 1024;
export const DIAGNOSTIC_EVENT_BYTE_LIMIT = 64 * 1024;

export const diagnosticLevels = ['debug', 'info', 'warn', 'error'] as const;
export type DiagnosticLevel = (typeof diagnosticLevels)[number];

export const diagnosticSources = ['main', 'renderer'] as const;
export type DiagnosticSource = (typeof diagnosticSources)[number];

export const diagnosticKinds = ['command', 'log', 'operation', 'system'] as const;
export type DiagnosticKind = (typeof diagnosticKinds)[number];

export type DiagnosticValue =
  | boolean
  | number
  | string
  | null
  | DiagnosticValue[]
  | { [key: string]: DiagnosticValue };

const diagnosticValueSchema: z.ZodType<DiagnosticValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number().finite(),
    z.string().max(DIAGNOSTIC_EVENT_BYTE_LIMIT),
    z.null(),
    z.array(diagnosticValueSchema).max(1_000),
    z.record(z.string().max(128), diagnosticValueSchema),
  ]),
);

export const diagnosticEventInputSchema = z
  .object({
    category: z.string().trim().min(1).max(64),
    details: diagnosticValueSchema.optional(),
    kind: z.enum(diagnosticKinds).default('log'),
    level: z.enum(diagnosticLevels),
    message: z.string().max(16_384),
    stack: z.string().max(DIAGNOSTIC_EVENT_BYTE_LIMIT).optional(),
  })
  .strict();

export type DiagnosticEventInput = z.input<typeof diagnosticEventInputSchema>;

export interface DiagnosticEvent {
  category: string;
  details?: DiagnosticValue;
  id: number;
  kind: DiagnosticKind;
  level: DiagnosticLevel;
  message: string;
  occurredAt: string;
  source: DiagnosticSource;
  stack?: string;
}

export const diagnosticContextSchema = z
  .object({
    activeLayer: z.string().max(64).nullable().optional(),
    activeSceneId: z.string().max(128).nullable().optional(),
    activeSceneName: z.string().max(256).nullable().optional(),
    activeSidebar: z.string().max(64).nullable().optional(),
    activeTool: z.string().max(64).nullable().optional(),
    campaignId: z.string().max(128).nullable().optional(),
    campaignName: z.string().max(256).nullable().optional(),
    clientState: z.string().max(64).nullable().optional(),
    hostState: z.string().max(64).nullable().optional(),
    preparation: z.string().max(256).nullable().optional(),
    role: z.enum(['gm', 'player']).nullable().optional(),
    runtimeKind: z.enum(['joined', 'local']).nullable().optional(),
    screen: z.enum(['connection', 'play']).optional(),
    systemId: z.string().max(128).nullable().optional(),
    userId: z.string().max(128).nullable().optional(),
    username: z.string().max(256).nullable().optional(),
  })
  .strict();

export type DiagnosticContext = z.infer<typeof diagnosticContextSchema>;

export const diagnosticProviders = [
  'assets',
  'caches',
  'campaign',
  'instance',
  'journal',
  'network',
  'operations',
  'persistence',
  'renderer',
  'scenes',
  'session',
  'ui',
] as const;
export type DiagnosticProvider = (typeof diagnosticProviders)[number];

export const diagnosticInspectInputSchema = z
  .object({
    check: z.boolean().optional(),
    content: z.boolean().optional(),
    provider: z.enum(diagnosticProviders),
  })
  .strict();

export type DiagnosticInspectInput = z.infer<
  typeof diagnosticInspectInputSchema
>;

export interface DiagnosticCapabilities {
  development: boolean;
  providers: DiagnosticProvider[];
}

export interface DiagnosticBufferStats {
  bytes: number;
  discarded: Record<DiagnosticLevel, number>;
  events: number;
  truncated: number;
}

export interface DiagnosticInstance {
  appVersion: string;
  electronVersion: string;
  environment: 'development' | 'production' | 'test';
  id: string;
  label: string;
  platform: string;
  processId: number;
  profileKind: 'persistent' | 'production' | 'temporary' | 'test';
  startedAt: string;
}

export interface DiagnosticSnapshot {
  capabilities: DiagnosticCapabilities;
  context: DiagnosticContext;
  events: DiagnosticEvent[];
  instance: DiagnosticInstance;
  stats: DiagnosticBufferStats;
}

export interface DiagnosticInspectResult {
  provider: DiagnosticProvider;
  value: DiagnosticValue;
}

export interface DiagnosticsApi {
  clear(): Promise<void>;
  inspect(input: DiagnosticInspectInput): Promise<DiagnosticInspectResult>;
  onChanged(listener: (event: DiagnosticEvent) => void): () => void;
  onOpenRequested(listener: () => void): () => void;
  record(input: DiagnosticEventInput): void;
  snapshot(): Promise<DiagnosticSnapshot>;
  updateContext(context: DiagnosticContext): void;
}

import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import {
  diagnosticContextSchema,
  diagnosticEventInputSchema,
  diagnosticInspectInputSchema,
  diagnosticIpcChannels,
} from '../../shared/diagnostics';
import type { DiagnosticService } from './diagnosticService';

const RENDERER_EVENTS_PER_SECOND = 200;

interface SenderRate {
  count: number;
  startedAt: number;
}

export function registerDiagnosticIpcHandlers(
  ipc: IpcMain,
  service: DiagnosticService,
  getMainContents: () => WebContents | null,
) {
  const rates = new Map<number, SenderRate>();
  const allowed = (sender: WebContents) => sender === getMainContents();
  const withinRate = (sender: WebContents) => {
    const now = Date.now();
    const current = rates.get(sender.id);
    if (!current || now - current.startedAt >= 1_000) {
      rates.set(sender.id, { count: 1, startedAt: now });
      return true;
    }
    current.count += 1;
    return current.count <= RENDERER_EVENTS_PER_SECOND;
  };
  const handleClear = (event: IpcMainInvokeEvent) => {
    if (!allowed(event.sender)) return;
    service.clear();
  };
  const handleInspect = (event: IpcMainInvokeEvent, input: unknown) => {
    if (!allowed(event.sender)) throw new Error('Diagnostic access is denied.');
    const parsed = diagnosticInspectInputSchema.safeParse(input);
    if (!parsed.success) throw new Error('The diagnostic request is invalid.');
    return service.inspect(parsed.data);
  };
  const handleRecord = (event: IpcMainEvent, input: unknown) => {
    if (!allowed(event.sender) || !withinRate(event.sender)) return;
    const parsed = diagnosticEventInputSchema.safeParse(input);
    if (parsed.success) service.record('renderer', parsed.data);
  };
  const handleSnapshot = (event: IpcMainInvokeEvent) => {
    if (!allowed(event.sender)) throw new Error('Diagnostic access is denied.');
    return service.snapshot();
  };
  const handleUpdateContext = (event: IpcMainEvent, input: unknown) => {
    if (!allowed(event.sender) || !withinRate(event.sender)) return;
    const parsed = diagnosticContextSchema.safeParse(input);
    if (parsed.success) service.updateContext(parsed.data);
  };
  const sendEvent = (event: unknown) => {
    const contents = getMainContents();
    if (contents && !contents.isDestroyed()) {
      contents.send(diagnosticIpcChannels.changed, event);
    }
  };

  for (const channel of [
    diagnosticIpcChannels.clear,
    diagnosticIpcChannels.inspect,
    diagnosticIpcChannels.snapshot,
  ]) {
    ipc.removeHandler(channel);
  }
  ipc.handle(diagnosticIpcChannels.clear, handleClear);
  ipc.handle(diagnosticIpcChannels.inspect, handleInspect);
  ipc.handle(diagnosticIpcChannels.snapshot, handleSnapshot);
  ipc.on(diagnosticIpcChannels.record, handleRecord);
  ipc.on(diagnosticIpcChannels.updateContext, handleUpdateContext);
  service.on('event', sendEvent);

  return () => {
    ipc.removeHandler(diagnosticIpcChannels.clear);
    ipc.removeHandler(diagnosticIpcChannels.inspect);
    ipc.removeHandler(diagnosticIpcChannels.snapshot);
    ipc.removeListener(diagnosticIpcChannels.record, handleRecord);
    ipc.removeListener(
      diagnosticIpcChannels.updateContext,
      handleUpdateContext,
    );
    service.off('event', sendEvent);
  };
}


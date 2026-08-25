import type { IpcRenderer, IpcRendererEvent } from 'electron';
import {
  diagnosticIpcChannels,
  type DiagnosticEvent,
  type DiagnosticsApi,
} from '../shared/diagnostics';

export function createDiagnosticsApi(ipc: IpcRenderer): DiagnosticsApi {
  const openListeners = new Set<() => void>();
  let pendingOpenRequest = false;

  ipc.on(diagnosticIpcChannels.openRequested, () => {
    if (openListeners.size === 0) {
      pendingOpenRequest = true;
      return;
    }

    for (const listener of openListeners) {
      listener();
    }
  });

  return {
    clear: () => ipc.invoke(diagnosticIpcChannels.clear) as Promise<void>,
    inspect: (input) =>
      ipc.invoke(diagnosticIpcChannels.inspect, input) as ReturnType<
        DiagnosticsApi['inspect']
      >,
    onChanged: (listener) => {
      const wrapped = (_event: IpcRendererEvent, value: unknown) => {
        listener(value as DiagnosticEvent);
      };
      ipc.on(diagnosticIpcChannels.changed, wrapped);
      return () => ipc.removeListener(diagnosticIpcChannels.changed, wrapped);
    },
    onOpenRequested: (listener) => {
      openListeners.add(listener);
      if (pendingOpenRequest) {
        pendingOpenRequest = false;
        queueMicrotask(listener);
      }
      return () => openListeners.delete(listener);
    },
    record: (input) => ipc.send(diagnosticIpcChannels.record, input),
    snapshot: () =>
      ipc.invoke(diagnosticIpcChannels.snapshot) as ReturnType<
        DiagnosticsApi['snapshot']
      >,
    updateContext: (context) =>
      ipc.send(diagnosticIpcChannels.updateContext, context),
  };
}

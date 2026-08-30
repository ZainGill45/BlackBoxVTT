import { ref } from "vue";

export const uiLogs = ref<LogEntry[]>([]);

export const log = (content: string, type: 'info' | 'warning' | 'error' = 'info'): void => {
    window.electronAPI.requestLogUpdate(content, type);
}
export const initializeLogger = (): void => {
    window.electronAPI.onLogAdded((newLog: LogEntry) => uiLogs.value.push(newLog));
}
import { Log } from '../shared/types/log'
import { ref } from "vue";

export const uiLogs = ref<Log[]>([]);

export const log = (content: string, type: 'info' | 'warning' | 'error' = 'info'): void => {
    window.electronAPI.requestLogUpdate(content, type);
}
export const initializeLogger = (): void => {
    window.electronAPI.onLogAdded((newLog: Log) => uiLogs.value.push(newLog));
}

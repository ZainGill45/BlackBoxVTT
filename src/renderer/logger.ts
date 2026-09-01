import { Log } from '../shared/types/Log'
import { ref } from "vue";

const logRetentionCount = 512;

export const logs = ref<Log[]>([]);

export const log = (content: string, type: 'info' | 'warning' | 'error' = 'info'): void => {
    window.electronAPI.requestLogUpdate(content, type);
}
export const initializeLogger = (): void => {
  window.electronAPI.onLogAdded((newLog: Log) => {
    logs.value.push(newLog);

    if (logs.value.length > logRetentionCount) {
      logs.value.shift();
    }
  });
}

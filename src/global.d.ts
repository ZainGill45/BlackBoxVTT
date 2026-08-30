import { Log } from './shared/types/log'

declare global {
    interface Window {
        electronAPI: {
            requestApplicationExit: () => Promise<void>;
            requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => Promise<void>;
            onLogAdded: (callBack: (log: Log) => void) => void;
        };
    }
}

export { };

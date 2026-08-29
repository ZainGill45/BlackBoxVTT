declare global {
    interface LogEntry {
        id: number,
        content: string,
        type: 'info' | 'warning' | 'error',
        timestamp: string,
    }
}

declare global {
    interface Window {
        electronAPI: {
            requestApplicationExit: () => Promise<void>;
            requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => Promise<void>;
            onLogAdded: (callBack: (log: LogEntry) => void) => void;
        };
    }
}

export { };
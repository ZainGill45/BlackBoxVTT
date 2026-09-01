import { Log } from '../shared/types/Log'

const logs: Log[] = [];
const logRetentionCount = 512;

let logCallback: ((log: Log) => void) | undefined;
let logID = 0;

export const onLogCreated = (callback: (log: Log) => void): void => {
    logCallback = callback;
};

export const log = (content: unknown, type: 'info' | 'warning' | 'error' = 'info'): void => {
  const options: Intl.DateTimeFormatOptions = { hour12: false };

  let sanitizedContent: string;

  if (typeof content === 'string') {
    sanitizedContent = content;
  } else if (content instanceof Error) {
    sanitizedContent = content.message;
  } else if (content && typeof content === 'object' && 'message' in content) {
    sanitizedContent = String((content as any).message);
  } else {
    sanitizedContent = String(content);
  }

  const newLog: Log = {
    id: logID++,
    content: sanitizedContent,
    type: type,
    timestamp: new Date().toLocaleTimeString(undefined, options)
  }

  logs.push(newLog);

  if (logs.length > logRetentionCount) {
    logs.shift();
  }

  if (logCallback) {
    logCallback(newLog);
  }
};

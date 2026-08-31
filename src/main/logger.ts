import { Log } from '../shared/types/Log'

const logs: Log[] = [];

let logCallback: ((log: Log) => void) | undefined;
let logID = 0;

export const onLogCreated = (callback: (log: Log) => void): void => {
    logCallback = callback;
};

export const log = (content: string, type: 'info' | 'warning' | 'error' = 'info'): void => {
  const options: Intl.DateTimeFormatOptions = { hour12: false };
  const newLog: Log = {
      id: logID++,
      content: content,
      type: type,
      timestamp: new Date().toLocaleTimeString(undefined, options)
  }

  logs.push(newLog);

  if (logCallback)
    logCallback(newLog);
};

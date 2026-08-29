import { mainWindow } from "./main";

const logs: LogEntry[] = [];

export const log = (content: string, type: 'info' | 'warning' | 'error' = 'info'): void => {
    const options: Intl.DateTimeFormatOptions = { hour12: false };

    const newLog: LogEntry = {
        id: logs.length + 1,
        content: content,
        type: type,
        timestamp: new Date().toLocaleTimeString(undefined, options)
    }

    logs.push(newLog)

    if (mainWindow)
        mainWindow.webContents.send('new-log-added', newLog)
};
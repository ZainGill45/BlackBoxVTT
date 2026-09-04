import type { LogType } from "./LogType";

export interface Log {
  id: number;
  content: string;
  type: LogType;
  timestamp: string;
}

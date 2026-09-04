import { LogType } from "../shared/types/LogType";
import { Log } from "../shared/types/Log";
import { ref } from "vue";

const logRetentionCount = 512;

export const logs = ref<Log[]>([]);

export const log = (content: unknown, type: LogType = "info"): void => {
  const options: Intl.DateTimeFormatOptions = { hour12: false };

  let sanitizedContent: string;

  if (typeof content === "string") {
    sanitizedContent = content;
  } else if (content instanceof Error) {
    sanitizedContent = content.message;
  } else if (content && typeof content === "object" && "message" in content) {
    sanitizedContent = String(content.message);
  } else {
    sanitizedContent = String(content);
  }

  const newLog: Log = {
    id: Date.now(),
    content: sanitizedContent,
    type: type,
    timestamp: new Date().toLocaleTimeString(undefined, options),
  };

  logs.value.push(newLog);

  if (logs.value.length > logRetentionCount) {
    logs.value.shift();
  }
};

import { createApp, ref } from "vue";
import App from "./App.vue";
import "./styles.css";

export const uiLogs = ref<LogEntry[]>([]);
window.electronAPI.onLogAdded((newLog: LogEntry) => uiLogs.value.push(newLog));

createApp(App).mount("#app");
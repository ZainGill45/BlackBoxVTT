import { updateGameEntries, ensureFileSystemStructure } from "./gameEntryController.js";
import { initializeLogger } from "./logger.js";
import { createApp } from "vue";

import App from "./Templates/App.vue";

import "./styles.css";

initializeLogger();
createApp(App).mount("#app");

await ensureFileSystemStructure();
await updateGameEntries();

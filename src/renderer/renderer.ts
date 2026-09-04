import { updateGameEntries, ensureFileSystemStructure } from "./gameEntryController.js";
import { initializeStartUp } from "./gameInitializationController.js";
import { createApp } from "vue";

import App from "./templates/App.vue";

import "./styles.css";

createApp(App).mount("#app");

await ensureFileSystemStructure();
await updateGameEntries();
await initializeStartUp();
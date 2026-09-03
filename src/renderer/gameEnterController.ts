import { Game } from "../shared/schemas/game";
import { log } from "./logger";
import { ref } from "vue";

export type AppState = "connection" | "loading" | "game";

export let currentAppState = ref<AppState>("connection");

export const loadGame = (game: Game) => {
  log(`Loading game: ${game.name} (${game.uuid})`);

  currentAppState.value = "loading";

  setTimeout(() => {
    currentAppState.value = "game";
  }, 1000);
};

export const exitGame = () => {
  log(`Exiting game...`);

  currentAppState.value = "loading";

  setTimeout(() => {
    currentAppState.value = "connection";
  }, 1000);
};

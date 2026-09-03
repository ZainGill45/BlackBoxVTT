import { Game } from "../shared/schemas/game";
import { log } from "./logger";
import { ref } from "vue";

export let showFullScreenLoader = ref(false);
export let showConnectionPanel = ref(true);
export let showGameContainer = ref(false);

export const loadGame = (game: Game) => {
  log(`Loading game: ${game.name} (${game.uuid})`);

  showConnectionPanel.value = false;
  showFullScreenLoader.value = true;

  setTimeout(() => {
    showFullScreenLoader.value = false;
    showGameContainer.value = true;
  }, 1000);
}

export const exitGame = () => {
  log(`Exiting game...`);

  showGameContainer.value = false;
  showFullScreenLoader.value = true;

  setTimeout(() => {
    showFullScreenLoader.value = false;
    showConnectionPanel.value = true;
  }, 1000);
}
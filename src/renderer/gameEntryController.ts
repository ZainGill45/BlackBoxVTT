import { GameNameSchema } from "../shared/schemas/game";
import { toast } from "./toast";
import { log } from "./logger";
import { ref } from "vue";

export interface UIGameEntry {
  id: number;
  name: string;
  gameSizeMB: number;
}

let gameID = 0;

export const gameEntries = ref<UIGameEntry[]>([]);

export const addGameEntry = async (inputName: string) => {
  log('Attempting to create a game...');

  const parsedInput = GameNameSchema.safeParse(inputName);

  if (!parsedInput.success) {
    const message = parsedInput.error.issues[0]?.message ?? 'Invalid Game name';
    log(`Unable to Create Game: ${message}`, 'warning')
    toast('Unable to Create Game', message, 'warning');
    return;
  }

  log(`Renderer side input schema validation passed for ${parsedInput.data} sending request to main process`)

  await window.electronAPI.requestCreateGame(parsedInput.data).then(() => {
    log(`Added game entry for ${inputName}`);
    toast('Game Created', `Game "${inputName}" has been created"`);
    updateGameEntries();
  }).catch((error) => {
    log(`Main game creation request rejected ${error}`, 'warning');
    toast('Unable to Create Game', error, 'warning');
  });
}

export const updateGameEntries = async () => {
  await window.electronAPI.requestGameEntryData().then((response) => {
    log(response.gameNames.toString());
    for (let i = 0; i < response.gameNames.length; i++) {
      const entryIsInUI = gameEntries.value.some((entry) => entry.name === response.gameNames[i]);

      if (entryIsInUI) {
        log(`Did not add ${response.gameNames[i]} as it's already in the gameEntries array continuing to next entry`)
        continue;
      }

      if (response.gameNames[i] !== undefined && response.gameSizesBytes[i] !== undefined) {
        const entry: UIGameEntry = {
          id: gameID++,
          name: response.gameNames[i]!,
          gameSizeMB: parseFloat((response.gameSizesBytes[i]! / 1000000).toFixed(2)),
        };

        gameEntries.value.push(entry);
        log(`Added new ui game entry: ${entry.name}`)
      }
    }
  }).catch((error) => {
    log(`Could not update ui game entries ${error}`, 'error');
    toast('Data Read Error', `Could not request game entry data ${error}"`, 'error');
  });
}

import { Game, GameSchema } from "../shared/schemas/game";
import { toast } from "./toast";
import { log } from "./logger";
import { ref } from "vue";

export const gameEntries = ref<Game[]>([]);

export const addGameEntry = async (userInput: string) => {
  log('Attempting to create a game...');

  const templateGame: Game = {
    schemaVersion: 1,
    uuid: crypto.randomUUID(),
    name: userInput,
    gameSizeBytes: 0,
  };

  const parsedGame = GameSchema.safeParse(templateGame);

  if (!parsedGame.success) {
    const message = parsedGame.error.issues[0]?.message ?? 'Invalid game schema detected';
    log(`Unable to Create Game: ${message}`, 'error')
    toast('Unable to Create Game', message, 'error');
    return;
  }

  log(`Render side schema validation passed for ${parsedGame.data} sending to main process`)

  try {
    await window.electronAPI.requestCreateGame(parsedGame.data);
    log(`Added game entry for ${userInput}`);
    toast('Game Created', `Game "${userInput}" has been created"`);
    updateGameEntries();
  } catch (error) {
    log(`Main game creation request rejected ${error}`, 'warning');
    toast('Unable to Create Game', error, 'warning');
  }
}

export const ensureFileSystemStructure = async () => {
  try {
    await window.electronAPI.requestEnsureFileSystemStructure();
  } catch (error) {
    log(`ensureFileSystemStructure: ${error}`)
  }
}

export const updateGameEntries = async () => {
  try {
    const gameEntryArrayResponse = await window.electronAPI.requestGameEntryData();

    gameEntries.value = [];
    const parsedGameEntries = [];

    for (let i = 0; i < gameEntryArrayResponse.length; i++) {
      parsedGameEntries[i] = GameSchema.safeParse(gameEntryArrayResponse[i]);

      if (!parsedGameEntries[i]?.success) {
        log('updateGameEntries: Failed to validate a schema for a given game while updating game entries array');
        toast('Operation Warning', 'Failed to validate a schema for a given game while updating game entries array', 'warning')
        continue;
      }

      const entry: Game = {
        schemaVersion: parsedGameEntries[i]?.data?.schemaVersion!,
        uuid: parsedGameEntries[i]?.data?.uuid!,
        name: parsedGameEntries[i]?.data?.name!,
        gameSizeBytes: parsedGameEntries[i]?.data?.gameSizeBytes!,
      };

      gameEntries.value.push(entry);
      log(`updateGameEntries: Added new ui game entry: ${entry.name}`)
    }

    log('updateGameEntries: successfully executed cleared and updated game entries');
  } catch (error) {
    log(`updateGameEntries: ${error}`, 'error');
    toast('Data Read Error', `Could not request game entry data ${error}"`, 'error');
  }
}

export const deleteGameEntry = async (game: Game) => {
  log('Attempting to delete game...');

  try {
    await window.electronAPI.requestDeleteGame(game);
    log(`Successfully deleted ${game.name}`);
    toast('Operation Successful', `${game.name} was successfully deleted.`);
    updateGameEntries();
  } catch (error) {
    log(`Error occured while deleting ${game.name} ${error}`)
    toast('Operation Failure', `Error occured while deleting ${game.name} ${error}`, 'error');
  }
};

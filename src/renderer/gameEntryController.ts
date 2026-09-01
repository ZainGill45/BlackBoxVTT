import { Game, GameNameSchema, GameSchema } from "../shared/schemas/game";
import { toast } from "./toast";
import { log } from "./logger";
import { ref } from "vue";

export const gameEntries = ref<Game[]>([]);

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
  try {
    const response = await window.electronAPI.requestGameEntryData();

    gameEntries.value = [];
    const parsedResponse = [];

    for (let i = 0; i < response.length; i++) {
      parsedResponse[i] = GameSchema.safeParse(response[i]);

      if (!parsedResponse[i]?.success) {
        log('Failed to validate a schema for a given game while updating game entries array');
        toast('Operation Warning', 'Failed to validate a schema for a given game while updating game entries array', 'warning')
        continue;
      }

      const entry: Game = {
        schemaVersion: parsedResponse[i]?.data?.schemaVersion!,
        uuid: parsedResponse[i]?.data?.uuid!,
        name: parsedResponse[i]?.data?.name!,
        gameSizeBytes: parsedResponse[i]?.data?.gameSizeBytes!,
      };

      gameEntries.value.push(entry);
      log(`Added new ui game entry: ${entry.name}`)
    }
  } catch (error) {
    log(`Could not update ui game entries ${error}`, 'error');
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

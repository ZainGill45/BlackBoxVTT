import { Game, GameSchema } from "../shared/schemas/game";
import { toast } from "./toast";
import { log } from "./logger";
import { ref } from "vue";

export const gameEntries = ref<Game[]>([]);

export const addGameEntry = async (userInput: string) => {
  log("Attempting to create a game...");

  const templateGame: Game = {
    schemaVersion: 1,
    uuid: crypto.randomUUID(),
    name: userInput,
    gameSizeBytes: 0,
  };

  const parsedGame = GameSchema.safeParse(templateGame);

  if (!parsedGame.success) {
    const message = parsedGame.error.issues[0]?.message ?? "Invalid game schema detected";
    throw new Error(message);
  }

  log(`Render side schema validation passed for ${parsedGame.data.name} sending to main process`);

  try {
    await window.electronAPI.requestCreateGame(parsedGame.data);
    await updateGameEntries();
  } catch (error) {
    throw error;
  }
};

export const ensureFileSystemStructure = async () => {
  try {
    await window.electronAPI.requestEnsureFileSystemStructure();
  } catch (error) {
    log(error);
  }
};

export const updateGameEntries = async () => {
  try {
    const gameEntryArrayResponse = await window.electronAPI.requestGameEntryData();

    gameEntries.value = [];
    const parsedGameEntries = [];

    for (let i = 0; i < gameEntryArrayResponse.length; i++) {
      parsedGameEntries[i] = GameSchema.safeParse(gameEntryArrayResponse[i]);

      if (!parsedGameEntries[i]?.success) {
        log("Failed to validate a schema for a given game while updating game entries array");
        toast("Operation Warning", "Failed to validate a schema for a given game while updating game entries array", "warning");
        continue;
      }

      const entry: Game = {
        schemaVersion: parsedGameEntries[i]?.data?.schemaVersion!,
        uuid: parsedGameEntries[i]?.data?.uuid!,
        name: parsedGameEntries[i]?.data?.name!,
        gameSizeBytes: parsedGameEntries[i]?.data?.gameSizeBytes!,
      };

      gameEntries.value.push(entry);
      log(`Added new ui game entry: ${entry.name}`);
    }

    log("successfully executed cleared and updated game entries");
  } catch (error) {
    log(error, "error");
    toast("Data Read Error", `Could not request game entry data ${error}"`, "error");
  }
};

export const deleteGameEntry = async (game: Game) => {
  log("Attempting to delete game...");

  try {
    await window.electronAPI.requestDeleteGame(game);
    log(`Successfully deleted ${game.name}`);
    toast("Operation Successful", `${game.name} was successfully deleted.`);
    await updateGameEntries();
  } catch (error) {
    log(`Error occured while deleting ${game.name} ${error}`);
    toast("Operation Failure", `Error occured while deleting ${game.name} ${error}`, "error");
  }
};

import { Game, GameSchema } from '../shared/schemas/game';
import { log } from './logger';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const userDataPath = path.join(app.getPath('userData'), 'userData');
const gameFolderPath = path.join(userDataPath, 'Games');
const gameEntrySubFolders = ['Scenes', 'Journal', 'Miscellaneous', 'Chat', 'Music', 'Storage'];
const baseGameFileName = 'game.json';

export const initializeNewGame = async (game: Game): Promise<void> => {
  const gameRootDirectoryPath = path.join(gameFolderPath, game.uuid);

  try {
    const rootDirectoryResponse = await fs.promises.mkdir(gameRootDirectoryPath, { recursive: true });
    log(`Successfully created new path for ${game.name} at: ${rootDirectoryResponse}`);

    for (let i = 0; i < gameEntrySubFolders.length; i++) {
      const subFolderPath = path.join(gameRootDirectoryPath, gameEntrySubFolders[i]!);
      const subfolderResponse = await fs.promises.mkdir(subFolderPath, { recursive: true });
      log(`Successfully created new path for ${game.name} at: ${subfolderResponse}`);
    }

    const gameContentJSON = JSON.stringify(game, null, 2);

    await fs.promises.writeFile(path.join(gameRootDirectoryPath, baseGameFileName), gameContentJSON, 'utf-8');
    log(`Successfully created data file for ${game.name}`);
  } catch (error) {
    try {
      await deleteGameData(game);
      log(`Game initialization failed for ${game.name}, but deleted any uncomplete data that was generated`, 'warning')
    } catch (error) {
      log(`Game initialization failed for ${game.name}, uncomplete data delation also failed stale data remains on system: ${error}`, 'error')
    }

    const rejectMessage = `Failed to initialize game ${game.name}: ${error}`;
    log(rejectMessage, 'error');
    throw new Error(rejectMessage);
  }
}

export const getAllGameEntryData = async (): Promise<Game[]> => {
  const games: Game[] = [];

  try {
    const rootGameFolderFiles = await fs.promises.readdir(gameFolderPath, { withFileTypes: true });

    for (let i = 0; i < rootGameFolderFiles.length; i++) {
      if (!rootGameFolderFiles[i]?.isDirectory()) {
        log(`Found a file in the root game folder that is not directory continuing to next file`);
        continue;
      }

      const gameDirectoryPath = path.join(gameFolderPath, rootGameFolderFiles[i]?.name!);
      const baseGameFilePath = path.join(gameDirectoryPath, baseGameFileName);

      try {
        const gameFileDataResponse = await fs.promises.readFile(baseGameFilePath, 'utf-8');

        const parsedJSONData = JSON.parse(gameFileDataResponse);
        const varifiedData = GameSchema.safeParse(parsedJSONData);

        if (!varifiedData.success) {
          log(`Could not varify base game schema for ${baseGameFilePath} continuing to next game`, 'error');
          continue;
        }

        games.push(varifiedData.data);
      } catch (error) {
        log(`Could not read ${error} continuing to next game`)
        continue;
      }
    }
  } catch (error) {
    throw error;
  }

  return games;
}

export const deleteGameData = async (game: Game): Promise<void> => {
  let rootGameFolderFiles: fs.Dirent<string>[];

  try {
    rootGameFolderFiles = await fs.promises.readdir(gameFolderPath, { withFileTypes: true });
  } catch {
    throw new Error('Error reading the files at root game folder');
  }

  for (let i = 0; i < rootGameFolderFiles.length; i++) {
    if (rootGameFolderFiles[i] === undefined || !rootGameFolderFiles[i]?.isDirectory()) {
      log('Encountered an undefinied value or non directory file in the root game folder continuing to next file', 'warning');
      continue;
    }

    if (rootGameFolderFiles[i]?.name === game.uuid) {
      log('Found folder UUID that matches game UUID deleting...');

      try {
        await fs.promises.rm(path.join(gameFolderPath, game.uuid), { recursive: true, force: true });
        log(`Deleted data directory for ${game.name}`);
        return Promise.resolve()
      } catch(error) {
        throw error;
      }
    }
  }

  return Promise.reject();
}

export const ensureFileStructure = async (): Promise<void> => {
  try {
    await fs.promises.readdir(gameFolderPath, { withFileTypes: true });
    log('ensureFileStructure: successfully read from gameFolderPath');
  } catch {
    log('ensureFileStructure: failed listing base file structure for application moving onto ensuring it exists', 'warning');

    try {
      await fs.promises.mkdir(gameFolderPath, { recursive: true });
      log(`ensureFileStructure: successfully created new path at: ${gameFolderPath}`);
    } catch (error) {
      throw error;
    }
  }
}

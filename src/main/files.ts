import { GameEntryData } from '../shared/types/gameEntryData';
import { Game, GameSchema } from '../shared/schemas/game';
import { log } from './logger';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const userDataPath = path.join(app.getPath('userData'), 'UserData');
const gameFolderPath = path.join(userDataPath, 'Games');
const gameEntrySubFolders = ['Scenes', 'Journal', 'Miscellaneous', 'Chat', 'Music', 'Storage'];
const baseGameFileName = 'game.json';

export const initializeNewGame = async (game: Game): Promise<string> => {
  return new Promise<string>(async (resolve, reject) => {
    const gameRootDirectoryPath = path.join(gameFolderPath, game.uuid);

    await fs.promises.mkdir(gameRootDirectoryPath, { recursive: true }).then((response) => {
      log(`Successfully created new path for ${game.name} at: ${response}`);
    }).catch((error) => {
      const rejectMessage = `Failed to create folder for ${game.name} ${error}`;
      log(rejectMessage, 'error');
      reject(rejectMessage);
    });

    gameEntrySubFolders.forEach((folderName) => {
      const subFolderPath = path.join(gameRootDirectoryPath, folderName)

      fs.promises.mkdir(subFolderPath, { recursive: true }).then((response) => {
        log(`Successfully created new path for ${game.name} at: ${response}`);
      }).catch((error) => {
        const rejectMessage = `Failed to create sub folder for ${game.name} ${error}`;
        log(rejectMessage, 'error');
        reject(rejectMessage);
      });
    });

    const gameContentJSON = JSON.stringify(game, null, 2);

    await fs.promises.writeFile(path.join(gameRootDirectoryPath, baseGameFileName), gameContentJSON, 'utf-8').then(() => {
      log(`Successfully created file for ${game.name}`)
    }).catch((error) => {
      const rejectMessage = `Failed to create file for ${game.name} ${error}`;
      log(rejectMessage);
      reject(rejectMessage);
    });

    log(`Successfully create directories for ${game.name}`);
    resolve(`Successfully create directories for ${game.name}`);
  });
}

export const getAllGameEntryData = async (): Promise<GameEntryData> => {
  const gameEntryData: GameEntryData = {
    gameNames: [],
    gameSizesBytes: [],
  };

  const rootGameFolderFiles = await fs.promises.readdir(gameFolderPath, { withFileTypes: true });

  rootGameFolderFiles.forEach((file) => {
    if (file.isDirectory()) {
      const gameDirectoryPath = path.join(gameFolderPath, file.name);
      const baseGameFilePath = path.join(gameDirectoryPath, baseGameFileName);
      const gameFileData = fs.readFileSync(baseGameFilePath, 'utf-8');
      const parsedJSONData = JSON.parse(gameFileData);
      const varifiedData = GameSchema.safeParse(parsedJSONData);

      if (!varifiedData.success) {
        log(`Could not varify base game schema for ${baseGameFilePath}`, 'error');
        return;
      }

      gameEntryData.gameNames.push(varifiedData.data.name);
      gameEntryData.gameSizesBytes.push(varifiedData.data.gameSizeBytes);
    }
  });

  return gameEntryData;
}

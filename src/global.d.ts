import { Game } from "./shared/schemas/game";
import { Log } from "./shared/types/Log";

declare global {
  interface Window {
    electronAPI: {
      requestGameEntryData: () => Promise<Game[]>;

      requestEnsureFileSystemStructure: () => Promise<void>;
      requestApplicationExit: () => Promise<void>;

      requestCreateGame: (game: Game) => Promise<void>;
      requestDeleteGame: (game: Game) => Promise<void>;

      onMainLogged: (log: Log) => void;
    };
  }
}

export {};

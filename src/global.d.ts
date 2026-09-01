import { Game } from './shared/schemas/game';
import { Log } from './shared/types/Log'

declare global {
  interface Window {
      electronAPI: {
        requestApplicationExit: () => Promise<void>;
        requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => Promise<void>;
        requestCreateGame: (game: Game) => Promise<void>;
        requestGameEntryData: () => Promise<Game[]>;
        requestDeleteGame: (game: Game) => Promise<void>;
        onLogAdded: (callBack: (log: Log) => void) => void;
        requestLogPlayByPlay: () => void;
    };
  }
}

declare global {
  function getErrorMessage(error: unknown): string;
}

export { };

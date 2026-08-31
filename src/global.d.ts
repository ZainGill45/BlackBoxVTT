import { GameEntryData } from './shared/types/gameEntryData';
import { Game } from './shared/schemas/game';
import { Log } from './shared/types/Log'

declare global {
  interface Window {
      electronAPI: {
        requestApplicationExit: () => Promise<void>;
        requestLogUpdate: (content: string, type: 'info' | 'warning' | 'error' = 'info') => Promise<void>;
        requestCreateGame: (input: string) => Promise<void>;
        requestGameEntryData: () => Promise<GameEntryData>;
        onLogAdded: (callBack: (log: Log) => void) => void;
    };
  }
}

export { };

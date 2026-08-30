import { ref } from "vue";
import { log } from "./logger";
import { toast } from "./toast";

export interface GameEntry {
  id: number;
  name: string;
}

const maxGameNameLength = 256;
const invalidCharactersRegex = /[^\w\s]/g;

let gameID = 0;

export const gameEntries = ref<GameEntry[]>([]);

export function addGameEntry(name: string) {
  log('Attempting to create a game...');

  if (name === '') {
    toast('Warning Creating Game', 'Tried to create game but name was empty', 'warning');
    log('Tried to create game but name was empty');
    return;
  }
  if (name.length > maxGameNameLength) {
    toast('Warning Creating Game', 'Game name is too long', 'warning');
    log('Game name is too long');
    return;
  }
  if (name.match(invalidCharactersRegex)) {
    toast('Warning Creating Game', 'Game name contains invalid characters', 'warning');
    log('Game name contains invalid characters');
    return;
  }

  const entry: GameEntry = {
    id: gameID++,
    name,
  };

  gameEntries.value.push(entry);

  log(`Added game entry: ${name} with ID = ${entry.id}`);
  toast('Game Created', `Game "${name}" has been created`);
}

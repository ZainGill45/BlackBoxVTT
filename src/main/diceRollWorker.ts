import { parentPort } from 'node:worker_threads';
import {
  type ChatRollDefinition,
} from '../shared/chatRoll';
import { MAX_CHAT_MESSAGE_BYTES, chatUtf8ByteLength } from '../shared/chat';
import { rollChatCard } from './diceRoller';

interface WorkerRequest {
  definition: ChatRollDefinition;
  id: string;
}

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    const card = rollChatCard(request.definition);
    if (
      chatUtf8ByteLength(JSON.stringify({ card, kind: 'roll' })) >
      MAX_CHAT_MESSAGE_BYTES
    ) {
      parentPort?.postMessage({
        error: 'The dice result exceeds the chat payload limit.',
        id: request.id,
        type: 'invalid_input',
      });
      return;
    }
    parentPort?.postMessage({ card, id: request.id, type: 'success' });
  } catch {
    parentPort?.postMessage({
      error: 'Dice notation is invalid.',
      id: request.id,
      type: 'invalid_input',
    });
  }
});

import {
  normalizeChatContent,
  sameChatPrincipal,
  type ChatIdentity,
  type ChatPrincipal,
} from '../../../shared/chat';
import {
  parseRollCommand,
  type ChatRollDefinition,
} from '../../../shared/chatRoll';

export type ParsedChatCommand =
  | { kind: 'clear' }
  | { kind: 'error'; message: string }
  | { kind: 'help' }
  | {
      definition: ChatRollDefinition;
      kind: 'roll';
      recipient: ChatIdentity | null;
    }
  | {
      body: string;
      kind: 'send';
      recipient: ChatIdentity | null;
    };

function identityPrincipal(identity: ChatIdentity): ChatPrincipal {
  return identity.kind === 'gm'
    ? { kind: 'gm' }
    : { kind: 'player', userId: identity.userId };
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function parseWhisperParts(
  input: string,
): { body: string; recipientName: string } | null {
  const rest = input.trimStart();
  if (!rest) {
    return null;
  }

  if (!rest.startsWith('"')) {
    const boundary = rest.search(/\s/u);
    if (boundary < 1) {
      return null;
    }
    const body = normalizeChatContent(rest.slice(boundary));
    return body
      ? { body, recipientName: rest.slice(0, boundary) }
      : null;
  }

  let recipientName = '';
  let index = 1;
  let closed = false;
  while (index < rest.length) {
    const character = rest[index];
    if (character === '"') {
      closed = true;
      index += 1;
      break;
    }
    if (character === '\\') {
      const escaped = rest[index + 1];
      if (escaped !== '"' && escaped !== '\\') {
        return null;
      }
      recipientName += escaped;
      index += 2;
      continue;
    }
    recipientName += character;
    index += 1;
  }

  if (!closed || !/\s/u.test(rest[index] ?? '')) {
    return null;
  }
  const body = normalizeChatContent(rest.slice(index));
  return body && normalizedName(recipientName)
    ? { body, recipientName }
    : null;
}

export function parseChatComposer(
  draft: string,
  directory: readonly ChatIdentity[],
  self: ChatPrincipal,
  canClear: boolean,
): ParsedChatCommand {
  const normalized = normalizeChatContent(draft);
  if (!normalized) {
    return { kind: 'error', message: 'Enter a message to send.' };
  }

  if (normalized.startsWith('//')) {
    const body = normalizeChatContent(normalized.slice(1));
    return body
      ? { body, kind: 'send', recipient: null }
      : { kind: 'error', message: 'Enter a message to send.' };
  }

  if (!normalized.startsWith('/')) {
    return { body: normalized, kind: 'send', recipient: null };
  }

  const commandMatch = /^\/(\S+)([\s\S]*)$/u.exec(normalized);
  const command = commandMatch?.[1].toLocaleLowerCase('en-US') ?? '';
  const argumentsText = commandMatch?.[2] ?? '';

  if (command === 'help') {
    return argumentsText.trim()
      ? {
          kind: 'error',
          message: 'Usage: /help',
        }
      : { kind: 'help' };
  }

  if (command === 'clear' && canClear) {
    return argumentsText.trim()
      ? {
          kind: 'error',
          message: 'Usage: /clear',
        }
      : { kind: 'clear' };
  }

  if (command === 'w' || command === 'whisper') {
    const whisper = parseWhisperParts(argumentsText);
    if (!whisper) {
      return {
        kind: 'error',
        message: 'Usage: /w Alice message or /w "Alice Smith" message',
      };
    }
    const recipient = directory.find(
      (identity) =>
        normalizedName(identity.displayName) ===
        normalizedName(whisper.recipientName),
    );
    if (!recipient) {
      return {
        kind: 'error',
        message: 'That whisper recipient is not available.',
      };
    }
    if (sameChatPrincipal(identityPrincipal(recipient), self)) {
      return {
        kind: 'error',
        message: 'You cannot whisper to yourself.',
      };
    }
    if (/^\/(?:r|roll)(?:\s|$)/iu.test(whisper.body)) {
      const roll = parseRollCommand(whisper.body);
      return roll.ok
        ? { definition: roll.definition, kind: 'roll', recipient }
        : { kind: 'error', message: roll.message };
    }
    return { body: whisper.body, kind: 'send', recipient };
  }

  if (command === 'r' || command === 'roll') {
    const roll = parseRollCommand(normalized);
    return roll.ok
      ? { definition: roll.definition, kind: 'roll', recipient: null }
      : { kind: 'error', message: roll.message };
  }

  return {
    kind: 'error',
    message: 'Unknown command. Type /help for chat commands.',
  };
}

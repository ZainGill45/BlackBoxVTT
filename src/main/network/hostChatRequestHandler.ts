import type { Socket } from 'node:net';
import type { ChatError, ChatMessage } from '../../shared/chat';
import {
  playerChatIdentity,
  type CampaignChatService,
} from '../campaignTable/chatService';
import type { HostClient } from './hostClient';
import {
  parsePayload,
  writeEnvelope,
  type TcpEnvelope,
} from './tcpProtocol';

type PlayerChatService = Pick<
  CampaignChatService,
  'bootstrap' | 'history' | 'send'
>;

interface HostChatRequestHandlerOptions {
  chat: PlayerChatService;
  onMessageCreated: (message: ChatMessage, source: HostClient) => void;
}

/** Handles authenticated player chat requests; the host retains socket fanout. */
export class HostChatRequestHandler {
  constructor(
    private readonly options: HostChatRequestHandlerOptions,
  ) {}

  async handleRequest(
    client: HostClient,
    envelope: TcpEnvelope,
  ): Promise<boolean> {
    if (!client.user) {
      return false;
    }
    if (envelope.type === 'client.chat_bootstrap') {
      parsePayload('client.chat_bootstrap', envelope.payload);
      const result = await this.options.chat.bootstrap({
        kind: 'player',
        userId: client.user.id,
      });
      if (result.ok) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_bootstrap',
          result.value,
          envelope.requestId,
        );
      } else {
        this.sendError(client, result.error, envelope.requestId);
      }
      return true;
    }
    if (envelope.type === 'client.chat_history') {
      const input = parsePayload(
        'client.chat_history',
        envelope.payload,
      );
      const result = await this.options.chat.history(
        { kind: 'player', userId: client.user.id },
        input,
      );
      if (result.ok) {
        writeEnvelope(
          client.socket as unknown as Socket,
          'server.chat_history',
          result.value,
          envelope.requestId,
        );
      } else {
        this.sendError(client, result.error, envelope.requestId);
      }
      return true;
    }
    if (envelope.type === 'client.chat_send') {
      const input = parsePayload('client.chat_send', envelope.payload);
      const result = await this.options.chat.send(
        playerChatIdentity(client.user),
        input,
      );
      if (!result.ok) {
        this.sendError(client, result.error, envelope.requestId);
        return true;
      }
      writeEnvelope(
        client.socket as unknown as Socket,
        'server.chat_send_result',
        result.value.message,
        envelope.requestId,
      );
      if (result.value.created) {
        this.options.onMessageCreated(result.value.message, client);
      }
      return true;
    }
    return false;
  }

  private sendError(
    client: HostClient,
    error: ChatError,
    requestId?: string,
  ): void {
    writeEnvelope(
      client.socket as unknown as Socket,
      'server.chat_error',
      error,
      requestId,
    );
  }
}

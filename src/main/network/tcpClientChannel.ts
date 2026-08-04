import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import {
  FrameDecoder,
  parsePayload,
  writeEnvelope,
  type ProtocolMessageType,
  type TcpEnvelope,
} from './tcpProtocol';

const MESSAGE_TIMEOUT_MS = 60_000;

const spontaneousServerMessages = new Set<string>([
  'server.assets_changed',
  'server.chat_directory_changed',
  'server.chat_history_cleared',
  'server.chat_limit_changed',
  'server.chat_message',
  'server.chat_participant_event',
  'server.journal_changed',
  'server.map_ping',
  'server.scene_presented',
  'server.scene_transform_started',
  'server.scene_transform_cancelled',
  'server.update_rate_changed',
]);

interface MessageWaiter {
  reject: (error: Error) => void;
  resolve: (envelope: TcpEnvelope) => void;
  timer: ReturnType<typeof setTimeout>;
  types: Set<string>;
  requestId?: string;
}

export class TcpClientChannel extends EventEmitter {
  private closeError: Error | null = null;
  private readonly decoder = new FrameDecoder();
  private destroyed = false;
  private readonly queue: TcpEnvelope[] = [];
  private readonly waiters = new Set<MessageWaiter>();

  constructor(readonly socket: TLSSocket) {
    super();
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const envelope of this.decoder.push(chunk)) {
          if (envelope.type === 'server.ping') {
            const ping = parsePayload('server.ping', envelope.payload);
            writeEnvelope(
              socket as unknown as Socket,
              'client.pong',
              ping,
            );
            continue;
          }
          if (envelope.type === 'server.udp_recovery_required') {
            parsePayload(
              'server.udp_recovery_required',
              envelope.payload,
            );
            this.emit('udp-recovery-required');
            continue;
          }
          this.dispatch(envelope);
        }
      } catch (error) {
        this.closeError =
          error instanceof Error ? error : new Error('Invalid TCP message.');
        socket.destroy(error as Error);
      }
    });
    socket.on('close', () => {
      this.destroyed = true;
      const error = this.closeError ?? new Error('TCP connection closed.');
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.waiters.clear();
      this.emit('closed');
    });
    socket.on('error', (error) => {
      this.closeError ??= error;
    });
  }

  send(type: ProtocolMessageType, payload: unknown): void {
    if (this.destroyed) {
      throw new Error('TCP connection is closed.');
    }
    writeEnvelope(this.socket as unknown as Socket, type, payload);
  }

  waitFor(types: string[], timeout = MESSAGE_TIMEOUT_MS): Promise<TcpEnvelope> {
    const index = this.queue.findIndex((envelope) =>
      types.includes(envelope.type),
    );
    if (index >= 0) {
      return Promise.resolve(this.queue.splice(index, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const waiter: MessageWaiter = {
        reject,
        resolve: (envelope) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(envelope);
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Network message timed out.'));
        }, timeout),
        types: new Set(types),
      };
      this.waiters.add(waiter);
    });
  }

  request(
    type: ProtocolMessageType,
    payload: unknown,
    responseTypes: string[],
    timeout = MESSAGE_TIMEOUT_MS,
  ): Promise<TcpEnvelope> {
    const requestId = crypto.randomUUID();
    this.sendWithRequestId(type, payload, requestId);
    return this.waitForRequest(requestId, responseTypes, timeout);
  }

  close(): void {
    this.socket.destroy();
  }

  drainPendingEvents(): TcpEnvelope[] {
    const events: TcpEnvelope[] = [];
    for (let index = 0; index < this.queue.length; ) {
      if (spontaneousServerMessages.has(this.queue[index].type)) {
        events.push(this.queue.splice(index, 1)[0]);
      } else {
        index += 1;
      }
    }
    return events;
  }

  private dispatch(envelope: TcpEnvelope): void {
    for (const waiter of this.waiters) {
      if (
        waiter.types.has(envelope.type) &&
        (!waiter.requestId || waiter.requestId === envelope.requestId)
      ) {
        waiter.resolve(envelope);
        return;
      }
    }
    if (spontaneousServerMessages.has(envelope.type)) {
      if (this.listenerCount('message') > 0) {
        this.emit('message', envelope);
      } else {
        this.queue.push(envelope);
      }
      return;
    }
    this.queue.push(envelope);
    this.emit('message', envelope);
  }

  private sendWithRequestId(
    type: ProtocolMessageType,
    payload: unknown,
    requestId: string,
  ): void {
    if (this.destroyed) {
      throw new Error('TCP connection is closed.');
    }
    writeEnvelope(this.socket as unknown as Socket, type, payload, requestId);
  }

  private waitForRequest(
    requestId: string,
    types: string[],
    timeout: number,
  ): Promise<TcpEnvelope> {
    const index = this.queue.findIndex(
      (envelope) =>
        envelope.requestId === requestId && types.includes(envelope.type),
    );
    if (index >= 0) {
      return Promise.resolve(this.queue.splice(index, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const waiter: MessageWaiter = {
        reject,
        requestId,
        resolve: (envelope) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(envelope);
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Network message timed out.'));
        }, timeout),
        types: new Set(types),
      };
      this.waiters.add(waiter);
    });
  }
}

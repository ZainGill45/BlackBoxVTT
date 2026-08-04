import type { Socket } from 'node:net';
import type { JournalRepository, JournalActor } from '../journalRepository';
import type { HostClient } from './hostClient';
import { parsePayload, writeEnvelope, type TcpEnvelope } from './tcpProtocol';

type SuccessType =
  | 'server.journal_asset_dependents'
  | 'server.journal_delete_preview'
  | 'server.journal_delete_result'
  | 'server.journal_lease'
  | 'server.journal_manifest'
  | 'server.journal_note'
  | 'server.journal_page'
  | 'server.journal_release_result'
  | 'server.journal_users';

export class HostJournalRequestHandler {
  constructor(
    private readonly journal: JournalRepository,
    private readonly onChanged: (event: {
      entryId?: string;
      pageId?: string;
      type: 'content' | 'deleted' | 'permissions' | 'structure';
    }) => Promise<void>,
  ) {}

  async handleRequest(client: HostClient, envelope: TcpEnvelope): Promise<boolean> {
    const actor = this.actor(client);
    if (!actor) return false;

    if (envelope.type === 'client.journal_list') {
      parsePayload('client.journal_list', envelope.payload);
      return this.respond(client, envelope, 'server.journal_manifest', await this.journal.list(actor));
    }
    if (envelope.type === 'client.journal_list_users') {
      parsePayload('client.journal_list_users', envelope.payload);
      const result = await this.journal.listUsers(actor);
      return this.respond(client, envelope, 'server.journal_users', result.ok ? { ok: true, value: { users: result.value } } : result);
    }
    if (envelope.type === 'client.journal_get_note') {
      const input = parsePayload('client.journal_get_note', envelope.payload);
      return this.respond(client, envelope, 'server.journal_note', await this.journal.getNote(actor, input.entryId));
    }
    if (envelope.type === 'client.journal_find_asset_dependents') {
      const input = parsePayload('client.journal_find_asset_dependents', envelope.payload);
      const value = await this.journal.findAssetDependents(input.assetId, actor);
      return this.respond(client, envelope, 'server.journal_asset_dependents', { ok: true, value: { dependents: value } });
    }
    if (envelope.type === 'client.journal_detach_asset') {
      const input = parsePayload('client.journal_detach_asset', envelope.payload);
      const result = await this.journal.detachAsset(input.assetId, actor);
      await this.after(result.ok, { type: 'content' });
      return this.respond(client, envelope, 'server.journal_release_result', result.ok ? { ok: true, value: {} } : result);
    }
    if (envelope.type === 'client.journal_get_page') {
      const input = parsePayload('client.journal_get_page', envelope.payload);
      return this.respond(client, envelope, 'server.journal_page', await this.journal.getPage(actor, input.entryId, input.pageId));
    }
    if (envelope.type === 'client.journal_create_note') {
      parsePayload('client.journal_create_note', envelope.payload);
      const result = await this.journal.createNote(actor);
      await this.after(result.ok, { entryId: result.ok ? result.value.id : undefined, type: 'structure' });
      return this.respond(client, envelope, 'server.journal_note', result);
    }
    if (envelope.type === 'client.journal_update_note') {
      const input = parsePayload('client.journal_update_note', envelope.payload);
      const result = await this.journal.updateNote(actor, input.entryId, input.name, input.nameStyle, input.expectedRevision);
      await this.after(result.ok, { entryId: input.entryId, type: 'structure' });
      return this.respond(client, envelope, 'server.journal_note', result);
    }
    if (envelope.type === 'client.journal_update_note_permissions') {
      const input = parsePayload('client.journal_update_note_permissions', envelope.payload);
      const result = await this.journal.updateNotePermissions(actor, input);
      await this.after(result.ok, { entryId: input.entryId, type: 'permissions' });
      return this.respond(client, envelope, 'server.journal_note', result);
    }
    if (envelope.type === 'client.journal_create_page') {
      const input = parsePayload('client.journal_create_page', envelope.payload);
      const result = await this.journal.createPage(actor, input.entryId, input.expectedEntryRevision);
      await this.after(result.ok, { entryId: input.entryId, pageId: result.ok ? result.value.id : undefined, type: 'structure' });
      return this.respond(client, envelope, 'server.journal_page', result);
    }
    if (envelope.type === 'client.journal_update_page') {
      const input = parsePayload('client.journal_update_page', envelope.payload);
      const result = await this.journal.updatePage(actor, input.entryId, input.pageId, input.leaseId, input.title, input.titleStyle, input.content, input.expectedRevision);
      await this.after(result.ok, { entryId: input.entryId, pageId: input.pageId, type: 'content' });
      return this.respond(client, envelope, 'server.journal_page', result);
    }
    if (envelope.type === 'client.journal_update_page_permissions') {
      const input = parsePayload('client.journal_update_page_permissions', envelope.payload);
      const result = await this.journal.updatePagePermissions(actor, input);
      await this.after(result.ok, { entryId: input.entryId, pageId: input.pageId, type: 'permissions' });
      return this.respond(client, envelope, 'server.journal_page', result);
    }
    if (envelope.type === 'client.journal_acquire_lease') {
      const input = parsePayload('client.journal_acquire_lease', envelope.payload);
      return this.respond(client, envelope, 'server.journal_lease', await this.journal.acquireLease(actor, input.entryId, input.pageId));
    }
    if (envelope.type === 'client.journal_renew_lease') {
      const input = parsePayload('client.journal_renew_lease', envelope.payload);
      return this.respond(client, envelope, 'server.journal_lease', await this.journal.renewLease(actor, input.entryId, input.pageId, input.leaseId));
    }
    if (envelope.type === 'client.journal_release_lease') {
      const input = parsePayload('client.journal_release_lease', envelope.payload);
      const result = await this.journal.releaseLease(actor, input.pageId, input.leaseId);
      return this.respond(client, envelope, 'server.journal_release_result', result.ok ? { ok: true, value: {} } : result);
    }
    if (envelope.type === 'client.journal_move_note') {
      const input = parsePayload('client.journal_move_note', envelope.payload);
      const result = await this.journal.moveNote(actor, input);
      await this.after(result.ok, { type: 'structure' });
      return this.respond(client, envelope, 'server.journal_manifest', result);
    }
    if (envelope.type === 'client.journal_reorder_notes') {
      const input = parsePayload('client.journal_reorder_notes', envelope.payload);
      const result = await this.journal.reorderNotes(actor, input);
      await this.after(result.ok, { type: 'structure' });
      return this.respond(client, envelope, 'server.journal_manifest', result);
    }
    if (envelope.type === 'client.journal_move_page') {
      const input = parsePayload('client.journal_move_page', envelope.payload);
      const result = await this.journal.movePage(actor, input);
      await this.after(result.ok, { entryId: input.entryId, type: 'structure' });
      return this.respond(client, envelope, 'server.journal_note', result);
    }
    if (envelope.type === 'client.journal_reorder_pages') {
      const input = parsePayload('client.journal_reorder_pages', envelope.payload);
      const result = await this.journal.reorderPages(actor, input);
      await this.after(result.ok, { entryId: input.entryId, type: 'structure' });
      return this.respond(client, envelope, 'server.journal_note', result);
    }
    if (envelope.type === 'client.journal_prepare_delete') {
      const input = parsePayload('client.journal_prepare_delete', envelope.payload);
      return this.respond(client, envelope, 'server.journal_delete_preview', await this.journal.prepareDelete(actor, input.target));
    }
    if (envelope.type === 'client.journal_delete_note' || envelope.type === 'client.journal_delete_page') {
      const input = envelope.type === 'client.journal_delete_note'
        ? parsePayload('client.journal_delete_note', envelope.payload)
        : parsePayload('client.journal_delete_page', envelope.payload);
      const result = await this.journal.deleteTarget(actor, input);
      await this.after(result.ok, {
        entryId: input.target.entryId,
        pageId: input.target.kind === 'page' ? input.target.pageId : undefined,
        type: 'deleted',
      });
      return this.respond(client, envelope, 'server.journal_delete_result', result);
    }
    return false;
  }

  private actor(client: HostClient): JournalActor | null {
    return client.user
      ? { kind: 'player', userId: client.user.id, username: client.user.username }
      : null;
  }

  private async after(success: boolean, event: Parameters<HostJournalRequestHandler['onChanged']>[0]): Promise<void> {
    if (success) await this.onChanged(event);
  }

  private respond(
    client: HostClient,
    envelope: TcpEnvelope,
    successType: SuccessType,
    result: { ok: boolean; value?: unknown; error?: unknown },
  ): true {
    writeEnvelope(
      client.socket as unknown as Socket,
      result.ok ? successType : 'server.journal_error',
      result.ok ? result.value : result.error,
      envelope.requestId,
    );
    return true;
  }
}

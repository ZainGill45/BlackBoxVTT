import { createElement } from 'react';
import type { CampaignSystemState } from '../shared/gameSystems';
import type { JournalApi, SystemJournalEntry } from '../shared/journal';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from './dnd5e/definition';
import { CharacterSheetModal } from './dnd5e/renderer/CharacterSheetModal';

export interface SystemJournalEntryRendererProps {
  campaignId: string;
  entry: SystemJournalEntry;
  journalApi: JournalApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
}

export function hasSystemJournalEntryRenderer(typeId: string): boolean {
  return typeId === DND5E_CHARACTER_ENTRY_TYPE_ID;
}

export function SystemJournalEntryModal(props: SystemJournalEntryRendererProps) {
  return props.entry.typeId === DND5E_CHARACTER_ENTRY_TYPE_ID
    ? createElement(CharacterSheetModal, props)
    : null;
}

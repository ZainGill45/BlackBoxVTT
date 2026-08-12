import { createElement } from 'react';
import type { CampaignSystemState } from '../shared/gameSystems';
import type { JournalApi, SystemJournalEntry } from '../shared/journal';
import type {
  CharacterSheetJournalApi,
  CharacterSheetNetworkApi,
  JournalWindowGeometry,
} from '../shared/journalWindows';
import type { NetworkApi } from '../shared/network';
import { DND5E_CHARACTER_ENTRY_TYPE_ID } from './dnd5e/definition';
import {
  CharacterSheetDetached,
  CharacterSheetModal,
  measureCharacterSheetModal,
} from './dnd5e/renderer/CharacterSheetModal';

export interface SystemJournalEntryRendererProps {
  campaignId: string;
  entry: SystemJournalEntry;
  journalApi: JournalApi;
  networkApi?: NetworkApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
}

export function hasSystemJournalEntryRenderer(typeId: string): boolean {
  return typeId === DND5E_CHARACTER_ENTRY_TYPE_ID;
}

export function hasDetachedSystemJournalEntryRenderer(typeId: string): boolean {
  return typeId === DND5E_CHARACTER_ENTRY_TYPE_ID;
}

export function measureDetachedSystemJournalEntry(
  typeId: string,
): JournalWindowGeometry | null {
  return typeId === DND5E_CHARACTER_ENTRY_TYPE_ID
    ? measureCharacterSheetModal()
    : null;
}

export function SystemJournalEntryModal(props: SystemJournalEntryRendererProps) {
  return props.entry.typeId === DND5E_CHARACTER_ENTRY_TYPE_ID
    ? createElement(CharacterSheetModal, props)
    : null;
}

export interface DetachedSystemJournalEntryRendererProps {
  campaignId: string;
  closeRequestId: number;
  entry: SystemJournalEntry;
  journalApi: CharacterSheetJournalApi;
  networkApi?: CharacterSheetNetworkApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
}

export function DetachedSystemJournalEntry(
  props: DetachedSystemJournalEntryRendererProps,
) {
  return props.entry.typeId === DND5E_CHARACTER_ENTRY_TYPE_ID
    ? createElement(CharacterSheetDetached, props)
    : null;
}

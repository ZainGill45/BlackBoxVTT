import {
  formatDnd5eWeight,
  type Dnd5eCharacterInventory,
  type Dnd5eCharacterInventoryEntry,
  type Dnd5eDerivedInventoryValues,
} from './characterData';

function entryName(entry: Dnd5eCharacterInventoryEntry): string {
  const normalized = entry.name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return normalized || (entry.kind === 'container' ? 'Unnamed Container' : 'Unnamed Item');
}

function weightLabel(hundredths: number): string {
  return `${formatDnd5eWeight(hundredths)} lb`;
}

function entryWeightHundredths(entry: Dnd5eCharacterInventoryEntry): number {
  return Math.round(entry.weight * 100);
}

function formatEntry(
  entry: Dnd5eCharacterInventoryEntry,
  derived: Dnd5eDerivedInventoryValues,
  indent = '',
  nested = false,
): string[] | null {
  const typeLabel = entry.kind === 'container' ? 'Container' : 'Item';
  const lines = [`${indent}${nested ? '- ' : ''}${typeLabel}: ${entryName(entry)}`];
  const detailIndent = `${indent}${nested ? '  ' : ''}`;
  lines.push(`${detailIndent}Equipped: ${entry.equipped ? 'Yes' : 'No'}`);

  const ownWeightHundredths = entryWeightHundredths(entry);
  if (entry.kind === 'item') {
    lines.push(
      `${detailIndent}Count: ${entry.quantity}`,
      `${detailIndent}Weight: ${weightLabel(ownWeightHundredths)} each`,
      `${detailIndent}Total Weight: ${weightLabel(
        ownWeightHundredths * entry.quantity,
      )}`,
    );
    return lines;
  }

  const values = derived.containers[entry.id];
  if (!values) return null;
  lines.push(
    `${detailIndent}Weight (empty): ${weightLabel(ownWeightHundredths)}`,
    `${detailIndent}Contents Weight: ${
      entry.contentsWeight === 'normal' ? 'Normal' : 'Weightless'
    }`,
    `${detailIndent}Capacity: ${values.capacityHundredths === null
      ? 'Unlimited'
      : weightLabel(values.capacityHundredths)}`,
    `${detailIndent}Used Capacity: ${weightLabel(values.usedWeightHundredths)}`,
    `${detailIndent}Status: ${values.overCapacity ? 'Over capacity' : 'Within capacity'}`,
  );
  if (entry.contents.length === 0) {
    lines.push(`${detailIndent}Contents: None`);
    return lines;
  }
  lines.push(`${detailIndent}Contents:`);
  for (const child of entry.contents) {
    const childLines = formatEntry(child, derived, `${detailIndent}  `, true);
    if (!childLines) return null;
    lines.push(...childLines);
  }
  return lines;
}

function findEntry(
  entries: readonly Dnd5eCharacterInventoryEntry[],
  entryId: string,
): Dnd5eCharacterInventoryEntry | null {
  for (const entry of entries) {
    if (entry.id === entryId) return entry;
    if (entry.kind === 'container') {
      const nested = findEntry(entry.contents, entryId);
      if (nested) return nested;
    }
  }
  return null;
}

export function createDnd5eInventoryEntryChatContent(
  inventory: Dnd5eCharacterInventory,
  derived: Dnd5eDerivedInventoryValues,
  entryId: string,
): string | null {
  const entry = findEntry(inventory.entries, entryId);
  if (!entry) return null;
  return formatEntry(entry, derived)?.join('\n') ?? null;
}

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Immutable bundled-system identity and settings for one campaign. */
export interface CampaignSystemState {
  id: string;
  schemaVersion: number;
  settings: JsonValue;
}

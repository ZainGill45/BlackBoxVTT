import * as z from "zod";

export const GameSchema = z.object({
  schemaVersion: z.literal(1),
  uuid: z.uuidv4(),
  name: z.string()
         .trim()
         .min(1, 'Game name is required')
         .max(128, 'Game name cannot exceed 128 characters')
         .regex(/^[\w\s]+$/, 'Game name can only contain letters, numbers, spaces, and underscores'),
  gameSizeBytes: z.number().nonnegative('Game size cannot be negative')
});

export type Game = z.infer<typeof GameSchema>;

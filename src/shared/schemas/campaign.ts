import * as z from "zod";

export const CampaignSchema = z.object({
    name: z.string().trim().min(1, "Campaign name is required").max(100, "Campaign name is too long"),

    maxPlayers: z.coerce.number().int("Maximum players must be a whole number").min(1).max(20),
});

export type Campaign = z.infer<typeof CampaignSchema>;

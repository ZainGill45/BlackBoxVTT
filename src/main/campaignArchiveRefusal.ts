import type { CampaignErrorCode } from '../shared/campaigns';

/**
 * A reason the person at the keyboard can act on.
 *
 * Export, import, and salvage all reach data they may have to turn away, and
 * "invalid or incomplete" tells nobody which file to fix or which release to
 * open the campaign in. Raising this marks a message as written for a reader,
 * so an entry point can surface it verbatim; anything else thrown is an
 * internal fault and stays behind that entry point's generic message.
 *
 * The code is optional because one reason can surface from more than one entry
 * point, and each maps it to the code that fits how it was reached.
 */
export class CampaignDataRefusal extends Error {
  constructor(
    message: string,
    readonly code?: CampaignErrorCode,
  ) {
    super(message);
  }
}

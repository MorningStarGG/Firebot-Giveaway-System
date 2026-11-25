import type { GiveawayService } from './giveaway-service';
export let giveawayManager: GiveawayService;
export function setGiveawayManager(service: GiveawayService) {
    giveawayManager = service;
}

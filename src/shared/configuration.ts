import { defaultState } from './defaults';
import type { EffectModel, GiveawayState } from '../types/types';

export const optionKeys = [
    'autoClose',
    'duration',
    'displayDuration',
    'autoRemoveAfterClose',
    'claimMode',
    'claimDuration',
    'requireClaim',
    'enableClaimTimer',
    'autoRerollOnExpire',
    'retentionDays',
    'requeueExpired',
    'requeueDenied',
    'allowMultipleEntries',
    'maxEntriesPerUser',
    'winLimit',
    'rerollMode',
] as const;
export function configurationOf(state: GiveawayState): EffectModel {
    const options: any = {
        entryCommand: state.giveawayData.entryCommand,
        claimCommand: state.giveawayData.claimCommand,
    };
    for (const name of optionKeys) if (state[name] !== undefined) options[name] = state[name];
    return structuredClone({
        giveawayTitle: state.giveawayData.title,
        prize: state.giveawayData.prize,
        category: state.giveawayData.category || '',
        styles: state.giveawayData.styles,
        display: state.giveawayData.display,
        giveawayOptions: options,
        position: state.position,
        customCoords: state.customCoords,
        overlayInstance: state.overlayInstance || '',
    });
}
export const defaultConfiguration: EffectModel = configurationOf({
    ...defaultState,
    autoClose: false,
    duration: 300,
    winLimit: { maximum: null, scope: 'giveaway', period: 'untilReset', days: 30 },
    rerollMode: 'different',
});

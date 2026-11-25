import type { EffectType } from '@crowbartools/firebot-types';
import { manage, runOperation } from '../plugin-runtime';
import { onGiveawayOverlayEvent } from '../overlay/presentation';
import type { GiveawayUpdateModel } from '../types/types';
import template from '../templates/updater-template.html';
import policy from '../templates/policy-fields.html';
import { controller } from './updater-controller';
export function giveawaySystemUpdateEffectType(): EffectType<GiveawayUpdateModel> {
    return {
        definition: {
            // Persisted in existing Firebot effect lists, keep this ID unchanged.
            id: 'msgg:giveaway-system-update',
            name: 'Advanced Giveaway Manager',
            description: 'Manage entries, winners, appearance and giveaway settings',
            icon: 'fad fa-edit',
            categories: ['overlay'],
            outputs: [
                {
                    label: 'Winner',
                    description: 'Selected username(s), empty when a reroll has no replacement',
                    defaultName: 'winner',
                },
                { label: 'Entry Count', description: 'Entries remaining in the pool', defaultName: 'entryCount' },
                {
                    label: 'Entry Accepted',
                    description: 'Whether Add Entry committed a ticket',
                    defaultName: 'entryAccepted',
                },
                { label: 'Entry Reason', description: 'Add Entry outcome code', defaultName: 'entryReason' },
                {
                    label: 'Entry Explanation',
                    description: 'Readable Add Entry outcome',
                    defaultName: 'entryReasonText',
                },
                {
                    label: 'Entry Attempt ID',
                    description: 'Correlation ID for this attempt',
                    defaultName: 'entryAttemptId',
                },
                {
                    label: 'Entry Odds Multiplier',
                    description: 'Final or updated weight for this attempt',
                    defaultName: 'entryOddsMultiplier',
                },
            ],
        },
        optionsTemplate: template + '<div ng-if="effect.mode === \'updatePolicy\'">' + policy + '</div>',
        optionsController: controller,
        optionsValidator: (effect) => {
            const errors: string[] = [];
            if (!effect.mode) errors.push('Choose an action');
            return errors;
        },
        onTriggerEvent: (event) =>
            runOperation(() => manage(event.effect, event.sendDataToOverlay, event.abortSignal, event.trigger)),
        overlayExtension: {
            dependencies: { js: ['/plugins/giveaway-system/transport.js'] },
            event: { name: 'giveaway-system', onOverlayEvent: onGiveawayOverlayEvent },
        },
    };
}

import type { EffectType } from '@crowbartools/firebot-types';
import { create, runOperation } from '../plugin-runtime';
import { onGiveawayOverlayEvent } from '../overlay/presentation';
import type { EffectModel } from '../types/types';
import mainTemplate from '../templates/main-template.html';
import policyTemplate from '../templates/policy-fields.html';
import { controller } from './main-controller';
export const configurationTemplate = mainTemplate.replace('<!-- WIN_POLICY_FIELDS -->', () => policyTemplate);
export function giveawaySystemEffectType(): EffectType<EffectModel> {
    return {
        definition: {
            id: 'msgg:giveaway-system',
            name: 'Advanced Giveaway System',
            description: 'Create and start a giveaway',
            icon: 'fad fa-gift',
            categories: ['overlay'],
        },
        optionsTemplate: configurationTemplate,
        optionsController: controller,
        optionsValidator: (effect) => {
            const errors: string[] = [];
            if (!effect.giveawayTitle?.trim()) errors.push('Provide a giveaway title');
            return errors;
        },
        onTriggerEvent: (event) => runOperation(() => create(event.effect, event.sendDataToOverlay, event.abortSignal)),
        overlayExtension: {
            dependencies: { js: ['/plugins/giveaway-system/transport.js'] },
            event: { name: 'giveaway-system', onOverlayEvent: onGiveawayOverlayEvent },
        },
    };
}

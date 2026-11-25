import firebot, { type Plugin } from '@crowbartools/firebot-types';
import { manifest } from './manifest';
import { giveawaySystemEffectType } from './effects/main-effect';
import { giveawaySystemUpdateEffectType } from './effects/updater-effect';
import { giveawaySystemBackupEffectType } from './effects/backup-effect';
import { GiveawaySystemEventSource } from './events/giveaway-system-events';
import * as variables from './variables/giveaway-system-variables';
import {
    prepareRuntime,
    initializeRuntime,
    unloadRuntime,
    runOperation,
    editorRequest,
    presentation,
} from './plugin-runtime';
import { initializeOverlayBridge } from './overlay/presentation';
import { giveawayUi } from './ui/extension';
import html from './overlay/giveaway-system.html';
const plugin: Plugin = {
    manifest,
    parametersSchema: [],
    registers: {
        effects: [
            async () => {
                await prepareRuntime();
                return giveawaySystemEffectType();
            },
            () => giveawaySystemUpdateEffectType(),
            () => giveawaySystemBackupEffectType(),
        ],
        variables: Object.values(variables),
        eventSources: [GiveawaySystemEventSource],
        uiExtensions: [giveawayUi],
        frontendListeners: [
            {
                eventName: 'msgg:giveaway:request',
                handler: async (data: unknown) => {
                    const packet = data as {
                        requestId?: string;
                        action?: string;
                        payload?: unknown;
                    };
                    if (!packet || typeof packet.requestId !== 'string' || typeof packet.action !== 'string') return;
                    try {
                        const result = await runOperation(() => editorRequest(packet.action!, packet.payload));
                        firebot.frontendCommunicator.send('msgg:giveaway:reply', {
                            requestId: packet.requestId,
                            result,
                        });
                    } catch (error) {
                        firebot.frontendCommunicator.send('msgg:giveaway:reply', {
                            requestId: packet.requestId,
                            error: error instanceof Error ? error.message : 'Giveaway request failed',
                        });
                    }
                },
            },
        ],
        httpRoutes: {
            prefix: 'giveaway-system',
            routes: [
                {
                    path: '/giveaway-system.html',
                    method: 'GET',
                    handler: (_request, response) => {
                        response.setHeader('content-type', 'text/html; charset=utf-8');
                        response.end(html);
                    },
                },
                {
                    path: '/transport.js',
                    method: 'GET',
                    handler: (_request, response) => {
                        response.setHeader('content-type', 'application/javascript; charset=utf-8');
                        response.end(
                            '(' +
                            initializeOverlayBridge.toString() +
                            ')(' +
                            JSON.stringify(presentation.generation) +
                            ');',
                        );
                    },
                },
                {
                    path: '/state',
                    method: 'GET',
                    handler: (request, response) => {
                        if (
                            typeof request.query.id !== 'string' ||
                            (request.query.instance !== undefined && typeof request.query.instance !== 'string')
                        ) {
                            response.status(400).json({ error: 'Invalid giveaway snapshot request' });
                            return;
                        }
                        response.json(presentation.snapshot(request.query.instance || '', request.query.id));
                    },
                },
            ],
        },
    },
    onLoad: () => initializeRuntime(),
    onUnload: () => unloadRuntime(),
};
export default plugin;

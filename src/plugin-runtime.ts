import { TemplateResources } from './utility/template-resources';
import firebot from '@crowbartools/firebot-types';
import { openDatabase } from './utility/database';
import { GiveawayService } from './utility/giveaway-service';
import { giveawayManager, setGiveawayManager } from './utility/giveaway-manager';
import { Presentation } from './overlay/presentation';
import { resolveId } from './shared/giveaway-rules';
import type { EffectModel, GiveawayUpdateModel, BackupEffectModel } from './types/types';
import type { Trigger } from '@crowbartools/firebot-types';
export let presentation = new Presentation();
let prepared: Promise<void> | undefined,
    accepting = false,
    tick: ReturnType<typeof setInterval> | undefined,
    cleanup: ReturnType<typeof setInterval> | undefined,
    ticking = false;
const active = new Set<Promise<unknown>>(),
    token = {},
    guard = Symbol.for('msgg:giveaway-system:native');
export function prepareRuntime() {
    if (!prepared)
        prepared = (async () => {
            const host = globalThis as any;
            if (host[guard] && host[guard] !== token)
                throw new Error('Advanced Giveaway System is already enabled, disable the duplicate copy');
            host[guard] = token;
            try {
                const repository = await openDatabase(firebot.storage.path);
                presentation = new Presentation();
                setGiveawayManager(
                    new GiveawayService(
                        repository,
                        {
                            event: async (name, data) => {
                                await firebot.events.trigger('msgg:giveaway-system', name, data);
                            },
                            display: (id, state, type) => {
                                presentation.publish(id, state, type);
                            },
                            changed: (change) => firebot.frontendCommunicator.send('msgg:giveaway:changed', change),
                            error: (error) => firebot.logger.error('Giveaway notification failed', error),
                        },
                        undefined,
                        undefined,
                        new TemplateResources(firebot.storage.path),
                    ),
                );
            } catch (error) {
                if (host[guard] === token) delete host[guard];
                throw error;
            }
        })();
    return prepared;
}
export async function initializeRuntime() {
    await prepareRuntime();
    await giveawayManager.initialize();
    await giveawayManager.cleanupExpiredGiveaways();
    accepting = true;
    tick = setInterval(() => {
        if (ticking) return;
        ticking = true;
        void runOperation(() => giveawayManager.tick())
            .catch((error) => firebot.logger.error('Giveaway scheduler failed', error))
            .finally(() => {
                ticking = false;
            });
    }, 250);
    cleanup = setInterval(() => {
        void runOperation(() => giveawayManager.cleanupExpiredGiveaways()).catch((error) =>
            firebot.logger.error('Giveaway retention cleanup failed', error),
        );
    }, 86400000);
}
export async function runOperation<T>(operation: () => Promise<T>) {
    if (!accepting) throw new Error('Advanced Giveaway System is not running');
    const task = operation();
    active.add(task);
    try {
        return await task;
    } finally {
        active.delete(task);
    }
}
export async function unloadRuntime() {
    accepting = false;
    clearInterval(tick);
    clearInterval(cleanup);
    if (prepared && giveawayManager) giveawayManager.abortEntryAttempts();
    try {
        while (active.size) await Promise.allSettled([...active]);
        if (prepared) {
            await prepared.catch(() => { });
            if (giveawayManager) await giveawayManager.dispose();
        }
    } finally {
        const host = globalThis as any;
        if (host[guard] === token) {
            presentation.dispose();
            delete host[guard];
        }
        prepared = undefined;
    }
}
export async function create(effect: EffectModel, sender: (data: any, instance?: string) => void, abort: AbortSignal) {
    if (abort.aborted) throw new Error('Giveaway action was aborted');
    const result = await giveawayManager.configure(effect);
    presentation.dispatch(sender, result.state, result.id);
    return { success: true };
}
export async function manage(
    effect: GiveawayUpdateModel,
    sender: (data: any, instance?: string) => void,
    abort: AbortSignal,
    trigger?: Trigger,
) {
    if (abort.aborted) throw new Error('Giveaway action was aborted');
    const metadata = trigger?.metadata as any;
    const entryAttemptId =
        metadata?.eventSource?.id === 'msgg:giveaway-system' && metadata?.event?.id === 'entryAttempted'
            ? metadata.eventData?.entryAttemptId
            : undefined;
    const result = await giveawayManager.manage(effect, {
        signal: abort,
        entryAttemptId: typeof entryAttemptId === 'string' ? entryAttemptId : undefined,
    });
    if (effect.mode !== 'winnerHistory' && giveawayManager.mutationChange(result)) {
        const input = effect.giveawaySelectionMode === 'manual' ? effect.manualGiveawayTitle : effect.giveawayTitle;
        if (input) {
            const id = resolveId(input),
                state = await giveawayManager.getGiveaway(id);
            if (state) presentation.dispatch(sender, state, id);
        }
    }
    return result;
}
export async function backup(effect: BackupEffectModel) {
    if (effect.giveawaySelectionMode === 'manual')
        await giveawayManager.manualBackup(effect.manualGiveawayTitle, effect.action);
    return { success: true };
}
async function handleEditorRequest(action: string, payload: any) {
    switch (action) {
        case 'getActiveGiveaways':
            return giveawayManager.getActiveGiveaways();
        case 'getEndedGiveaways':
            return giveawayManager.getEndedGiveaways();
        case 'getAllGiveawaysWithStatus':
            return giveawayManager.getAllGiveawaysWithStatus();
        case 'getGiveawayData':
            return (await giveawayManager.getGiveaway(String(payload))) || null;
        case 'checkGiveawayExists':
            return giveawayManager.checkGiveawayExists(payload.giveawayId);
        case 'getBackupGiveaways':
            return giveawayManager.getBackupGiveaways();
        case 'restoreGiveaway':
            return giveawayManager.restoreGiveaway(payload.backupId, payload.mode);
        case 'removeBackup':
            return giveawayManager.removeBackup(payload.giveawayId);
        case 'dashboard':
            return giveawayManager.dashboard();
        case 'rememberSelection':
            return giveawayManager.rememberSelection(payload.id);
        case 'configuration':
            return giveawayManager.configuration(payload.id);
        case 'rows':
            return giveawayManager.rows(payload);
        case 'template':
            return giveawayManager.template(payload.id);
        case 'saveTemplate':
            return giveawayManager.saveTemplate(payload);
        case 'renameTemplate':
            return giveawayManager.renameTemplate(payload.id, payload.name);
        case 'deleteTemplate':
            return giveawayManager.deleteTemplate(payload.id);
        case 'exportTemplates':
            return giveawayManager.exportTemplates(payload.ids);
        case 'previewImport':
            return giveawayManager.previewImport(payload.text);
        case 'importTemplates':
            return giveawayManager.importTemplates(payload.text, payload.choices);
        case 'snapshot':
            return giveawayManager.snapshot();
        case 'configure': {
            const result = await giveawayManager.configure(payload.effect, !!payload.start, payload.id, {
                createOnly: !!payload.createOnly,
                expectedRevision: payload.expectedRevision,
            });
            return {
                id: result.id,
                configRevision: result.configRevision,
                change: giveawayManager.mutationChange(result),
            };
        }
        case 'manage':
            return giveawayManager.manage(payload);
        case 'eligibility':
            return giveawayManager.eligibility(payload.id, payload.username);
        default:
            throw new Error('Unknown giveaway request');
    }
}

export async function editorRequest(action: string, payload: any) {
    const result = await handleEditorRequest(action, payload);
    const change = giveawayManager.mutationChange(result);
    if (change && result && typeof result === 'object') return { ...result, change };
    return result;
}

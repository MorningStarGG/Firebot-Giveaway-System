import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const { createHost } = require('./plugin-host.cjs');
let directory: string, host: any;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'firebot-giveaway-host-'));
    host = createHost(directory);
    await host.load();
});
afterEach(async () => {
    await host?.unload();
    const resolved = path.resolve(directory);
    if (
        path.dirname(resolved) === path.resolve(os.tmpdir()) &&
        path.basename(resolved).startsWith('firebot-giveaway-host-')
    )
        await fs.rm(resolved, { recursive: true, force: true });
});
const config = (title = 'Alpha', options: any = {}) => ({
    giveawayTitle: title,
    prize: 'Prize',
    giveawayOptions: { claimMode: 'enabled', allowMultipleEntries: true, maxEntriesPerUser: 3, ...options },
    styles: {},
    display: {},
});
const manage = (entryAction: string, extra: any = {}) =>
    host.effects[1].onTriggerEvent({
        effect: { giveawayTitle: 'giveaway_Alpha', mode: 'entryManagement', entryAction, ...extra },
    });
test('native manifest, effects, variables, events, UI page and routes retain the public contracts', () => {
    expect(host.plugin.manifest.version).toBe('2.0.0');
    expect(host.plugin.manifest.minimumFirebotVersion).toEqual({ major: 5, minor: 67, patch: 0 });
    expect(host.effects.map((e: any) => e.definition.id)).toEqual([
        'msgg:giveaway-system',
        'msgg:giveaway-system-update',
        'msgg:giveaway-system-backup',
    ]);
    expect(host.variables.map((v: any) => v.definition.handle).sort()).toEqual([
        'giveawayInfo',
        'giveawaySearch',
        'giveawayUserInfo',
        'giveawayWinSearch',
    ]);
    expect(host.plugin.registers.eventSources[0].events).toHaveLength(11);
    expect(host.plugin.registers.uiExtensions[0].pages[0].name).toBe('Giveaways');
    expect([...host.routes.keys()]).toEqual([
        '/plugins/giveaway-system/giveaway-system.html',
        '/plugins/giveaway-system/transport.js',
        '/plugins/giveaway-system/state',
    ]);
    expect(host.webSocketEvents).toHaveLength(0);
});
test('effect callbacks run the central service, preserve ID case and return outputs', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'Alice', oddsMultiplier: 3 });
    await manage('add', { username: 'Alice', oddsMultiplier: 1 });
    const result = await manage('pick', { autoApproveMulti: false });
    expect(result.outputs).toEqual({ winner: 'alice', entryCount: 1 });
    expect(host.backendEvents.find((e: any) => e.event === 'winnerPicked').metadata).toMatchObject({
        giveawayId: 'giveaway_Alpha',
        winner: 'alice',
        oddsPercentage: '100.00',
        selectedEntryWeight: expect.any(Number),
        winId: expect.any(String),
        entryId: expect.any(String),
        runId: expect.any(String),
    });
});
test('existing variables expose eligibility, combined odds and durable admission counts', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'Alice', oddsMultiplier: 2 });
    await manage('add', { username: 'Alice', oddsMultiplier: 2 });
    await manage('add', { username: 'Bob', oddsMultiplier: 2 });
    const user = host.variables.find((v: any) => v.definition.handle === 'giveawayUserInfo'),
        info = host.variables.find((v: any) => v.definition.handle === 'giveawayInfo');
    expect(await user.evaluator({}, 'Alpha', 'Alice', 'oddsPercentage')).toBe(66.67);
    expect(await user.evaluator({}, 'Alpha', 'Alice', 'admissions')).toBe(2);
    expect(await info.evaluator({}, 'Alpha', 'eligibleEntries')).toBe(3);
    expect(await user.evaluator({}, 'Alpha', 'Alice', 'raw')).toMatchObject({
        entries: 2,
        eligibleEntries: 2,
        oddsPercentage: 66.67,
    });
    expect(await info.evaluator({}, 'Alpha', 'raw')).toMatchObject({ totalEntries: 3, eligibleEntries: 3 });
});

test('manual mixed-case names and resolved command names share lowercase storage, variables, events, and claims', async () => {
    const title = 'Mixed Case Giveaway',
        id = 'giveaway_Mixed_Case_Giveaway';
    await host.effects[0].onTriggerEvent({ effect: config(title) });
    await manage('add', { giveawayTitle: id, username: ' MorningStarGG ', oddsMultiplier: 2 });
    await manage('add', { giveawayTitle: id, username: 'morningstargg', oddsMultiplier: 1 });
    const variable = (handle: string) => host.variables.find((v: any) => v.definition.handle === handle);
    const info = variable('giveawayInfo'),
        user = variable('giveawayUserInfo');
    const searchId = await variable('giveawaySearch').evaluator({}, title, 'active');
    expect(searchId).toBe(id);
    expect(await info.evaluator({}, id, 'title')).toBe(title);
    expect(await info.evaluator({}, id, 'entriesRaw')).toMatchObject([
        { username: 'morningstargg', oddsMultiplier: 2 },
        { username: 'morningstargg', oddsMultiplier: 1 },
    ]);
    expect(await user.evaluator({}, id, ' MORNINGSTARGG ', 'raw')).toMatchObject({
        username: 'morningstargg',
        entries: 2,
        admissions: 2,
    });
    const result = await manage('pick', { giveawayTitle: id, autoApproveMulti: false });
    expect(result.outputs.winner).toBe('morningstargg');
    // This is the exact nested lookup used by the existing claim-command conditional.
    expect(await info.evaluator({}, searchId, 'winner')).toBe('morningstargg');
    expect(await user.evaluator({}, id, 'MORNINGSTARGG', 'winnerStatus')).toBe('pending');
    await manage('claim', { giveawayTitle: id, username: ' MORNINGSTARGG ', winId: '' });
    expect(await user.evaluator({}, id, 'morningstargg', 'winnerStatus')).toBe('claimed');
    await manage('approve', { giveawayTitle: id, username: 'morningstargg' });
    expect(await variable('giveawayWinSearch').evaluator({}, ' MORNINGSTARGG ', 'category', 'uncategorized')).toBe(
        'true',
    );
    for (const event of host.backendEvents) {
        if (event.metadata.username) expect(event.metadata.username).toBe('morningstargg');
        if (event.metadata.winner) expect(event.metadata.winner).toBe('morningstargg');
    }
    const root = JSON.parse(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8'));
    expect(root.giveaways[id].admissions).toEqual({ morningstargg: 2 });
    expect(Object.values(root.approvals)).toMatchObject([{ username: 'morningstargg' }]);
    expect(Object.values(root.winnerHistory)).toMatchObject([
        { winner: { username: 'morningstargg', entry: { username: 'morningstargg' } } },
    ]);
});

test('loading an existing mixed-case pending winner repairs the claim variable without redrawing or resetting', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'MorningStarGG', oddsMultiplier: 2 });
    await manage('pick', { autoApproveMulti: false });
    await host.unload();
    const target = path.join(directory, 'giveawaySystem.db');
    const saved = JSON.parse(await fs.readFile(target, 'utf8'));
    const state = saved.giveaways.giveaway_Alpha;
    state.pendingWinners[0].username = 'MorningStarGG';
    state.pendingWinners[0].entry.username = 'MORNINGSTARGG';
    const winId = state.pendingWinners[0].winId,
        entryId = state.pendingWinners[0].entry.entryId,
        runId = state.runId;
    await fs.writeFile(target, JSON.stringify(saved));
    await host.load();
    const info = host.variables.find((v: any) => v.definition.handle === 'giveawayInfo');
    expect(await info.evaluator({}, 'giveaway_Alpha', 'winner')).toBe('morningstargg');
    await manage('claim', { username: 'morningstargg', winId: '' });
    const after = JSON.parse(await fs.readFile(target, 'utf8')).giveaways.giveaway_Alpha;
    expect(after.runId).toBe(runId);
    expect(after.admissions).toEqual(state.admissions);
    expect(after.pendingWinners).toMatchObject([
        {
            winId,
            username: 'morningstargg',
            status: 'claimed',
            entry: { entryId, username: 'morningstargg', oddsMultiplier: 2 },
        },
    ]);
    expect(after.entries).toHaveLength(0);
});

test('display-name lookups enrich overlay packets without changing saved names, outputs, events, or variables', async () => {
    let finish!: (viewer: any) => void;
    const lookup = jest.fn(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    host.api.viewers = { getViewerByUsername: lookup };
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'MorningStarGG' });
    expect((await manage('pick', { autoApproveMulti: false })).outputs.winner).toBe('morningstargg');
    const target = path.join(directory, 'giveawaySystem.db'),
        saved = await fs.readFile(target, 'utf8');
    const packet = () => host.webSocketEvents.filter((e: any) => e.data.type === 'update').at(-1).data;
    expect(packet().config.pendingWinners[0]).toMatchObject({
        username: 'morningstargg',
        displayName: 'morningstargg',
    });
    // A newer update must keep its style when the earlier shared lookup completes.
    await host.effects[1].onTriggerEvent({
        effect: { mode: 'updateStyles', giveawayTitle: 'Alpha', setting: { type: 'accentColor', value: '#123456' } },
    });
    const afterStyle = await fs.readFile(target, 'utf8');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('morningstargg');
    finish({ username: 'morningstargg', displayName: 'MorningStarGG' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(packet().config.pendingWinners[0]).toMatchObject({
        username: 'morningstargg',
        displayName: 'MorningStarGG',
    });
    expect(packet().config.styles.accentColor).toBe('#123456');
    expect(await fs.readFile(target, 'utf8')).toBe(afterStyle);
    expect(saved).not.toContain('displayName');
    const info = host.variables.find((v: any) => v.definition.handle === 'giveawayInfo');
    expect(await info.evaluator({}, 'Alpha', 'winner')).toBe('morningstargg');
    expect(host.backendEvents.find((e: any) => e.event === 'winnerPicked').metadata.winner).toBe('morningstargg');
    await host.effects[1].onTriggerEvent({
        effect: { mode: 'toggleVisibility', giveawayTitle: 'Alpha', visibilityAction: 'show' },
    });
    expect(packet().config.pendingWinners[0].displayName).toBe('MorningStarGG');
    expect(lookup).toHaveBeenCalledTimes(1);
});

test.each(['missing', 'blank', 'error'])(
    'display-name lookup %s falls back to the lowercase username',
    async (result) => {
        host.api.viewers = {
            getViewerByUsername: jest.fn(async () => {
                if (result === 'error') throw Error('Viewer database unavailable');
                return result === 'blank' ? { displayName: '  ' } : undefined;
            }),
        };
        await host.effects[0].onTriggerEvent({ effect: config() });
        await manage('add', { username: 'MorningStarGG' });
        await manage('pick', { autoApproveMulti: false });
        await new Promise((resolve) => setImmediate(resolve));
        const packet = host.webSocketEvents.filter((e: any) => e.data.type === 'update').at(-1).data;
        expect(packet.config.pendingWinners[0]).toMatchObject({
            username: 'morningstargg',
            displayName: 'morningstargg',
        });
        expect(host.errors).toEqual([]);
    },
);

test('winner rotation resolves display names for completed winners as well as pending winners', async () => {
    host.api.viewers = { getViewerByUsername: jest.fn(async (username) => ({ displayName: username.toUpperCase() })) };
    await host.effects[0].onTriggerEvent({ effect: { ...config(), display: { rotateWinners: true } } });
    await manage('add', { username: 'Alice' });
    await manage('add', { username: 'Bob' });
    await manage('pick', { autoApproveMulti: true, winnerCount: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    const packet = host.webSocketEvents.filter((e: any) => e.data.type === 'update').at(-1).data;
    expect(packet.config.winners).toMatchObject([
        { username: 'alice', displayName: 'ALICE' },
        { username: 'bob', displayName: 'BOB' },
    ]);
    expect(host.api.viewers.getViewerByUsername).toHaveBeenCalledTimes(2);
});

test.each(['hide', 'remove', 'unload'])('a late display-name lookup cannot undo %s', async (action) => {
    let finish!: (viewer: any) => void;
    host.api.viewers = {
        getViewerByUsername: () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    };
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'MorningStarGG' });
    await manage('pick', { autoApproveMulti: false });
    if (action === 'unload') await host.unload();
    else
        await host.effects[1].onTriggerEvent({
            effect: {
                giveawayTitle: 'Alpha',
                mode: action === 'hide' ? 'toggleVisibility' : 'giveawayStatusControl',
                visibilityAction: 'hide',
                statusAction: 'remove',
            },
        });
    const count = host.webSocketEvents.length;
    finish({ displayName: 'MorningStarGG' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(host.webSocketEvents).toHaveLength(count);
    expect(host.webSocketEvents.at(-1).data.type).toBe(action === 'unload' ? 'dispose' : 'remove');
});

test('native entry events infer control IDs and preserve effects after a cancellation', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    const before = await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8');
    let followedByChat = false;
    host.api.events.trigger = async (source: string, event: string, metadata: any) => {
        host.backendEvents.push({ source, event, metadata });
        if (event !== 'entryAttempted') return;
        const trigger = {
            type: 'event',
            metadata: { event: { id: event }, eventSource: { id: source }, eventData: metadata },
        };
        await host.effects[1].onTriggerEvent({
            effect: { mode: 'entryManagement', entryAction: 'setAttemptOdds', oddsMultiplier: 7 },
            trigger,
        });
        await host.effects[1].onTriggerEvent({
            effect: { mode: 'entryManagement', entryAction: 'cancelAttempt', cancellationReason: 'Already won' },
            trigger,
        });
        followedByChat = true;
    };
    const overlayCount = host.events.length,
        updates = host.webSocketEvents.length;
    expect(await manage('add', { username: 'Alice' })).toMatchObject({
        outputs: { entryAccepted: false, entryOddsMultiplier: 7, entryReasonText: 'Already won' },
    });
    expect(followedByChat).toBe(true);
    expect(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8')).toBe(before);
    expect(host.events).toHaveLength(overlayCount);
    expect(host.webSocketEvents).toHaveLength(updates);
    expect(host.backendEvents.at(-1)).toMatchObject({
        event: 'entryRejected',
        metadata: { username: 'alice', reason: 'cancelled' },
    });
});

test('Add Entry inside its own event is rejected before recursively emitting another attempt', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    let attempts = 0;
    host.api.events.trigger = async (source: string, event: string, metadata: any) => {
        if (event !== 'entryAttempted') return;
        attempts++;
        await expect(
            host.effects[1].onTriggerEvent({
                effect: { mode: 'entryManagement', entryAction: 'add', giveawayTitle: 'Alpha', username: 'Bob' },
                trigger: { metadata: { event: { id: event }, eventSource: { id: source }, eventData: metadata } },
            }),
        ).rejects.toThrow('recursively');
    };
    expect(await manage('add', { username: 'Alice' })).toMatchObject({ outputs: { entryAccepted: true } });
    expect(attempts).toBe(1);
});

test('rejected IPC replies carry no stale change from another mutation', async () => {
    await host.effects[0].onTriggerEvent({ effect: config('Alpha', { maxEntriesPerUser: 1 }) });
    await manage('add', { username: 'Alice' });
    const handler = host.frontendHandlers.get('msgg:giveaway:request');
    await handler({
        requestId: 'reject',
        action: 'manage',
        payload: { mode: 'entryManagement', giveawayTitle: 'Alpha', entryAction: 'add', username: 'Alice' },
    });
    const reply = host.frontendEvents.find(
        (e: any) => e.name === 'msgg:giveaway:reply' && e.data.requestId === 'reject',
    ).data;
    expect(reply.result.outputs).toMatchObject({ entryAccepted: false, entryReason: 'entry_limit' });
    expect(reply.result.change).toBeUndefined();
});

test('unload aborts an entry waiting on an event before draining operations', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    let entered!: () => void;
    const seen = new Promise<void>((resolve) => {
        entered = resolve;
    });
    host.api.events.trigger = async (_source: string, event: string) => {
        if (event === 'entryAttempted') {
            entered();
            await new Promise<void>(() => { });
        }
    };
    const pending = manage('add', { username: 'Alice' });
    const rejected = expect(pending).rejects.toThrow('unloaded');
    await seen;
    await host.unload();
    await rejected;
    const root = JSON.parse(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8'));
    expect(root.giveaways.giveaway_Alpha.entries).toHaveLength(0);
});
test('Create from a Winner Picked event does not undo a draw or overwrite committed configuration', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    await manage('add', { username: 'Alice' });
    host.api.events.trigger = async (_source: string, event: string) => {
        if (event === 'winnerPicked')
            await host.effects[0].onTriggerEvent({ effect: { ...config(), prize: 'Updated by event' } });
    };
    await manage('pick', { autoApproveMulti: false });
    const root = JSON.parse(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8'));
    expect(root.giveaways.giveaway_Alpha.pendingWinners).toHaveLength(1);
    expect(root.giveaways.giveaway_Alpha.giveawayData.prize).toBe('Updated by event');
    expect(root.giveaways.giveaway_Alpha.entries).toHaveLength(0);
});
test('namespaced correlated IPC returns real failures without changing state', async () => {
    const handler = host.frontendHandlers.get('msgg:giveaway:request');
    await handler({ requestId: 'bad', action: 'manage', payload: { mode: 'unknown', giveawayTitle: 'Missing' } });
    expect(host.frontendEvents.find((e: any) => e.name === 'msgg:giveaway:reply').data).toMatchObject({
        requestId: 'bad',
        error: expect.stringContaining('not found'),
    });
});
test('backup effect fails truthfully for missing backup and never matches a prefix neighbor', async () => {
    await host.effects[0].onTriggerEvent({ effect: config('Alpha2') });
    await host.effects[1].onTriggerEvent({ effect: { mode: 'removeGiveaway', giveawayTitle: 'Alpha2' } });
    await expect(
        host.effects[2].onTriggerEvent({
            effect: { giveawaySelectionMode: 'manual', manualGiveawayTitle: 'Alpha', action: 'restore' },
        }),
    ).rejects.toThrow('No backup');
});
test('an aborted action does not mutate state', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(host.effects[0].onTriggerEvent({ effect: config(), abortSignal: abort.signal })).rejects.toThrow(
        'aborted',
    );
});
test('duplicate plugin copies are rejected and cannot dispose the owner', async () => {
    const duplicate = createHost(directory);
    await expect(duplicate.load()).rejects.toThrow('already enabled');
    await duplicate.unload();
    await host.effects[0].onTriggerEvent({ effect: config() });
    expect(host.events).toHaveLength(1);
});
test('unload clears the overlay and allows a clean reload without replay', async () => {
    await host.effects[0].onTriggerEvent({ effect: config() });
    await host.unload();
    expect(host.webSocketEvents.at(-1).data.type).toBe('dispose');
    await host.load();
    expect(host.effects).toHaveLength(3);
    expect(host.webSocketEvents.filter((e: any) => e.data.type === 'update')).toHaveLength(1);
});

import { GiveawayService } from '../src/utility/giveaway-service';
import { migrate, type DatabaseRoot } from '../src/utility/database';
import type { EffectModel, GiveawayUpdateModel } from '../src/types/types';
import type { EntryContext } from '../src/utility/entry-attempts';

function fixture() {
    let root = migrate({} as DatabaseRoot),
        now = Date.parse('2026-11-16T12:00:00Z'),
        writes = 0,
        fail = false;
    let handler = async (_event: string, _data: any) => { };
    const events: { event: string; data: any }[] = [],
        errors: unknown[] = [],
        displays: any[] = [];
    const service = new GiveawayService(
        {
            read: async () => structuredClone(root),
            write: async (data) => {
                if (fail) throw Error('disk full');
                writes++;
                root = structuredClone(data);
            },
        },
        {
            display: (...args) => {
                displays.push(args);
            },
            event: async (event, data) => {
                events.push({ event, data: structuredClone(data) });
                await handler(event, data);
            },
            error: (error) => {
                errors.push(error);
            },
        },
        () => now,
        () => 0,
    );
    const config = (title = 'Cup', options: any = {}, category = 'gc'): EffectModel =>
        ({
            giveawayTitle: title,
            category,
            prize: 'Prize',
            styles: {},
            display: {},
            giveawayOptions: { allowMultipleEntries: true, maxEntriesPerUser: 10, claimMode: 'enabled', ...options },
        }) as EffectModel;
    const command = (entryAction: string, extra: any = {}, id = 'Cup', context: EntryContext = {}) =>
        service.manage(
            {
                mode: 'entryManagement',
                giveawayTitle: id,
                entryAction,
                username: 'Alice',
                ...extra,
            } as GiveawayUpdateModel,
            context,
        );
    const control = (id: string, entryAction = 'cancelAttempt', extra: any = {}) =>
        command(entryAction, { entryAttemptId: id, ...extra });
    return {
        service,
        events,
        errors,
        displays,
        config,
        command,
        control,
        create: (options: any = {}, id = 'Cup', category = 'gc') => service.configure(config(id, options, category)),
        on(fn: typeof handler) {
            handler = fn;
        },
        get root() {
            return root;
        },
        get writes() {
            return writes;
        },
        fail() {
            fail = true;
        },
        advance(ms: number) {
            now += ms;
        },
    };
}
const cap = (scope = 'giveaway', period = 'untilReset', days = 30) => ({ maximum: 1, scope, period, days });

test('default/no-op hook commits once, exposes the target user, and emits acceptance after persistence', async () => {
    const f = fixture();
    await f.create();
    f.on(async (event, data) => {
        expect(data.username).toBe('alice');
        if (event === 'entryAttempted') {
            expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
            expect(data).toMatchObject({ approvedWins: 0, pendingWins: 0, claimedWins: 0, canEnter: true });
            data.username = 'Wrong';
            data.oddsMultiplier = 999; // Metadata is a snapshot, not control state.
        } else if (event === 'entryAccepted') expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(1);
    });
    const result = await f.command('add');
    expect(result.outputs).toMatchObject({ entryAccepted: true, entryOddsMultiplier: 1, entryReason: 'accepted' });
    expect(f.root.giveaways.giveaway_Cup.entries[0]).toMatchObject({ username: 'alice', oddsMultiplier: 1 });
    expect(f.events.map((e) => e.event)).toEqual(['giveawayStart', 'entryAttempted', 'entryAccepted']);
    expect(f.root.giveaways.giveaway_Cup.admissions!.alice).toBe(1);
});

test('cancel is idempotent, dominates odds, and changes no database/revision/display or existing ticket', async () => {
    const f = fixture();
    await f.create();
    await f.command('add');
    const before = structuredClone(f.root),
        writes = f.writes,
        revision = f.service.lastChange!.revision,
        displays = f.displays.length;
    f.on(async (event, data) => {
        if (event !== 'entryAttempted') return;
        await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: 4 });
        await f.control(data.entryAttemptId, 'cancelAttempt', { cancellationReason: 'Already won today' });
        await f.control(data.entryAttemptId, 'cancelAttempt', { cancellationReason: 'Other reason' });
        await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: 9 });
    });
    const result = await f.command('add');
    expect(result.outputs).toMatchObject({
        entryAccepted: false,
        entryReason: 'cancelled',
        entryReasonText: 'Already won today',
        entryOddsMultiplier: 4,
    });
    expect(f.root).toEqual(before);
    expect(f.writes).toBe(writes);
    expect(f.displays).toHaveLength(displays);
    expect(f.service.lastChange!.revision).toBe(revision);
    expect(f.service.mutationChange(result)).toBeUndefined();
    expect(f.events.at(-1)).toMatchObject({
        event: 'entryRejected',
        data: { entryAccepted: false, reasonText: 'Already won today' },
    });
});

test('last valid inline odds update applies to one ticket and spends one admission', async () => {
    const f = fixture();
    await f.create();
    f.on(async (event, data) => {
        if (event === 'entryAttempted') {
            await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: 2 });
            await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: 3.5 });
        }
    });
    expect((await f.command('add')).outputs).toMatchObject({ entryAccepted: true, entryOddsMultiplier: 3.5 });
    expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(1);
    expect(f.root.giveaways.giveaway_Cup.entries[0].oddsMultiplier).toBe(3.5);
    expect(f.root.giveaways.giveaway_Cup.admissions!.alice).toBe(1);
});

test.each([0, -1, NaN, Infinity, false, ''])(
    'invalid odds %p cannot silently fall back when Firebot catches the control error',
    async (weight) => {
        const f = fixture();
        await f.create();
        const writes = f.writes;
        f.on(async (event, data) => {
            if (event === 'entryAttempted') {
                try {
                    await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: weight });
                } catch {
                    /* Firebot catches effect errors. */
                }
            }
        });
        await expect(f.command('add')).rejects.toThrow('Entry weight');
        expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
        expect(f.writes).toBe(writes);
        expect(f.events.map((e) => e.event)).toEqual(['giveawayStart', 'entryAttempted']);
    },
);

test('closed/stale/missing IDs cannot touch tickets, and queued decisions are too late', async () => {
    const f = fixture();
    await f.create();
    let later!: () => Promise<unknown>;
    f.on(async (event, data) => {
        if (event === 'entryAttempted') later = () => f.control(data.entryAttemptId);
    });
    expect((await f.command('add')).outputs).toMatchObject({ entryAccepted: true });
    const before = structuredClone(f.root);
    await expect(later()).rejects.toThrow('no longer open');
    await expect(f.command('cancelAttempt', { entryAttemptId: '' })).rejects.toThrow('Entry Attempted');
    await expect(f.control('missing')).rejects.toThrow('no longer open');
    expect(f.root).toEqual(before);
});

test.each([{ entryAttemptId: 'wrong-id' }, { entryAttemptId: 123 }, { cancellationReason: false }])(
    'invalid inline control %p fails the attempt even when Firebot catches its error',
    async (extra) => {
        const f = fixture();
        await f.create();
        const writes = f.writes;
        f.on(async (event, data) => {
            if (event !== 'entryAttempted') return;
            try {
                await f.command('cancelAttempt', extra, 'Cup', { entryAttemptId: data.entryAttemptId });
            } catch {
                /* Firebot catches individual effect errors. */
            }
        });
        await expect(f.command('add')).rejects.toThrow();
        expect(f.writes).toBe(writes);
        expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
        expect(f.events.at(-1)!.event).toBe('entryAttempted');
    },
);

test('simultaneous viewers retain separate controls and final outcomes', async () => {
    const f = fixture();
    await f.create();
    let release!: () => void,
        both!: () => void,
        count = 0;
    const gate = new Promise<void>((r) => {
        release = r;
    }),
        entered = new Promise<void>((r) => {
            both = r;
        });
    f.on(async (event, data) => {
        if (event !== 'entryAttempted') return;
        if (data.username === 'alice') await f.control(data.entryAttemptId);
        else await f.control(data.entryAttemptId, 'setAttemptOdds', { oddsMultiplier: 5 });
        if (++count === 2) both();
        await gate;
    });
    const a = f.command('add'),
        b = f.command('add', { username: 'Bob' });
    await entered;
    release();
    const [alice, bob] = await Promise.all([a, b]);
    expect(alice.outputs.entryAccepted).toBe(false);
    expect(bob.outputs).toMatchObject({ entryAccepted: true, entryOddsMultiplier: 5 });
    expect(f.root.giveaways.giveaway_Cup.entries).toMatchObject([{ username: 'bob', oddsMultiplier: 5 }]);
    expect(f.root.giveaways.giveaway_Cup.admissions).toEqual({ bob: 1 });
});

test('a removed and recreated giveaway cannot inherit an earlier attempt', async () => {
    const f = fixture();
    await f.create();
    const originalRun = f.root.giveaways.giveaway_Cup.runId;
    f.on(async (event) => {
        if (event !== 'entryAttempted') return;
        await f.service.manage({ mode: 'giveawayStatusControl', giveawayTitle: 'Cup', statusAction: 'remove' });
        await f.create({}, 'Cup', 'replacement-category');
    });
    expect((await f.command('add')).outputs.entryReason).toBe('giveaway_changed');
    expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
    expect(f.events.at(-1)!.data).toMatchObject({ runId: originalRun, category: 'gc' });
});

test('abort during initial loading prevents both the hook and persistence', async () => {
    const f = fixture();
    await f.create();
    let finish!: (root: DatabaseRoot) => void;
    const write = jest.fn(),
        event = jest.fn(),
        controller = new AbortController();
    const service = new GiveawayService(
        {
            read: () =>
                new Promise((r) => {
                    finish = r;
                }),
            write,
        },
        {
            event,
            display() { },
            error() { },
        },
    );
    const operation = service.manage(
        { mode: 'entryManagement', entryAction: 'add', giveawayTitle: 'Cup', username: 'Alice' },
        { signal: controller.signal },
    );
    const rejected = expect(operation).rejects.toThrow();
    await Promise.resolve();
    controller.abort();
    finish(structuredClone(f.root));
    await rejected;
    expect(write).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    await service.dispose();
});

test.each([true, false])('only approval counts against the entry win cap, auto=%s', async (autoApproveMulti) => {
    const f = fixture();
    await f.create({ winLimit: cap() });
    await f.command('add');
    await f.command('pick', { autoApproveMulti });
    if (!autoApproveMulti) {
        expect((await f.command('add')).outputs.entryAccepted).toBe(true);
        await f.command('claim');
        expect((await f.command('add')).outputs.entryAccepted).toBe(true);
        await f.command('approve');
    }
    const writes = f.writes;
    expect((await f.command('add')).outputs).toMatchObject({ entryAccepted: false, entryReason: 'win_limit' });
    expect(f.writes).toBe(writes);
    expect(f.events.at(-1)!.data.approvedWins).toBe(1);
});

test('scope/window and durable approval counts survive display-history purges, reset and revoke correctly', async () => {
    const f = fixture();
    await f.create({ winLimit: cap('category', 'rolling', 1) });
    await f.create({ winLimit: cap('category', 'rolling', 1) }, 'Other');
    await f.create({ winLimit: cap('category', 'rolling', 1) }, 'Books', 'books');
    await f.command('add');
    await f.command('pick', { autoApproveMulti: true });
    expect((await f.command('add', {}, 'Other')).outputs.entryReason).toBe('win_limit');
    expect((await f.command('add', {}, 'Books')).outputs.entryAccepted).toBe(true);
    await f.service.manage({ mode: 'winnerHistory', winnerHistoryAction: 'purgeAll', winnerHistoryValue: 30 });
    expect((await f.command('add', {}, 'Other')).outputs.entryReason).toBe('win_limit');
    await f.service.manage({ mode: 'resetWinCounts', giveawayTitle: 'Other' });
    expect((await f.command('add', {}, 'Other')).outputs.entryAccepted).toBe(true);
    await f.command('deny', { winId: f.root.giveaways.giveaway_Cup.winners[0].winId });
    expect((await f.command('add')).outputs.entryAccepted).toBe(true);
    await f.command('pick', { autoApproveMulti: true });
    f.advance(86400001);
    expect((await f.command('add')).outputs.entryAccepted).toBe(true);
});

test('pending and claimed metadata follows the policy scope without counting as approvals', async () => {
    const f = fixture(),
        options = { winLimit: { ...cap('category'), maximum: 3 } };
    await f.create(options);
    await f.create(options, 'Other');
    await f.create(options, 'Third');
    await f.command('add');
    await f.command('pick', { autoApproveMulti: false });
    await f.command('claim');
    await f.command('add', {}, 'Other');
    await f.command('pick', { autoApproveMulti: false }, 'Other');
    await f.command('add', {}, 'Third');
    expect(f.events.filter((e) => e.event === 'entryAttempted').at(-1)!.data).toMatchObject({
        approvedWins: 0,
        pendingWins: 1,
        claimedWins: 1,
        canEnter: true,
    });
});

test.each(['giveaway', 'category', 'all'])('admission uses the configured %s win scope', async (scope) => {
    const f = fixture();
    await f.create({ winLimit: cap(scope) });
    await f.create({ winLimit: cap(scope) }, 'Same Category');
    await f.create({ winLimit: cap(scope) }, 'Different Category', 'books');
    await f.command('add');
    await f.command('pick', { autoApproveMulti: true });
    expect((await f.command('add')).outputs.entryReason).toBe('win_limit');
    expect((await f.command('add', {}, 'Same Category')).outputs.entryAccepted).toBe(scope === 'giveaway');
    expect((await f.command('add', {}, 'Different Category')).outputs.entryAccepted).toBe(scope !== 'all');
});

test('concurrent attempts cannot spend the final admission twice and can control only their own IDs', async () => {
    const f = fixture();
    await f.create({ maxEntriesPerUser: 1 });
    let release!: () => void, both!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
    }),
        entered = new Promise<void>((r) => {
            both = r;
        });
    let count = 0;
    f.on(async (event) => {
        if (event === 'entryAttempted') {
            if (++count === 2) both();
            await gate;
        }
    });
    const a = f.command('add'),
        b = f.command('add');
    await entered;
    release();
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.outputs.entryAccepted).sort()).toEqual([false, true]);
    expect(new Set(results.map((r) => r.outputs.entryAttemptId)).size).toBe(2);
    expect(f.root.giveaways.giveaway_Cup.admissions!.alice).toBe(1);
});

test.each(['pause', 'stop', 'closeEntries', 'reset', 'remove'])(
    'state change %s during hook is rechecked without deadlock',
    async (statusAction) => {
        const f = fixture();
        await f.create();
        f.on(async (event) => {
            if (event === 'entryAttempted')
                await f.service.manage({
                    mode: 'giveawayStatusControl',
                    giveawayTitle: 'Cup',
                    statusAction,
                } as GiveawayUpdateModel);
        });
        const result = await f.command('add');
        expect(result.outputs.entryAccepted).toBe(false);
        expect(result.outputs.entryReason).toBe(
            (
                {
                    pause: 'paused',
                    stop: 'stopped',
                    closeEntries: 'closed',
                    reset: 'giveaway_changed',
                    remove: 'giveaway_changed',
                } as any
            )[statusAction],
        );
        expect(f.root.giveaways.giveaway_Cup?.entries || []).toHaveLength(0);
    },
);

test('approval during hook is checked at commit and has priority over admission exhaustion', async () => {
    const f = fixture();
    await f.create({ winLimit: cap(), maxEntriesPerUser: 1 });
    await f.command('add');
    await f.command('pick', { autoApproveMulti: false });
    f.on(async (event) => {
        if (event === 'entryAttempted') await f.command('approve');
    });
    expect((await f.command('add')).outputs.entryReason).toBe('win_limit');
});

test('write failure cannot accept an entry or publish its acceptance', async () => {
    const f = fixture();
    await f.create();
    const before = structuredClone(f.root);
    f.fail();
    await expect(f.command('add')).rejects.toThrow('disk full');
    expect(f.root).toEqual(before);
    expect(f.events.map((e) => e.event)).toEqual(['giveawayStart', 'entryAttempted']);
});

test('direct hook failure does not silently admit an entry', async () => {
    const f = fixture();
    await f.create();
    f.on(async () => {
        throw Error('dispatch failed');
    });
    await expect(f.command('add')).rejects.toThrow('dispatch failed');
    expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
});

test.each(['source', 'unload'])('abort %s stops waiting on a hook and closes its token', async (how) => {
    const f = fixture();
    await f.create();
    let entered!: () => void,
        id = '';
    const gate = new Promise<void>((r) => {
        entered = r;
    });
    f.on(async (event, data) => {
        if (event === 'entryAttempted') {
            id = data.entryAttemptId;
            entered();
            await new Promise<void>(() => { });
        }
    });
    const controller = new AbortController(),
        operation = f.command('add', {}, 'Cup', { signal: controller.signal });
    const rejected = expect(operation).rejects.toThrow();
    await gate;
    if (how === 'source') controller.abort();
    else f.service.abortEntryAttempts();
    await rejected;
    await expect(f.control(id)).rejects.toThrow('no longer open');
    expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(0);
    await f.service.dispose();
});

test('recursive entry control context cannot create a second attempt', async () => {
    const f = fixture();
    await f.create();
    await expect(f.command('add', {}, 'Cup', { entryAttemptId: 'parent' })).rejects.toThrow('recursively');
    expect(f.events.map((e) => e.event)).toEqual(['giveawayStart']);
});

test('acceptance notification failure does not undo a committed ticket or turn it into rejection', async () => {
    const f = fixture();
    await f.create();
    f.on(async (event) => {
        if (event === 'entryAccepted') throw Error('chat failed');
    });
    expect((await f.command('add')).outputs.entryAccepted).toBe(true);
    expect(f.errors).toHaveLength(1);
    expect(f.root.giveaways.giveaway_Cup.entries).toHaveLength(1);
    expect(f.events.some((e) => e.event === 'entryRejected')).toBe(false);
});

test('a result keeps its own Change even when its notification triggers another mutation', async () => {
    const f = fixture();
    await f.create();
    f.on(async (event) => {
        if (event === 'entryAccepted') await f.create({}, 'Other');
    });
    const result = await f.command('add');
    expect(f.service.mutationChange(result)!.giveawayIds).toEqual(['giveaway_Cup']);
    expect(f.service.lastChange!.giveawayIds).toEqual(['giveaway_Other']);
});

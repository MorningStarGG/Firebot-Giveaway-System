import { GiveawayService } from '../src/utility/giveaway-service';
import { migrate, type DatabaseRoot } from '../src/utility/database';
import { weightedPick, fromEffect } from '../src/shared/giveaway-rules';
import type { EffectModel, GiveawayUpdateModel, GiveawayState } from '../src/types/types';
function fixture() {
    let root = migrate({} as DatabaseRoot),
        now = Date.parse('2026-11-15T12:00:00Z'),
        fail = false;
    const events: {
        name: string;
        data: any;
    }[] = [],
        displays: any[] = [];
    const hooks = {
        display: (...args: any[]) => {
            displays.push(args);
        },
        event: async (name: string, data: any) => {
            events.push({ name, data });
        },
        error: (e: unknown) => {
            throw e;
        },
    };
    const repo = {
        read: async () => structuredClone(root),
        write: async (value: DatabaseRoot) => {
            if (fail) throw Error('disk full');
            root = structuredClone(value);
        },
    };
    let service = new GiveawayService(
        repo,
        hooks,
        () => now,
        () => 0,
    );
    const config = (title = 'Cup', options: any = {}, rest: any = {}): EffectModel =>
        ({
            giveawayTitle: title,
            prize: 'Prize',
            styles: {} as any,
            display: {} as any,
            position: 'Middle',
            customCoords: { top: null, left: null, right: null, bottom: null },
            overlayInstance: '',
            giveawayOptions: { allowMultipleEntries: true, maxEntriesPerUser: 10, claimMode: 'enabled', ...options },
            ...rest,
        }) as EffectModel;
    const command = (entryAction: string, extra: any = {}, id = 'giveaway_Cup') =>
        service.manage({ mode: 'entryManagement', giveawayTitle: id, entryAction, ...extra } as GiveawayUpdateModel);
    return {
        config,
        command,
        repo,
        hooks,
        events,
        displays,
        get service() {
            return service;
        },
        get root() {
            return root;
        },
        get now() {
            return now;
        },
        advance(ms: number) {
            now += ms;
        },
        setFail(value: boolean) {
            fail = value;
        },
        seed(value: DatabaseRoot) {
            root = migrate(value);
        },
        async create(options: any = {}, title = 'Cup') {
            return service.configure(config(title, options));
        },
        state(id = 'giveaway_Cup') {
            return structuredClone(root.giveaways[id]);
        },
        async add(name = 'Alice', weight = 1, id = 'giveaway_Cup') {
            return command('add', { username: name, oddsMultiplier: weight }, id);
        },
        async pick(extra: any = {}, id = 'giveaway_Cup') {
            return command('pick', { autoApproveMulti: false, ...extra }, id);
        },
        async status(statusAction: string, id = 'giveaway_Cup') {
            return service.manage({
                mode: 'giveawayStatusControl',
                giveawayTitle: id,
                statusAction,
            } as GiveawayUpdateModel);
        },
        async patch(type: string, value: any, id = 'giveaway_Cup') {
            return service.manage({
                mode: 'updateDisplay',
                giveawayTitle: id,
                setting: { type, value },
            } as GiveawayUpdateModel);
        },
        async restartHost() {
            await service.dispose();
            service = new GiveawayService(
                repo,
                hooks,
                () => now,
                () => 0,
            );
            await service.initialize();
        },
    };
}
describe('Independent entries and admission limits', () => {
    test('one draw consumes exactly one ticket and holds remaining tickets until resolved', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add('ALICE', 2);
        await f.add('Bob');
        const original = f.state().entries[0];
        await f.pick();
        expect(f.state().entries).toHaveLength(2);
        expect(f.state().pendingWinners![0].entry).toEqual(original);
        expect((await f.service.eligibility('giveaway_Cup', 'Alice')).eligibleEntries).toBe(0);
        await f.command('approve', { username: 'Alice' });
        expect((await f.service.eligibility('giveaway_Cup', 'Alice')).eligibleEntries).toBe(1);
        await f.pick();
        expect(f.state().pendingWinners![0].username).toBe('alice');
    });
    test('approved users can win again with other entries by default', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add();
        await f.pick({ autoApproveMulti: true, winnerCount: 2 });
        expect(f.state().winners).toHaveLength(2);
        expect(Object.keys(f.root.approvals)).toHaveLength(2);
    });
    test('a multi-pick without auto-approval skips held users', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add();
        await f.add('Bob');
        expect((await f.pick({ winnerCount: 3 })).outputs.winner).toBe('alice, bob');
        expect(f.state().entries).toHaveLength(1);
    });
    test.each(['approve', 'deny', 'remove', 'clear', 'restart'])(
        '%s does not refund admission allowance',
        async (action) => {
            const f = fixture();
            await f.create({ maxEntriesPerUser: 1 });
            await f.add();
            if (action === 'approve' || action === 'deny') {
                await f.pick();
                await f.command(action);
            }
            if (action === 'remove') await f.command('remove', { username: 'Alice' });
            if (action === 'clear') await f.service.manage({ mode: 'clearEntries', giveawayTitle: 'Cup' });
            if (action === 'restart') await f.status('restart');
            expect(await f.add()).toMatchObject({ outputs: { entryAccepted: false, entryReason: 'entry_limit' } });
        },
    );
    test('Reset creates a new run and allowance, retaining approval history', async () => {
        const f = fixture();
        await f.create({ maxEntriesPerUser: 1 });
        await f.add();
        await f.pick({ autoApproveMulti: true });
        const run = f.state().runId;
        await f.status('reset');
        await f.add();
        expect(f.state().runId).not.toBe(run);
        expect(Object.keys(f.root.approvals)).toHaveLength(1);
    });
    test('requeue restores the exact selected ticket once and does not add admission', async () => {
        const f = fixture();
        await f.create({ requeueDenied: true });
        await f.add('Alice', 4);
        await f.add('Alice', 2);
        const ticket = f.state().entries[0];
        await f.pick();
        await f.command('deny');
        expect(f.state().entries).toEqual([expect.objectContaining({ oddsMultiplier: 2 }), ticket]);
        expect(f.state().admissions!.alice).toBe(2);
        await expect(f.command('deny')).rejects.toThrow();
    });
    test('mutations are serialized and event effects see committed state without deadlock', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add('Bob');
        f.hooks.event = async (name, data) => {
            f.events.push({ name, data });
            if (name === 'winnerPicked')
                expect(
                    (await f.service.getGiveaway('giveaway_Cup'))!.pendingWinners!.some((w) => w.winId === data.winId),
                ).toBe(true);
        };
        await Promise.all([f.pick(), f.pick()]);
        expect(f.state().pendingWinners).toHaveLength(2);
    });
    test('write failure commits nothing and emits no events or display', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        const before = f.state(),
            events = f.events.length,
            displays = f.displays.length;
        f.setFail(true);
        await expect(f.pick()).rejects.toThrow('disk full');
        expect(f.state()).toEqual(before);
        expect(f.events).toHaveLength(events);
        expect(f.displays).toHaveLength(displays);
    });
});
describe('Weights, odds and validation', () => {
    test('weight and ticket count both affect deterministic draws', () => {
        const entries = [
            { username: 'Alice', oddsMultiplier: 2 },
            { username: 'Alice', oddsMultiplier: 2 },
            { username: 'Alice', oddsMultiplier: 2 },
            { username: 'Bob', oddsMultiplier: 2 },
        ] as any;
        const counts: {
            [name: string]: number;
        } = { Alice: 0, Bob: 0 };
        for (let i = 0; i < 1000; i++) counts[weightedPick(entries, () => i / 1000)!.username]++;
        expect(counts).toEqual({ Alice: 750, Bob: 250 });
        const weighted = [
            { username: 'Alice', oddsMultiplier: 4 },
            { username: 'Bob', oddsMultiplier: 1 },
        ] as any;
        expect(
            Array.from({ length: 1000 }, (_, i) => weightedPick(weighted, () => i / 1000)!.username).filter(
                (n) => n === 'Alice',
            ),
        ).toHaveLength(800);
    });
    test('reported odds sum all eligible entries belonging to the selected person', async () => {
        const f = fixture();
        await f.create();
        await f.add('Alice', 2);
        await f.add('Alice', 2);
        await f.add('Bob', 2);
        await f.pick();
        expect(f.state().pendingWinners![0]).toMatchObject({
            oddsPercentage: '66.67',
            oddsString: '4/6',
            selectedEntryWeight: 2,
            eligibleEntries: 3,
            eligibleWeight: 6,
        });
    });
    test.each([0, -1, NaN, Infinity, -Infinity, '', false])(
        'invalid weight %p fails without changing entries',
        async (weight) => {
            const f = fixture();
            await f.create();
            await expect(f.add('Alice', weight as any)).rejects.toThrow();
            expect(f.state().entries).toHaveLength(0);
        },
    );
    test.each([0, -1, 1.5, NaN, Infinity])('invalid winner count %p is rejected', async (winnerCount) => {
        const f = fixture();
        await f.create();
        await f.add();
        await expect(f.pick({ winnerCount })).rejects.toThrow();
        expect(f.state().entries).toHaveLength(1);
    });
    test('unknown actions never fall through to add or stop', async () => {
        const f = fixture();
        await f.create();
        await expect(f.command('typo', { username: 'Alice' })).rejects.toThrow();
        await expect(f.status('typo')).rejects.toThrow();
        expect(f.state().ended).toBe(false);
    });
    test('boolean strings are parsed explicitly', async () => {
        const f = fixture();
        await f.create();
        await f.patch('autoRerollOnExpire', 'false');
        expect(f.state().autoRerollOnExpire).toBe(false);
        await expect(f.patch('autoRerollOnExpire', 'anything')).rejects.toThrow();
    });
});
describe('Per-giveaway win policies over shared approval history', () => {
    test('default unlimited, local cap, policy reset and revoke', async () => {
        const f = fixture();
        await f.create({ winLimit: { maximum: 1, scope: 'giveaway', period: 'untilReset', days: 30 } });
        await f.add();
        await f.add();
        await f.pick({ autoApproveMulti: true });
        await expect(f.pick()).rejects.toThrow('No eligible');
        await f.service.manage({ mode: 'winnerHistory', winnerHistoryAction: 'purgeAll' });
        await expect(f.pick()).rejects.toThrow('No eligible');
        await f.service.manage({ mode: 'resetWinCounts', giveawayTitle: 'Cup' });
        await f.pick({ autoApproveMulti: true });
        expect(f.state().winners).toHaveLength(2);
        await f.command('deny', { winId: f.state().winners[1].winId });
        expect((await f.service.eligibility('giveaway_Cup', 'Alice')).approvedWins).toBe(0);
    });
    test.each(['category', 'all'])('%s scope respects pending reservations across giveaways', async (scope) => {
        const f = fixture(),
            p = { maximum: 1, scope, period: 'untilReset', days: 30 };
        await f.create({ winLimit: p }, 'Cup');
        await f.create({ winLimit: p }, 'Other');
        await f.add();
        await f.add('Alice', 1, 'giveaway_Other');
        await f.pick();
        await expect(f.pick({}, 'giveaway_Other')).rejects.toThrow('No eligible');
        await f.command('deny');
        await f.pick({}, 'giveaway_Other');
    });
    test('category scope allows an unrelated category', async () => {
        const f = fixture(),
            p = { maximum: 1, scope: 'category', period: 'untilReset', days: 30 };
        await f.service.configure(f.config('Cup', { winLimit: p }, { category: 'Games' }));
        await f.service.configure(f.config('Other', { winLimit: p }, { category: 'Books' }));
        await f.add();
        await f.add('Alice', 1, 'giveaway_Other');
        await f.pick();
        await f.pick({}, 'giveaway_Other');
        expect(f.state('giveaway_Other').pendingWinners).toHaveLength(1);
    });
    test('policies remain independent: A cap one does not impose that cap on B cap two', async () => {
        const f = fixture();
        await f.create({ winLimit: { maximum: 1, scope: 'all' } }, 'Cup');
        await f.create({ winLimit: { maximum: 2, scope: 'all' } }, 'Other');
        await f.add();
        await f.add('Alice', 1, 'giveaway_Other');
        await f.pick({ autoApproveMulti: true });
        await f.pick({ autoApproveMulti: true }, 'giveaway_Other');
        expect(f.state('giveaway_Other').winners).toHaveLength(1);
    });
    test('rolling window expires by approval time', async () => {
        const f = fixture();
        await f.create({ winLimit: { maximum: 1, scope: 'all', period: 'rolling', days: 1 } });
        await f.add();
        await f.add();
        await f.pick({ autoApproveMulti: true });
        f.advance(86400001);
        await f.pick({ autoApproveMulti: true });
        expect(f.state().winners).toHaveLength(2);
    });
    test('approval revalidates a changed cap and preserves the pending win on failure', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add();
        await f.pick({ autoApproveMulti: true });
        await f.pick();
        const win = f.state().pendingWinners![0];
        await f.patch('winLimit', { maximum: 1, scope: 'giveaway' });
        await expect(f.command('approve', { winId: win.winId })).rejects.toThrow('remains unresolved');
        expect(f.state().pendingWinners![0].winId).toBe(win.winId);
    });
    test('resetting policy counts affects only the selected giveaway', async () => {
        const f = fixture();
        for (const title of ['Cup', 'Other']) await f.create({ winLimit: { maximum: 1, scope: 'all' } }, title);
        await f.add();
        await f.add();
        await f.add('Alice', 1, 'giveaway_Other');
        await f.pick({ autoApproveMulti: true });
        await f.service.manage({ mode: 'resetWinCounts', giveawayTitle: 'Cup' });
        await expect(f.pick({}, 'giveaway_Other')).rejects.toThrow();
        await f.pick();
    });
});
describe('Claim deadlines and lifecycle', () => {
    test('pause/resume preserves a half second and expires normally', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 1 });
        await f.add();
        await f.pick();
        f.advance(500);
        await f.status('pause');
        expect(f.state().pausedClaimRemaining![f.state().pendingWinners![0].winId!]).toBe(0.5);
        f.advance(10000);
        await f.status('resume');
        f.advance(499);
        await f.service.tick();
        expect(f.state().pendingWinners).toHaveLength(1);
        f.advance(1);
        await f.service.tick();
        expect(f.state().winners[0].status).toBe('expired');
    });
    test('a manual paused draw remains available and its timer stays frozen', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 1 });
        await f.add();
        await f.status('pause');
        await f.pick();
        expect(f.state().pendingWinners![0].claimDeadline).toBeUndefined();
        f.advance(10000);
        await f.service.tick();
        expect(f.state().pendingWinners).toHaveLength(1);
        await f.status('resume');
        f.advance(1000);
        await f.service.tick();
        expect(f.state().winners[0].status).toBe('expired');
    });
    test('manual stopped draws remain available', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.status('stop');
        await f.pick();
        expect(f.state().pendingWinners).toHaveLength(1);
    });
    test('only expired startup claims get a fresh window and ordinary ticks do not renew', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 10 });
        await f.add();
        await f.add('Bob');
        await f.pick();
        f.advance(5000);
        await f.pick();
        f.advance(6000);
        const bob = f.state().pendingWinners![1].claimDeadline;
        await f.restartHost();
        expect(f.state().pendingWinners![0].claimDeadline).toBe(new Date(f.now + 10000).toISOString());
        expect(f.state().pendingWinners![1].claimDeadline).toBe(bob);
        f.advance(10000);
        await f.service.tick();
        expect(f.state().pendingWinners).toHaveLength(0);
    });
    test('changing duration applies to pending wins without auto-approving, unchanged edits preserve deadlines', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 10 });
        await f.add();
        await f.pick();
        f.advance(1000);
        const original = f.state().pendingWinners![0].claimDeadline;
        await f.patch('claimDuration', 10);
        expect(f.state().pendingWinners![0].claimDeadline).toBe(original);
        await f.patch('claimDuration', 20);
        expect(f.state().pendingWinners![0].claimDeadline).toBe(new Date(f.now + 20000).toISOString());
        await f.patch('claimMode', 'disabled');
        expect(f.state().pendingWinners![0].status).toBe('pending');
        expect(f.state().pendingWinners![0].claimDeadline).toBeUndefined();
    });
    test('changing paused duration keeps a frozen timer', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 10 });
        await f.add();
        await f.pick();
        await f.status('pause');
        await f.patch('claimDuration', 20);
        expect(f.state().pendingWinners![0].claimDeadline).toBeUndefined();
        expect(Object.values(f.state().pausedClaimRemaining!)).toEqual([20]);
    });
    test('Reset invalidates old claim work and new winners expire only at their deadline', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 1 });
        await f.add();
        await f.pick();
        await f.status('reset');
        f.advance(500);
        await f.add('Bob');
        await f.pick();
        f.advance(500);
        await f.service.tick();
        expect(f.state().pendingWinners![0].username).toBe('bob');
        f.advance(500);
        await f.service.tick();
        expect(f.state().pendingWinners).toHaveLength(0);
    });
    test('auto-close is idempotent and does not stop unresolved claims', async () => {
        const f = fixture();
        await f.create({ autoClose: true, duration: 1 });
        await f.add();
        await f.pick();
        f.advance(1000);
        await f.service.tick();
        await f.service.tick();
        expect(f.state()).toMatchObject({ entriesClosed: true, ended: false });
        expect(f.state().pendingWinners).toHaveLength(1);
        expect(f.events.filter((e) => e.name === 'winnerPicked')).toHaveLength(1);
    });
});
describe('Rerolls and backups', () => {
    test('reroll targets the requested username and keeps its resolved record', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add('Bob');
        await f.add('Carol');
        await f.pick({ winnerCount: 2 });
        await f.command('reroll', { username: 'Bob' });
        expect(f.state().pendingWinners!.map((w) => w.username)).toEqual(['alice', 'carol']);
        expect(f.state().winners[0]).toMatchObject({ username: 'bob', status: 'denied', resolutionReason: 'reroll' });
    });
    test('reroll without replacement succeeds and does not emit Empty while another claim remains', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add('Bob');
        await f.pick({ winnerCount: 2 });
        expect((await f.command('reroll', { username: 'Alice' })).outputs.winner).toBe('');
        expect(f.state().winners).toHaveLength(1);
        expect(f.events.filter((e) => e.name === 'giveawayEmpty')).toHaveLength(0);
    });
    test.each(['different', 'allowPrevious'])(
        'reroll mode %s applies only to the immediate replacement',
        async (rerollMode) => {
            const f = fixture();
            await f.create({ rerollMode, requeueDenied: true });
            await f.add();
            await f.add();
            await f.pick();
            const result = await f.command('reroll');
            expect(result.outputs.winner).toBe(rerollMode === 'different' ? '' : 'alice');
            if (rerollMode === 'different') {
                await f.pick();
                expect(f.state().pendingWinners![0].username).toBe('alice');
            }
        },
    );
    test('auto expiry reroll also honors different-person mode', async () => {
        const f = fixture();
        await f.create({ claimMode: 'timer', claimDuration: 1, requeueExpired: true, autoRerollOnExpire: true });
        await f.add();
        await f.add();
        await f.pick();
        f.advance(1000);
        await f.service.tick();
        expect(f.state().pendingWinners).toHaveLength(0);
        expect(f.state().entries).toHaveLength(2);
    });
    test('merge restores full snapshot when target does not exist', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.status('remove');
        const id = Object.keys(f.root.backups)[0];
        await f.service.restoreGiveaway(id, 'merge');
        expect(f.state().entries).toHaveLength(1);
        expect(Object.keys(f.root.backups)).toHaveLength(0);
    });
    test('merge enforces admission caps and retains backup when entries are skipped', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add();
        await f.status('remove');
        const id = Object.keys(f.root.backups)[0];
        await f.create({ allowMultipleEntries: false, maxEntriesPerUser: 1 });
        const result = await f.service.restoreGiveaway(id, 'merge');
        expect(result).toMatchObject({ skipped: 1, retained: true });
        expect(f.state().entries).toHaveLength(1);
        expect(f.root.backups[id]).toBeDefined();
        await f.service.restoreGiveaway(id, 'merge');
        expect(f.state().entries).toHaveLength(1);
    });
    test('manual backup matching does not confuse Cup with Cup2 and missing backups fail', async () => {
        const f = fixture();
        await f.create({}, 'Cup2');
        await f.status('remove', 'giveaway_Cup2');
        await expect(f.service.manualBackup('Cup', 'restore')).rejects.toThrow('No backup');
        expect(Object.keys(f.root.backups)).toHaveLength(1);
    });
    test('missing backups section no longer prevents ended cleanup, and history purge uses approval time', async () => {
        const f = fixture();
        await f.create({ retentionDays: 1 });
        await f.add();
        await f.pick();
        f.advance(40 * 86400000);
        await f.command('approve');
        await f.status('stop');
        f.advance(2 * 86400000);
        await f.service.cleanupExpiredGiveaways();
        expect(f.state()).toBeUndefined();
        expect(Object.keys(f.root.winnerHistory)).toHaveLength(1);
        expect(Object.keys(f.root.approvals)).toHaveLength(1);
    });
    test('unload blocks future operations', async () => {
        const f = fixture();
        await f.create();
        await f.service.dispose();
        await expect(f.add()).rejects.toThrow('unloaded');
    });
    test('merge retains unresolved backup claims and imports resolved records without charging another run’s admissions', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.add('Bob');
        await f.pick({ autoApproveMulti: true });
        await f.pick();
        await f.status('remove');
        const id = Object.keys(f.root.backups)[0];
        await f.create();
        const result = await f.service.restoreGiveaway(id, 'merge');
        expect(result).toMatchObject({ retained: true, skipped: 1 });
        expect(f.state().winners).toHaveLength(1);
        await f.service.configure(f.config());
        expect(f.state().admissions!.alice || 0).toBe(0);
    });
    test('restoring a pre-approval pending snapshot cannot replay a durable approved or revoked win', async () => {
        const f = fixture();
        await f.create();
        await f.add();
        await f.pick();
        await f.status('remove');
        const originalId = Object.keys(f.root.backups)[0],
            snapshot = structuredClone(f.root.backups[originalId]);
        await f.service.restoreGiveaway(originalId);
        await f.command('approve');
        const winId = f.state().winners[0].winId!;
        let root = await f.repo.read();
        root.backups[originalId] = snapshot;
        await f.repo.write(root);
        await f.restartHost();
        await f.service.restoreGiveaway(originalId);
        expect(f.state().pendingWinners).toHaveLength(0);
        expect(f.state().winners[0].status).toBe('approved');
        await f.command('deny', { winId });
        root = await f.repo.read();
        root.backups[originalId] = snapshot;
        await f.repo.write(root);
        await f.restartHost();
        await f.service.restoreGiveaway(originalId);
        expect(f.state().pendingWinners).toHaveLength(0);
        expect(f.state().winners[0].status).toBe('denied');
        expect((await f.service.eligibility('giveaway_Cup', 'Alice')).approvedWins).toBe(0);
    });
    test('legacy top-level close-time inputs work and clear wins over another timer edit', async () => {
        const f = fixture();
        await f.create();
        await f.service.manage({ mode: 'updateDisplay', giveawayTitle: 'Cup', closeTimeSeconds: 5 });
        expect(f.state().closeTime).toBe(new Date(f.now + 5000).toISOString());
        await f.service.manage({
            mode: 'updateDisplay',
            giveawayTitle: 'Cup',
            giveawayOptions: { duration: 10 },
            clearCloseTime: true,
        });
        expect(f.state().closeTime).toBeUndefined();
    });
});

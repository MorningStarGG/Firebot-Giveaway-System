import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, migrate, normalizeUsernames, type DatabaseRoot } from '../src/utility/database';
import { fromEffect } from '../src/shared/giveaway-rules';
import type { EffectModel } from '../src/types/types';
let directory: string;
beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'firebot-giveaway-db-'));
});
afterEach(async () => {
    const resolved = path.resolve(directory);
    if (
        path.dirname(resolved) === path.resolve(os.tmpdir()) &&
        path.basename(resolved).startsWith('firebot-giveaway-db-')
    )
        await fs.rm(resolved, { recursive: true, force: true });
});
const legacyState = () => {
    const state = fromEffect({
        giveawayTitle: 'Cup',
        prize: 'Prize',
        giveawayOptions: {},
        styles: {},
        display: {},
    } as EffectModel);
    state.uuid = 'legacy-uuid';
    state.createdAt = state.updatedAt = '2026-01-01T00:00:00.000Z';
    delete state.runId;
    delete state.admissions;
    state.entries = [{ username: 'Alice', oddsMultiplier: 2, enteredAt: state.createdAt }];
    state.winners = [
        { username: 'Bob', oddsMultiplier: 1, wonAt: state.createdAt, approvedAt: state.createdAt, status: 'approved' },
    ];
    return state;
};
test('imports only the current profile legacy DB, preserving source, raw backup and unknown root values', async () => {
    const target = path.join(directory, 'profile/script-data/plugin-key'),
        legacy = path.join(directory, 'profile/db/giveawaySystem.db');
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    const state = legacyState(),
        text = '\uFEFF' + JSON.stringify({ giveaways: { giveaway_Cup: state }, futureSettings: { preserve: true } });
    await fs.writeFile(legacy, text);
    const repo = await openDatabase(target),
        root = await repo.read();
    expect(root.futureSettings).toEqual({ preserve: true });
    expect(root.giveaways.giveaway_Cup.uuid).toBe('legacy-uuid');
    expect(root.giveaways.giveaway_Cup.entries[0].entryId).toBeTruthy();
    expect(root.giveaways.giveaway_Cup.admissions).toEqual({ alice: 1, bob: 1 });
    expect(Object.keys(root.approvals)).toHaveLength(1);
    expect(await fs.readFile(legacy, 'utf8')).toBe(text);
    const backup = (await fs.readdir(target)).find((n) => n.startsWith('legacy-giveaway-'));
    expect(await fs.readFile(path.join(target, backup!), 'utf8')).toBe(text);
});
test('existing scoped destination wins and entry/win/run IDs remain stable across loads', async () => {
    const target = path.join(directory, 'profile/script-data/plugin-key');
    const repo = await openDatabase(target);
    const root = await repo.read();
    root.giveaways.giveaway_Cup = legacyState();
    delete root.schemaVersion;
    await repo.write(migrate(root));
    const legacy = path.join(directory, 'profile/db/giveawaySystem.db');
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, 'invalid legacy JSON');
    const before = await repo.read(),
        after = await (await openDatabase(target)).read();
    expect(after).toEqual(before);
});
test('current and archived copies are deduplicated into one approval record', () => {
    const state = legacyState(),
        win = state.winners[0],
        input = {
            giveaways: { giveaway_Cup: state },
            winnerHistory: {
                'archived-win': {
                    giveawayId: 'giveaway_Cup',
                    giveawayUuid: state.uuid,
                    giveawayTitle: 'Cup',
                    category: 'Games',
                    prize: 'Prize',
                    storedAt: state.createdAt,
                    source: 'approved',
                    winner: win,
                },
            },
        } as any;
    const root = migrate(input);
    expect(root.giveaways.giveaway_Cup.winners[0].winId).toBe('archived-win');
    expect(Object.keys(root.approvals)).toEqual(['archived-win']);
});

test('normalizes saved account fields without changing IDs, tickets, weights, or configuration', () => {
    const state = legacyState();
    state.entries.push({ ...state.entries[0], username: 'ALICE', oddsMultiplier: 3 });
    state.admissions = { Alice: 2, alice: 3 };
    const root = migrate({ giveaways: { giveaway_Cup: state } } as any);
    // Simulate a schema-v2 file created before username normalization.
    const live = root.giveaways.giveaway_Cup;
    live.entries[0].username = ' Alice ';
    live.entries[1].username = 'ALICE';
    live.winners[0].username = 'BoB';
    live.winners[0].entry!.username = 'BOB';
    const pending = structuredClone(live.winners[0]);
    pending.winId = 'pending-win';
    pending.entry!.entryId = 'pending-entry';
    pending.status = 'pending';
    pending.username = 'ChArLiE';
    pending.entry!.username = 'CHARLIE';
    live.pendingWinners = [pending];
    live.admissions = { Alice: 2, alice: 3, BOB: 1, Charlie: 1 };
    root.backups.snapshot = { ...structuredClone(live), removedAt: state.createdAt };
    for (const record of Object.values(root.winnerHistory)) {
        record.winner.username = 'BOB';
        record.winner.entry!.username = 'Bob';
    }
    for (const record of Object.values(root.approvals)) record.username = 'BoB';
    root.futureSettings = { username: 'PreserveUnknownMetadata' };
    const before = structuredClone(root);
    expect(normalizeUsernames(root)).toBe(true);
    for (const current of [root.giveaways.giveaway_Cup, root.backups.snapshot]) {
        expect(current.entries.map((e) => e.username)).toEqual(['alice', 'alice']);
        expect(current.entries.map((e) => e.entryId)).toEqual(
            before.giveaways.giveaway_Cup.entries.map((e) => e.entryId),
        );
        expect(current.entries.map((e) => e.oddsMultiplier)).toEqual([2, 3]);
        expect(current.winners[0].username).toBe('bob');
        expect(current.winners[0].entry!.username).toBe('bob');
        expect(current.pendingWinners![0].username).toBe('charlie');
        expect(current.pendingWinners![0].entry!.username).toBe('charlie');
        expect(current.admissions).toEqual({ alice: 5, bob: 1, charlie: 1 });
        expect(current.giveawayData).toEqual(before.giveaways.giveaway_Cup.giveawayData);
        expect(current.runId).toBe(before.giveaways.giveaway_Cup.runId);
    }
    expect(Object.keys(root.winnerHistory)).toEqual(Object.keys(before.winnerHistory));
    expect(Object.keys(root.approvals)).toEqual(Object.keys(before.approvals));
    expect(root.approvalSequence).toBe(before.approvalSequence);
    expect(Object.values(root.winnerHistory)[0].winner.username).toBe('bob');
    expect(Object.values(root.winnerHistory)[0].winner.entry!.username).toBe('bob');
    expect(Object.values(root.approvals)[0].username).toBe('bob');
    expect(root.futureSettings).toEqual(before.futureSettings);
    expect(normalizeUsernames(root)).toBe(false);
});

test('upgrades mixed-case schema-v2 data once and preserves a byte-for-byte backup', async () => {
    const root = migrate({ giveaways: { giveaway_Cup: legacyState() } } as any);
    const state = root.giveaways.giveaway_Cup;
    state.entries[0].username = 'ALICE';
    state.winners[0].username = 'BOB';
    state.winners[0].entry!.username = 'BOB';
    for (const record of Object.values(root.approvals)) record.username = 'BOB';
    for (const record of Object.values(root.winnerHistory)) record.winner.username = 'BOB';
    const target = path.join(directory, 'giveawaySystem.db'),
        text = JSON.stringify(root);
    await fs.writeFile(target, text);
    const after = await (await openDatabase(directory)).read();
    expect(after.giveaways.giveaway_Cup.entries[0]).toEqual({ ...state.entries[0], username: 'alice' });
    expect(after.giveaways.giveaway_Cup.winners[0]).toEqual({
        ...state.winners[0],
        username: 'bob',
        entry: { ...state.winners[0].entry, username: 'bob' },
    });
    expect(after.approvalSequence).toBe(root.approvalSequence);
    const backupName = (await fs.readdir(directory)).find((n) => n.startsWith('pre-username-normalization-giveaway-'))!;
    expect(await fs.readFile(path.join(directory, backupName), 'utf8')).toBe(text);
    const persisted = await fs.readFile(target, 'utf8');
    const modified = (await fs.stat(target)).mtimeMs;
    expect(await (await openDatabase(directory)).read()).toEqual(after);
    expect(await fs.readFile(target, 'utf8')).toBe(persisted);
    expect((await fs.stat(target)).mtimeMs).toBe(modified);
    expect((await fs.readdir(directory)).filter((n) => n.startsWith('pre-username-normalization-giveaway-'))).toEqual([
        backupName,
    ]);
});
test.each(['{broken', '{"schemaVersion":99}', '{"giveaways":[]}'])(
    'rejects invalid persisted DB %s without overwriting it',
    async (text) => {
        await fs.writeFile(path.join(directory, 'giveawaySystem.db'), text);
        await expect(openDatabase(directory)).rejects.toThrow();
        expect(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8')).toBe(text);
    },
);
test('invalid saved weights block migration without modifying the source', async () => {
    const state = legacyState();
    state.entries[0].oddsMultiplier = -1;
    const text = JSON.stringify({ giveaways: { giveaway_Cup: state } });
    await fs.writeFile(path.join(directory, 'giveawaySystem.db'), text);
    await expect(openDatabase(directory)).rejects.toThrow('weight');
    expect(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8')).toBe(text);
});
test('scoped legacy migration saves a raw pre-migration backup and stages atomic writes', async () => {
    const text = JSON.stringify({ giveaways: { giveaway_Cup: legacyState() } });
    await fs.writeFile(path.join(directory, 'giveawaySystem.db'), text);
    const repo = await openDatabase(directory),
        root = await repo.read();
    root.future = 123;
    await repo.write(root);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'giveawaySystem.db'), 'utf8')).future).toBe(123);
    const files = await fs.readdir(directory);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    const backup = files.find((f) => f.startsWith('pre-migration-giveaway-'));
    expect(await fs.readFile(path.join(directory, backup!), 'utf8')).toBe(text);
});

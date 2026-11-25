import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { GiveawayState, BackupGiveaway, WinnerHistoryRecord, ApprovalRecord } from '../types/types';
import {
    hydrate,
    key,
    positive,
    normalizeStateUsernames,
    normalizeWinnerUsername,
    normalizeUsernameRecord,
} from '../shared/giveaway-rules';
import type { GiveawayTemplate } from '../types/ui';
export interface DatabaseRoot {
    templateLibrary?: Record<string, GiveawayTemplate>;
    schemaVersion?: number;
    giveaways: Record<string, GiveawayState>;
    backups: Record<string, BackupGiveaway>;
    winnerHistory: Record<string, WinnerHistoryRecord>;
    winnerHistorySettings?: {
        retentionMs: number;
        updatedAt: string;
    };
    approvals: Record<string, ApprovalRecord>;
    approvalSequence: number;
    [name: string]: unknown;
}
export interface Repository {
    read(): Promise<DatabaseRoot>;
    write(root: DatabaseRoot): Promise<void>;
}
const object = (value: unknown): value is Record<string, any> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
export function validateDatabase(value: unknown): asserts value is DatabaseRoot {
    if (!object(value) || (value.schemaVersion != null && value.schemaVersion !== 2))
        throw new Error('Invalid or unsupported giveaway database');
    if (value.templateLibrary !== undefined) {
        if (!object(value.templateLibrary)) throw new Error('Invalid template library');
        for (const [id, t] of Object.entries(value.templateLibrary) as [string, any][])
            if (
                !object(t) ||
                t.id !== id ||
                typeof t.name !== 'string' ||
                !t.name.trim() ||
                !object(t.configuration) ||
                !object(t.configuration.styles) ||
                !Number.isFinite(Date.parse(t.updatedAt))
            )
                throw new Error('Invalid saved template');
    }
    for (const name of ['giveaways', 'backups', 'winnerHistory', 'approvals'])
        if (value[name] != null && !object(value[name])) throw new Error(`Invalid ${name} section`);
    if (value.schemaVersion === 2) {
        for (const name of ['giveaways', 'backups', 'winnerHistory', 'approvals'])
            if (!object(value[name])) throw new Error(`Missing ${name} section`);
        if (!Number.isSafeInteger(value.approvalSequence) || value.approvalSequence < 0)
            throw new Error('Invalid approval sequence');
        for (const [id, r] of Object.entries(value.approvals) as [string, any][]) {
            if (
                !object(r) ||
                r.winId !== id ||
                typeof r.username !== 'string' ||
                typeof r.giveawayId !== 'string' ||
                typeof r.runId !== 'string' ||
                typeof r.category !== 'string' ||
                !Number.isFinite(Date.parse(r.approvedAt)) ||
                !Number.isSafeInteger(r.sequence) ||
                r.sequence < 1 ||
                r.sequence > value.approvalSequence
            )
                throw new Error('Invalid approval ledger');
        }
    }
    for (const state of [...Object.values(value.giveaways || {}), ...Object.values(value.backups || {})] as any[]) {
        if (
            !object(state) ||
            typeof state.uuid !== 'string' ||
            !object(state.giveawayData) ||
            typeof state.giveawayData.title !== 'string' ||
            !Array.isArray(state.entries) ||
            !Array.isArray(state.winners) ||
            (state.pendingWinners != null && !Array.isArray(state.pendingWinners))
        )
            throw new Error('Invalid giveaway state');
        for (const entry of state.entries) {
            if (
                !object(entry) ||
                typeof entry.username !== 'string' ||
                !entry.username.trim() ||
                !Number.isFinite(Date.parse(entry.enteredAt))
            )
                throw new Error('Invalid saved entry');
            positive(entry.oddsMultiplier, 'Saved entry weight');
        }
        const entries = new Set(state.entries.map((e: any) => e.entryId).filter(Boolean));
        if (value.schemaVersion === 2 && entries.size !== state.entries.length)
            throw new Error('Duplicate or missing entry IDs');
        for (const win of [...state.winners, ...(state.pendingWinners || [])])
            if (
                !object(win) ||
                typeof win.username !== 'string' ||
                !['approved', 'pending', 'claimed', 'denied', 'expired'].includes(win.status) ||
                !Number.isFinite(Date.parse(win.wonAt))
            )
                throw new Error('Invalid saved winner');
        for (const stamp of [
            state.createdAt,
            state.updatedAt,
            ...(state.pendingWinners || []).map((w: any) => w.claimDeadline).filter(Boolean),
        ])
            if (!Number.isFinite(Date.parse(stamp))) throw new Error('Invalid saved timestamp');
        if (value.schemaVersion === 2) {
            if (
                typeof state.runId !== 'string' ||
                !state.runId ||
                !object(state.admissions) ||
                Object.values(state.admissions).some((n) => !Number.isSafeInteger(n) || Number(n) < 0)
            )
                throw new Error('Invalid run or admission counts');
            const wins = [...state.winners, ...(state.pendingWinners || [])];
            if (
                new Set(wins.map((w) => w.winId)).size !== wins.length ||
                wins.some((w) => typeof w.winId !== 'string' || !w.winId || !w.entry?.entryId)
            )
                throw new Error('Invalid or duplicate win IDs');
        }
    }
}
/** Normalize known account fields only, preserve record IDs, configuration, and unknown metadata. */
export function normalizeUsernames(root: DatabaseRoot): boolean {
    let changed = false;
    for (const state of [...Object.values(root.giveaways || {}), ...Object.values(root.backups || {})])
        changed = normalizeStateUsernames(state) || changed;
    for (const record of Object.values(root.winnerHistory || {}))
        changed = normalizeWinnerUsername(record.winner) || changed;
    for (const record of Object.values(root.approvals || {})) changed = normalizeUsernameRecord(record) || changed;
    return changed;
}
export function migrate(input: DatabaseRoot): DatabaseRoot {
    validateDatabase(input);
    const root = structuredClone(input);
    normalizeUsernames(root);
    root.giveaways ||= {};
    root.backups ||= {};
    root.winnerHistory ||= {};
    root.approvals ||= {};
    root.approvalSequence ||= 0;
    // Match archival copies to live/backup winners before assigning any missing IDs.
    const signature = (
        giveawayId: string,
        w: {
            username: string;
            wonAt: string;
        },
        uuid?: string,
    ) => JSON.stringify([giveawayId, uuid, key(w.username), w.wonAt]);
    const archived = new Map<string, string[]>();
    for (const [id, r] of Object.entries(root.winnerHistory)) {
        if (!r?.winner?.username) throw new Error('Invalid winner history record');
        if (!r.giveawayUuid) {
            const candidates = new Set(
                [...Object.entries(root.giveaways), ...Object.entries(root.backups)]
                    .filter(
                        ([storedId, s]) =>
                            storedId.split('::backup::')[0] === r.giveawayId &&
                            [...s.winners, ...(s.pendingWinners || [])].some(
                                (w) => key(w.username) === key(r.winner.username) && w.wonAt === r.winner.wonAt,
                            ),
                    )
                    .map(([, s]) => s.uuid),
            );
            if (candidates.size === 1) r.giveawayUuid = [...candidates][0];
        }
        const sig = signature(r.giveawayId, r.winner, r.giveawayUuid);
        archived.set(sig, [...(archived.get(sig) || []), id]);
    }
    const legacyIDs = new Map<string, string>();
    for (const [storedId, state] of [...Object.entries(root.giveaways), ...Object.entries(root.backups)]) {
        const id = storedId.split('::backup::')[0];
        const winners = [...state.winners, ...(state.pendingWinners || [])];
        const signatures = new Map<string, number>();
        for (const w of winners) {
            const sig = signature(id, w, state.uuid);
            signatures.set(sig, (signatures.get(sig) || 0) + 1);
        }
        for (const w of winners) {
            const sig = signature(id, w, state.uuid),
                ids = archived.get(sig),
                unique = signatures.get(sig) === 1;
            if (!w.winId && unique && ids?.length === 1) w.winId = ids[0];
            if (!w.winId && unique && legacyIDs.has(sig)) w.winId = legacyIDs.get(sig);
            w.winId ||= randomUUID();
            if (unique) legacyIDs.set(sig, w.winId);
        }
        hydrate(state);
        for (const w of state.winners.filter((w) => w.status === 'approved')) {
            if (!root.winnerHistory[w.winId!])
                root.winnerHistory[w.winId!] = {
                    giveawayId: id,
                    giveawayUuid: state.uuid,
                    giveawayTitle: state.giveawayData.title,
                    prize: state.giveawayData.prize,
                    category: state.giveawayData.category || 'uncategorized',
                    storedAt: w.approvedAt || w.wonAt,
                    source: 'approved',
                    winner: { ...w },
                };
            if (!root.approvals[w.winId!])
                root.approvals[w.winId!] = {
                    winId: w.winId!,
                    giveawayId: id,
                    runId: w.runId!,
                    username: w.username,
                    category: state.giveawayData.category || 'uncategorized',
                    approvedAt: w.approvedAt || w.wonAt,
                    sequence: ++root.approvalSequence,
                };
        }
    }
    for (const [id, r] of Object.entries(root.winnerHistory))
        if (r.winner.status === 'approved' && !root.approvals[id])
            root.approvals[id] = {
                winId: id,
                giveawayId: r.giveawayId,
                runId: r.winner.runId || `legacy:${r.giveawayUuid}`,
                username: r.winner.username,
                category: r.category || 'uncategorized',
                approvedAt: r.winner.approvedAt || r.winner.wonAt || r.storedAt,
                sequence: ++root.approvalSequence,
            };
    root.schemaVersion = 2;
    validateDatabase(root);
    return root;
}
async function load(file: string): Promise<
    | {
        text: string;
        data: DatabaseRoot;
    }
    | undefined
> {
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
    let data: unknown;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
        throw new Error(`Giveaway database is not valid JSON: ${file}`);
    }
    validateDatabase(data);
    return { text, data };
}
async function backup(directory: string, label: string, text: string) {
    const hash = createHash('sha256').update(text).digest('hex');
    await fs.writeFile(path.join(directory, `${label}-${hash}.db.backup`), text, { flag: 'wx' }).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
    });
}
export async function openDatabase(storagePath: string): Promise<Repository> {
    const directory = path.resolve(storagePath),
        target = path.join(directory, 'giveawaySystem.db');
    await fs.mkdir(directory, { recursive: true });
    let existing = await load(target);
    if (!existing) {
        const legacyPath =
            path.basename(path.dirname(directory)) === 'script-data'
                ? path.join(path.dirname(path.dirname(directory)), 'db', 'giveawaySystem.db')
                : undefined;
        const legacy = legacyPath ? await load(legacyPath) : undefined;
        if (legacy) await backup(directory, 'legacy-giveaway', legacy.text);
        const data = migrate(legacy?.data || ({} as DatabaseRoot));
        const stage = path.join(directory, `.giveaway-${randomUUID()}.tmp`);
        try {
            await fs.writeFile(stage, JSON.stringify(data, null, 2), { flag: 'wx' });
            try {
                await fs.link(stage, target);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
        } finally {
            await fs.rm(stage, { force: true });
        }
        existing = await load(target);
    }
    if (!existing) throw new Error('Giveaway database disappeared during initialization');
    const repository: Repository = {
        read: async () => {
            const loaded = await load(target);
            if (!loaded) throw new Error('Giveaway database is missing');
            return structuredClone(loaded.data);
        },
        write: async (root) => {
            validateDatabase(root);
            const stage = path.join(directory, `.giveaway-${randomUUID()}.tmp`);
            try {
                await fs.writeFile(stage, JSON.stringify(root, null, 2), { flag: 'wx' });
                await fs.rename(stage, target);
            } finally {
                await fs.rm(stage, { force: true });
            }
        },
    };
    if (existing.data.schemaVersion !== 2) {
        await backup(directory, 'pre-migration-giveaway', existing.text);
        await repository.write(migrate(existing.data));
    } else {
        const normalized = structuredClone(existing.data);
        if (normalizeUsernames(normalized)) {
            await backup(directory, 'pre-username-normalization-giveaway', existing.text);
            await repository.write(normalized);
        }
    }
    return repository;
}

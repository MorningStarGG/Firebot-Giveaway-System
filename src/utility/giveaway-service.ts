import type { Change, DataArea, RowQuery, GiveawayTemplate, TemplateBundle } from '../types/ui';
import { configurationOf } from '../shared/configuration';
import { TemplateResources, digest, bundleLimit } from './template-resources';
import { templateConfiguration, templateName, readBundle, templateSummary, templateRecord } from './template-format';
import { randomUUID } from 'node:crypto';
import { entryAdmission, entryReasons, type EntryReason } from '../shared/entry-admission';
import { EntryAttempts, awaitEntryHook, type EntryContext } from './entry-attempts';
import type {
    GiveawayState,
    GiveawayWinner,
    EffectModel,
    GiveawayUpdateModel,
    GiveawayManagerResult,
} from '../types/types';
import type { DatabaseRoot, Repository } from './database';
import {
    clone,
    key,
    resolveId,
    positive,
    boolean,
    choice,
    username,
    policy,
    fromEffect,
    validateState,
    eligible,
    weightedPick,
    odds,
    winCount,
} from '../shared/giveaway-rules';
type Notice =
    | {
        id: string;
        state: GiveawayState;
        type: 'update' | 'remove' | 'show';
    }
    | {
        event: string;
        data: Record<string, unknown>;
    };
export interface ServiceHooks {
    changed?(change: Change): void;
    display(id: string, state: GiveawayState, type: 'update' | 'remove' | 'show'): void;
    event(name: string, data: Record<string, unknown>): Promise<void>;
    error(error: unknown): void;
}
export class GiveawayService {
    private entryAttempts = new EntryAttempts();
    private resultChanges = new WeakMap<object, Change>();
    private tail: Promise<unknown> = Promise.resolve();
    private disposed = false;
    private nextDue = Infinity;
    private current?: DatabaseRoot;
    private loading?: Promise<DatabaseRoot>;
    readonly generation = randomUUID();
    private revision = 0;
    lastChange?: Change;
    constructor(
        private repository: Repository,
        private hooks: ServiceHooks,
        private now = () => Date.now(),
        private random?: () => number,
        private resources?: TemplateResources,
    ) { }
    private iso() {
        return new Date(this.now()).toISOString();
    }
    private async committed(): Promise<DatabaseRoot> {
        return (this.current ||= await (this.loading ||= this.repository.read()));
    }
    private async transaction<T>(
        operation: (root: DatabaseRoot, notices: Notice[]) => T | Promise<T>,
        hints: DataArea[] = [],
        signal?: AbortSignal,
    ): Promise<T> {
        if (this.disposed) throw new Error('Giveaway System is unloaded');
        const notices: Notice[] = [];
        let change: Change;
        const task = this.tail.then(async () => {
            if (this.disposed) throw new Error('Giveaway System is unloaded');
            const before = await this.committed(),
                root = clone(before),
                result = await operation(root, notices);
            signal?.throwIfAborted();
            await this.repository.write(root);
            this.current = root;
            const areas = new Set<DataArea>(hints),
                ids = [
                    ...new Set(notices.filter((n): n is Extract<Notice, { id: string }> => 'id' in n).map((n) => n.id)),
                ];
            for (const id of ids) {
                areas.add('summary');
                const a = before.giveaways[id],
                    b = root.giveaways[id];
                if (!a || !b || this.configRevision(a) !== this.configRevision(b)) areas.add('configuration');
                for (const [area, field] of [
                    ['entries', 'entries'],
                    ['pending', 'pendingWinners'],
                    ['winners', 'winners'],
                ] as const)
                    if (!a || !b || JSON.stringify(a[field]) !== JSON.stringify(b[field])) areas.add(area);
            }
            if (notices.some((n) => 'event' in n && ['winnerApproved', 'winnerDenied'].includes(n.event)))
                areas.add('history');
            if (Object.keys(before.backups).join() !== Object.keys(root.backups).join()) areas.add('backups');
            change = { generation: this.generation, revision: ++this.revision, giveawayIds: ids, areas: [...areas] };
            this.lastChange = change;
            this.nextDue = Object.values(root.giveaways).reduce((next, s) => {
                const deadlines = [
                    s.overlayHideAt,
                    ...(!s.paused
                        ? [
                            ...(!s.ended ? [s.closeTime] : []),
                            ...(s.pendingWinners || [])
                                .filter((w) => w.status === 'pending')
                                .map((w) => w.claimDeadline),
                        ]
                        : []),
                ];
                for (const deadline of deadlines)
                    if (deadline && Number.isFinite(Date.parse(deadline))) next = Math.min(next, Date.parse(deadline));
                return next;
            }, Infinity);
            return clone(result);
        });
        this.tail = task.catch(() => { });
        const result = await task;
        if (result && typeof result === 'object') this.resultChanges.set(result, change!);
        try {
            this.hooks.changed?.(change!);
        } catch (error) {
            this.hooks.error(error);
        }
        // Commit and release the lock before invoking Firebot effects, which may call us again.
        for (const n of notices)
            if ('id' in n)
                try {
                    this.hooks.display(n.id, n.state, n.type);
                } catch (error) {
                    this.hooks.error(error);
                }
        for (const n of notices)
            if ('event' in n)
                try {
                    await this.hooks.event(n.event, n.data);
                } catch (error) {
                    this.hooks.error(error);
                }
        return result;
    }
    private async read() {
        await this.tail;
        return this.committed();
    }
    mutationChange(result: unknown) {
        return result && typeof result === 'object' ? this.resultChanges.get(result) : undefined;
    }
    abortEntryAttempts() {
        this.entryAttempts.stop();
    }
    private resolveManagedId(root: DatabaseRoot, effect: Partial<GiveawayUpdateModel>) {
        let input = effect.giveawaySelectionMode === 'manual' ? effect.manualGiveawayTitle : effect.giveawayTitle;
        if (!input && effect.giveawaySelectionMode === 'manual') {
            const ids = Object.keys(root.giveaways).filter((id) => !root.giveaways[id].ended);
            if (ids.length !== 1) throw new Error('Specify a giveaway when there is not exactly one active giveaway');
            input = ids[0];
        }
        return resolveId(input);
    }
    private async addEntry(effect: Partial<GiveawayUpdateModel>, context: EntryContext) {
        if (context.entryAttemptId)
            throw new Error('Do not call Add Entry recursively from Entry Attempted, use its attempt controls');
        const signal = this.entryAttempts.signal(context.signal);
        signal.throwIfAborted();
        const name = username(effect.username),
            weight = positive(effect.oddsMultiplier ?? 1, 'Entry weight');
        const root = await this.read(),
            id = this.resolveManagedId(root, effect),
            original = this.require(root, id);
        signal.throwIfAborted();
        const uuid = original.uuid,
            runId = original.runId;
        const attempt = this.entryAttempts.open(weight);
        const metadata = (data: DatabaseRoot, state: GiveawayState) => ({
            entryAttemptId: attempt.id,
            username: name,
            giveawayId: id,
            giveawayTitle: state.giveawayData.title,
            category: state.giveawayData.category || 'uncategorized',
            prize: state.giveawayData.prize,
            runId,
            totalEntries: state.entries.length,
            oddsMultiplier: attempt.weight,
            ...entryAdmission(data, id, state, name, this.now()),
        });
        const reject = async (reason: EntryReason, data: Record<string, unknown>, count: number) => {
            signal.throwIfAborted();
            const reasonText = reason === 'cancelled' ? attempt.reason || entryReasons.cancelled : entryReasons[reason];
            const outcome = { ...data, entryAccepted: false, canEnter: false, reason, reasonText };
            try {
                await this.hooks.event('entryRejected', outcome);
            } catch (error) {
                this.hooks.error(error);
            }
            return {
                success: true,
                outputs: {
                    winner: '',
                    entryCount: count,
                    entryAccepted: false,
                    entryReason: reason,
                    entryReasonText: reasonText,
                    entryAttemptId: attempt.id,
                    entryOddsMultiplier: attempt.weight,
                },
            };
        };
        try {
            await awaitEntryHook(
                Promise.resolve().then(() => {
                    signal.throwIfAborted();
                    return this.hooks.event('entryAttempted', metadata(root, original));
                }),
                signal,
            );
            // Closing before scheduling the commit defines the deadline for inline controls.
            this.entryAttempts.close(attempt.id);
            signal.throwIfAborted();
            if (attempt.error) throw attempt.error;
            if (attempt.cancelled) {
                const current = await this.read(),
                    state = current.giveaways[id];
                const sameRun = state?.uuid === uuid && state.runId === runId;
                return await reject(
                    'cancelled',
                    metadata(current, sameRun ? state : original),
                    state?.entries.length || 0,
                );
            }
            // A typed internal refusal exits transaction before any write, revision, or display update.
            let refusal: { reason: EntryReason; data: Record<string, unknown>; count: number } | undefined;
            const refused = new Error('Entry refused');
            try {
                return await this.transaction(
                    (current, notices) => {
                        signal.throwIfAborted();
                        const state = current.giveaways[id];
                        const changed = !state || state.uuid !== uuid || state.runId !== runId;
                        const data = metadata(current, changed ? original : state);
                        const decision = changed
                            ? 'giveaway_changed'
                            : entryAdmission(current, id, state, name, this.now()).reason;
                        if (decision !== 'accepted') {
                            refusal = { reason: decision, data, count: state?.entries.length || 0 };
                            throw refused;
                        }
                        const entryId = randomUUID();
                        state.entries.push({
                            entryId,
                            username: name,
                            oddsMultiplier: attempt.weight,
                            enteredAt: this.iso(),
                        });
                        state.admissions![key(name)] = (state.admissions![key(name)] || 0) + 1;
                        this.touch(id, state, notices);
                        const outcome = {
                            ...metadata(current, state),
                            entryAccepted: true,
                            canEnter: true,
                            reason: 'accepted',
                            reasonText: entryReasons.accepted,
                            entryId,
                        };
                        notices.push({ event: 'entryAccepted', data: outcome });
                        return {
                            success: true,
                            outputs: {
                                winner: '',
                                entryCount: state.entries.length,
                                entryAccepted: true,
                                entryReason: 'accepted',
                                entryReasonText: entryReasons.accepted,
                                entryAttemptId: attempt.id,
                                entryOddsMultiplier: attempt.weight,
                            },
                        };
                    },
                    [],
                    signal,
                );
            } catch (error) {
                if (error !== refused || !refusal) throw error;
                return await reject(refusal.reason, refusal.data, refusal.count);
            }
        } finally {
            this.entryAttempts.close(attempt.id);
        }
    }
    private require(root: DatabaseRoot, id: string) {
        const state = root.giveaways[id];
        if (!state) throw new Error(`Giveaway not found: ${id}`);
        return state;
    }
    private touch(id: string, state: GiveawayState, notices: Notice[], type: 'update' | 'remove' | 'show' = 'update') {
        state.updatedAt = this.iso();
        state.totalEntries = state.entries.length;
        notices.push({ id, state: clone(state), type });
    }
    private event(
        notices: Notice[],
        event: string,
        id: string,
        state: GiveawayState,
        win?: GiveawayWinner,
        detail: Record<string, unknown> = {},
    ) {
        notices.push({
            event,
            data: {
                giveawayId: id,
                giveawayTitle: state.giveawayData.title,
                category: state.giveawayData.category || 'uncategorized',
                prize: state.giveawayData.prize,
                totalEntries: state.entries.length,
                runId: state.runId,
                ...(win
                    ? {
                        winner: win.username,
                        winId: win.winId,
                        entryId: win.entry?.entryId,
                        selectedEntryWeight: win.selectedEntryWeight ?? win.oddsMultiplier,
                        oddsPercentage: win.oddsPercentage,
                        oddsString: win.oddsString,
                        eligibleEntries: win.eligibleEntries,
                        eligibleWeight: win.eligibleWeight,
                    }
                    : {}),
                ...detail,
            },
        });
    }
    private archive(root: DatabaseRoot, id: string, state: GiveawayState, win: GiveawayWinner) {
        if (win.status !== 'approved') return;
        if (root.approvals[win.winId!]?.revokedAt) return;
        const category = state.giveawayData.category || 'uncategorized';
        root.winnerHistory[win.winId!] ||= {
            giveawayId: id,
            giveawayUuid: state.uuid,
            giveawayTitle: state.giveawayData.title,
            prize: state.giveawayData.prize,
            category,
            storedAt: this.iso(),
            source: 'approved',
            winner: clone(win),
        };
        root.approvals[win.winId!] ||= {
            winId: win.winId!,
            giveawayId: id,
            runId: win.runId || state.runId!,
            username: win.username,
            category,
            approvedAt: win.approvedAt || win.wonAt,
            sequence: ++root.approvalSequence,
        };
    }
    private archiveState(root: DatabaseRoot, id: string, state: GiveawayState) {
        for (const w of state.winners) this.archive(root, id, state, w);
    }
    private pending(state: GiveawayState, name?: string, winId?: string) {
        const win = (state.pendingWinners || []).find((w) =>
            winId ? w.winId === winId : !name || key(w.username) === key(name),
        );
        if (!win) throw new Error('No matching unresolved win');
        return win;
    }
    private requeue(state: GiveawayState, win: GiveawayWinner) {
        if (win.entry && !state.entries.some((e) => e.entryId === win.entry!.entryId))
            state.entries.push(clone(win.entry));
    }
    private finish(state: GiveawayState, win: GiveawayWinner) {
        state.pendingWinners = state.pendingWinners!.filter((w) => w.winId !== win.winId);
        delete state.pausedClaimRemaining?.[win.winId!];
        delete win.claimDeadline;
        if (!state.winners.some((w) => w.winId === win.winId)) state.winners.push(win);
    }
    private resolved(notices: Notice[], id: string, state: GiveawayState, reason: string) {
        if (!state.entries.length && !state.pendingWinners?.length)
            this.event(notices, 'giveawayEmpty', id, state, undefined, { reason });
        if (!state.pendingWinners?.length && state.autoRemoveAfterClose)
            state.overlayHideAt = new Date(this.now() + state.displayDuration * 1000).toISOString();
    }
    private deadline(state: GiveawayState, win: GiveawayWinner) {
        delete win.claimDeadline;
        state.pausedClaimRemaining ||= {};
        delete state.pausedClaimRemaining[win.winId!];
        if (state.claimMode === 'timer' && win.status === 'pending') {
            if (state.paused) state.pausedClaimRemaining[win.winId!] = state.claimDuration;
            else win.claimDeadline = new Date(this.now() + state.claimDuration * 1000).toISOString();
        }
    }
    private configureClaims(state: GiveawayState, before: GiveawayState) {
        if (before.claimMode !== state.claimMode || before.claimDuration !== state.claimDuration)
            for (const w of state.pendingWinners || []) this.deadline(state, w);
    }
    private start(id: string, state: GiveawayState, notices: Notice[]) {
        const wasPaused = state.paused;
        state.ended = false;
        state.paused = false;
        state.entriesClosed = false;
        delete state.entriesClosedAt;
        delete state.overlayHideAt;
        state.closeTime = state.autoClose ? new Date(this.now() + state.duration! * 1000).toISOString() : undefined;
        if (wasPaused)
            for (const w of state.pendingWinners || []) {
                const seconds = state.pausedClaimRemaining?.[w.winId!];
                if (seconds != null && w.status === 'pending')
                    w.claimDeadline = new Date(this.now() + seconds * 1000).toISOString();
            }
        state.pausedClaimRemaining = {};
        delete state.pausedCloseRemainingSeconds;
        this.event(notices, 'giveawayStart', id, state, undefined, { duration: state.duration || 0 });
    }
    async configure(
        effect: EffectModel,
        start = true,
        target?: string,
        guard?: { createOnly?: boolean; expectedRevision?: string },
    ) {
        return this.transaction((root, notices) => {
            const id = target ? resolveId(target) : resolveId(effect.giveawayTitle),
                old = root.giveaways[id],
                before = old && clone(old),
                state = fromEffect(effect, old);
            if (target && resolveId(effect.giveawayTitle) !== id)
                throw new Error(
                    'Changing a title cannot change an existing giveaway ID, create a new giveaway instead',
                );
            if (guard?.createOnly && old)
                throw new Error('A giveaway with this ID already exists, select it or choose another title');
            if (target && !old) throw new Error('This giveaway no longer exists');
            if (guard?.expectedRevision && old && guard.expectedRevision !== this.configRevision(old))
                throw new Error(
                    'Configuration changed elsewhere. Reload and review before saving, your draft has been saved.',
                );
            root.giveaways[id] = state;
            if (before) this.configureClaims(state, before);
            if (start) this.start(id, state, notices);
            else if (before && (before.autoClose !== state.autoClose || before.duration !== state.duration)) {
                if (state.paused || state.entriesClosed)
                    state.pausedCloseRemainingSeconds = state.autoClose ? state.duration : null;
                else
                    state.closeTime =
                        state.autoClose && !state.ended
                            ? new Date(this.now() + state.duration! * 1000).toISOString()
                            : undefined;
            }
            this.touch(id, state, notices, start ? 'show' : 'update');
            return { id, state, configRevision: this.configRevision(state) };
        });
    }
    private approve(root: DatabaseRoot, id: string, state: GiveawayState, win: GiveawayWinner, notices: Notice[]) {
        const p = policy(state.winLimit);
        if (
            p.maximum != null &&
            winCount(Object.values(root.approvals), id, state, win.username, this.now()) >= p.maximum
        )
            throw new Error('Win limit reached since this draw, the win remains unresolved');
        win.status = 'approved';
        win.approvedAt = this.iso();
        this.finish(state, win);
        this.archive(root, id, state, win);
        this.event(notices, 'winnerApproved', id, state, win, { approved: true });
        this.resolved(notices, id, state, 'approved');
    }
    private draw(
        root: DatabaseRoot,
        id: string,
        state: GiveawayState,
        notices: Notice[],
        autoApprove = false,
        exclude?: string,
    ) {
        const pool = eligible(root, id, state, this.now(), exclude),
            entry = weightedPick(pool, this.random);
        if (!entry) return null;
        const win: GiveawayWinner = {
            winId: randomUUID(),
            entry: clone(entry),
            runId: state.runId,
            username: entry.username,
            oddsMultiplier: entry.oddsMultiplier,
            wonAt: this.iso(),
            status: 'pending',
            ...odds(pool, entry),
        };
        state.entries = state.entries.filter((e) => e.entryId !== entry.entryId);
        state.pendingWinners ||= [];
        state.pendingWinners.push(win);
        delete state.overlayHideAt;
        this.event(notices, 'winnerPicked', id, state, win);
        if (autoApprove || state.requireClaim === false) this.approve(root, id, state, win, notices);
        else this.deadline(state, win);
        return win;
    }
    private deny(
        root: DatabaseRoot,
        id: string,
        state: GiveawayState,
        win: GiveawayWinner,
        notices: Notice[],
        reason = 'denied',
    ) {
        if (!['pending', 'claimed', 'approved'].includes(win.status)) throw new Error('Win is already resolved');
        const wasApproved = win.status === 'approved';
        win.status = 'denied';
        win.deniedAt = this.iso();
        win.resolutionReason = reason;
        this.finish(state, win);
        if (state.requeueDenied) this.requeue(state, win);
        if (wasApproved) {
            const record = root.approvals[win.winId!];
            if (record) record.revokedAt = this.iso();
            delete root.winnerHistory[win.winId!];
        }
        this.event(notices, 'winnerDenied', id, state, win, { approved: false, reason });
    }
    private expire(root: DatabaseRoot, id: string, state: GiveawayState, win: GiveawayWinner, notices: Notice[]) {
        win.status = 'expired';
        win.expiredAt = this.iso();
        this.finish(state, win);
        if (state.requeueExpired) this.requeue(state, win);
        this.event(notices, 'winnerExpired', id, state, win);
        if (state.autoRerollOnExpire && !state.paused && !state.ended)
            this.draw(root, id, state, notices, false, state.rerollMode === 'different' ? win.username : undefined);
        this.resolved(notices, id, state, 'expired');
    }
    private lifecycle(root: DatabaseRoot, id: string, state: GiveawayState, action: string, notices: Notice[]) {
        switch (action) {
            case 'stop':
                state.ended = true;
                state.entriesClosed = true;
                delete state.closeTime;
                this.event(notices, 'giveawayStop', id, state, undefined, {
                    stopType: 'manual',
                    runTime: Math.floor((this.now() - Date.parse(state.createdAt)) / 1000),
                });
                if (state.autoRemoveAfterClose)
                    state.overlayHideAt = new Date(this.now() + state.displayDuration * 1000).toISOString();
                break;
            case 'restart':
                this.start(id, state, notices);
                break;
            case 'reset':
                this.archiveState(root, id, state);
                state.entries = [];
                state.winners = [];
                state.pendingWinners = [];
                state.admissions = {};
                state.runId = randomUUID();
                state.createdAt = this.iso();
                this.start(id, state, notices);
                break;
            case 'pause':
                if (state.paused) break;
                state.paused = true;
                state.pausedCloseRemainingSeconds = state.closeTime
                    ? Math.max(0, (Date.parse(state.closeTime) - this.now()) / 1000)
                    : state.pausedCloseRemainingSeconds;
                delete state.closeTime;
                state.pausedClaimRemaining ||= {};
                for (const w of state.pendingWinners || [])
                    if (w.claimDeadline) {
                        state.pausedClaimRemaining[w.winId!] = Math.max(
                            0,
                            (Date.parse(w.claimDeadline) - this.now()) / 1000,
                        );
                        delete w.claimDeadline;
                    }
                break;
            case 'resume':
                if (!state.paused) break;
                state.paused = false;
                if (!state.entriesClosed && state.pausedCloseRemainingSeconds != null) {
                    state.closeTime = new Date(this.now() + state.pausedCloseRemainingSeconds * 1000).toISOString();
                    delete state.pausedCloseRemainingSeconds;
                }
                for (const w of state.pendingWinners || []) {
                    const remaining = state.pausedClaimRemaining?.[w.winId!];
                    if (remaining != null && w.status === 'pending')
                        w.claimDeadline = new Date(this.now() + remaining * 1000).toISOString();
                }
                state.pausedClaimRemaining = {};
                break;
            case 'closeEntries':
                state.entriesClosed = true;
                state.entriesClosedAt = this.iso();
                if (state.closeTime)
                    state.pausedCloseRemainingSeconds = Math.max(0, (Date.parse(state.closeTime) - this.now()) / 1000);
                delete state.closeTime;
                break;
            case 'openEntries':
                state.entriesClosed = false;
                delete state.entriesClosedAt;
                if (!state.paused && state.pausedCloseRemainingSeconds != null) {
                    state.closeTime = new Date(this.now() + state.pausedCloseRemainingSeconds * 1000).toISOString();
                    delete state.pausedCloseRemainingSeconds;
                }
                break;
            case 'remove':
                this.backup(root, id, state, notices);
                break;
            default:
                throw new Error('Invalid giveaway status action');
        }
    }
    private backup(root: DatabaseRoot, id: string, state: GiveawayState, notices: Notice[]) {
        this.archiveState(root, id, state);
        const backupId = `${id}::backup::${this.now()}-${randomUUID()}`;
        root.backups[backupId] = { ...clone(state), id: backupId, removedAt: this.iso() };
        delete root.giveaways[id];
        this.touch(id, state, notices, 'remove');
    }
    async manage(
        effect: Partial<GiveawayUpdateModel> & {
            mode: string;
        },
        context: EntryContext = {},
    ): Promise<GiveawayManagerResult> {
        // All Manager paths expose a common output shape, entry-specific fields are additive.
        if (this.disposed) throw new Error('Giveaway System is unloaded');
        const action = effect.entryAction || effect.action || 'add';
        if (['entryManagement', 'manageEntries'].includes(effect.mode)) {
            if (action === 'cancelAttempt' || action === 'setAttemptOdds') {
                try {
                    if (effect.entryAttemptId != null && typeof effect.entryAttemptId !== 'string')
                        throw new Error('Entry Attempt ID must be text');
                    const id = effect.entryAttemptId?.trim() || context.entryAttemptId;
                    if (context.entryAttemptId && id !== context.entryAttemptId)
                        throw new Error('Entry Attempt ID does not match the current Entry Attempted event');
                    const { attempt, changed } = this.entryAttempts.control(
                        id,
                        action,
                        effect.oddsMultiplier,
                        effect.cancellationReason,
                    );
                    return {
                        success: true,
                        outputs: {
                            winner: '',
                            entryCount: 0,
                            entryAttemptId: attempt.id,
                            entryOddsMultiplier: attempt.weight,
                            entryAttemptUpdated: changed,
                        },
                    };
                } catch (error) {
                    this.entryAttempts.fail(context.entryAttemptId, error);
                    throw error;
                }
            }
            if (action === 'add') return this.addEntry(effect, context);
        }
        return this.transaction(
            (root, notices) => {
                if (effect.mode === 'winnerHistory') return this.historyAction(root, effect);
                const id = this.resolveManagedId(root, effect),
                    state = this.require(root, id),
                    before = clone(state);
                let winner = '';
                switch (effect.mode) {
                    case 'entryManagement':
                    case 'manageEntries': {
                        const action = effect.entryAction || effect.action || 'add';
                        switch (action) {
                            case 'remove': {
                                const name = username(effect.username),
                                    all = boolean(effect.removeAllEntries ?? true);
                                let removed = false;
                                state.entries = state.entries.filter((e) => {
                                    if (key(e.username) !== key(name) || (!all && removed)) return true;
                                    removed = true;
                                    return false;
                                });
                                break;
                            }
                            case 'pick': {
                                const count = positive(effect.winnerCount ?? 1, 'Winner count', true);
                                if (count > 10000) throw new Error('Winner count exceeds 10000 per action');
                                const names: string[] = [];
                                for (let i = 0; i < count; i++) {
                                    const win = this.draw(
                                        root,
                                        id,
                                        state,
                                        notices,
                                        boolean(effect.autoApproveMulti ?? true),
                                    );
                                    if (!win) break;
                                    names.push(win.username);
                                }
                                if (!names.length)
                                    throw new Error(
                                        'No eligible entries available (pending wins or win limits may hold entries)',
                                    );
                                winner = names.join(', ');
                                break;
                            }
                            case 'claim': {
                                const win = this.pending(
                                    state,
                                    effect.username ? username(effect.username) : undefined,
                                    effect.winId,
                                );
                                if (!effect.username && !effect.winId)
                                    throw new Error('Username or Win ID is required');
                                if (
                                    win.status !== 'pending' ||
                                    (win.claimDeadline && Date.parse(win.claimDeadline) <= this.now())
                                )
                                    throw new Error('Win is already claimed or its deadline passed');
                                win.status = 'claimed';
                                win.claimedAt = this.iso();
                                delete win.claimDeadline;
                                delete state.pausedClaimRemaining?.[win.winId!];
                                this.event(notices, 'winnerClaimed', id, state, win);
                                break;
                            }
                            case 'approve':
                                this.approve(
                                    root,
                                    id,
                                    state,
                                    this.pending(state, effect.username, effect.winId),
                                    notices,
                                );
                                break;
                            case 'deny': {
                                const win =
                                    (state.pendingWinners || []).find((w) =>
                                        effect.winId
                                            ? w.winId === effect.winId
                                            : !effect.username || key(w.username) === key(effect.username),
                                    ) ||
                                    [...state.winners]
                                        .reverse()
                                        .find(
                                            (w) =>
                                                w.status === 'approved' &&
                                                (effect.winId
                                                    ? w.winId === effect.winId
                                                    : !!effect.username && key(w.username) === key(effect.username)),
                                        );
                                if (!win) throw new Error('No matching unresolved or approved win');
                                this.deny(root, id, state, win, notices);
                                this.resolved(notices, id, state, 'denied');
                                break;
                            }
                            case 'reroll': {
                                const win = this.pending(state, effect.username, effect.winId);
                                this.deny(root, id, state, win, notices, 'reroll');
                                const next = this.draw(
                                    root,
                                    id,
                                    state,
                                    notices,
                                    false,
                                    state.rerollMode === 'different' ? win.username : undefined,
                                );
                                winner = next?.username || '';
                                this.resolved(notices, id, state, 'reroll');
                                break;
                            }
                            default:
                                throw new Error('Invalid entry action');
                        }
                        break;
                    }
                    case 'clearEntries':
                        state.entries = [];
                        break;
                    case 'giveawayStatusControl':
                        this.lifecycle(root, id, state, effect.statusAction || 'stop', notices);
                        break;
                    case 'removeGiveaway':
                        this.backup(root, id, state, notices);
                        break;
                    case 'toggleVisibility': {
                        const action = choice(effect.visibilityAction, ['show', 'hide'], 'visibility action');
                        delete state.overlayHideAt;
                        this.touch(id, state, notices, action === 'show' ? 'show' : 'remove');
                        return { success: true, outputs: { winner, entryCount: state.entries.length } };
                    }
                    case 'resetWinCounts':
                        state.winLimitResetAt = this.iso();
                        state.winLimitResetSequence = root.approvalSequence;
                        break;
                    case 'updateStyles':
                    case 'updateDisplay':
                    case 'updateText':
                    case 'updatePosition':
                    case 'updatePolicy':
                        this.patch(state, effect);
                        this.configureClaims(state, before);
                        break;
                    default:
                        throw new Error('Unknown giveaway manager mode');
                }
                if (root.giveaways[id]) {
                    validateState(state);
                    this.touch(
                        id,
                        state,
                        notices,
                        effect.mode === 'giveawayStatusControl' &&
                            ['restart', 'reset'].includes(effect.statusAction || '')
                            ? 'show'
                            : 'update',
                    );
                }
                return { success: true, outputs: { winner, entryCount: state.entries.length } };
            },
            effect.mode === 'winnerHistory' ? ['history'] : [],
        );
    }
    private patch(state: GiveawayState, effect: Partial<GiveawayUpdateModel>) {
        const data = state.giveawayData,
            display = data.display as any,
            styles = data.styles as any;
        const options = new Set([
            'allowMultipleEntries',
            'maxEntriesPerUser',
            'autoClose',
            'duration',
            'requireClaim',
            'claimMode',
            'autoRerollOnExpire',
            'requeueExpired',
            'requeueDenied',
            'retentionDays',
            'displayDuration',
            'autoRemoveAfterClose',
            'claimDuration',
            'enableClaimTimer',
            'rerollMode',
            'winLimit',
        ]);
        const apply = (type: string, value: unknown) => {
            if (['__proto__', 'constructor', 'prototype'].includes(type)) throw new Error('Invalid setting');
            if (type === 'autoCloseSeconds') {
                const seconds = positive(value, 'Auto-close seconds');
                state.autoClose = true;
                state.duration = seconds;
                if (state.paused || state.entriesClosed) state.pausedCloseRemainingSeconds = seconds;
                else state.closeTime = new Date(this.now() + seconds * 1000).toISOString();
                return;
            }
            if (type === 'clearCloseTime') {
                if (boolean(value)) {
                    delete state.closeTime;
                    delete state.pausedCloseRemainingSeconds;
                }
                return;
            }
            if (['category', 'entryCommand', 'claimCommand'].includes(type)) {
                (data as any)[type] = String(value ?? '');
                return;
            }
            if (['entriesClosedText', 'prizeLabelText', 'statLabelText'].includes(type)) {
                (data as any)[type] = String(value ?? '');
                display[type] = String(value ?? '');
                return;
            }
            if (options.has(type)) {
                if (type === 'requireClaim')
                    state.claimMode = boolean(value) ? (state.enableClaimTimer ? 'timer' : 'enabled') : 'disabled';
                else if (type === 'enableClaimTimer')
                    state.claimMode = boolean(value) ? 'timer' : state.requireClaim === false ? 'disabled' : 'enabled';
                else (state as any)[type] = value;
                return;
            }
            if (type in styles) {
                styles[type] = value;
                return;
            }
            if (type in display) {
                display[type] = value;
                if (type === 'minimalMode') display.widgetMode = boolean(value) ? 'minimal' : 'full';
                if (type === 'imageOnlyMode') display.displayMode = boolean(value) ? 'imageOnly' : 'widgetImage';
                if (['showOdds', 'showOddsPercentage', 'showOddsRatio'].includes(type)) {
                    display[type] = boolean(value);
                    display.oddsMode = !display.showOdds
                        ? 'disabled'
                        : display.showOddsPercentage && display.showOddsRatio
                            ? 'both'
                            : display.showOddsPercentage
                                ? 'percent'
                                : display.showOddsRatio
                                    ? 'ratio'
                                    : 'disabled';
                }
                return;
            }
            throw new Error(`Unknown setting: ${type}`);
        };
        const autoBefore = [state.autoClose, state.duration];
        if (effect.mode === 'updatePosition') {
            if (effect.position !== undefined) state.position = effect.position;
            if (effect.customCoords) state.customCoords = clone(effect.customCoords);
            if (effect.overlayInstance !== undefined) state.overlayInstance = effect.overlayInstance;
        } else if (effect.mode === 'updatePolicy') {
            state.winLimit = policy(effect.giveawayOptions?.winLimit);
            if (effect.giveawayOptions?.rerollMode) state.rerollMode = effect.giveawayOptions.rerollMode;
        } else if (effect.setting?.type) apply(effect.setting.type, effect.setting.value);
        else {
            if (effect.mode === 'updateStyles') for (const [k, v] of Object.entries(effect.styles || {})) apply(k, v);
            if (effect.mode === 'updateDisplay' || effect.mode === 'updateText')
                for (const [k, v] of Object.entries(effect.display || {})) apply(k, v);
            if (effect.mode === 'updateDisplay')
                for (const [k, v] of Object.entries(effect.giveawayOptions || {})) apply(k, v);
            if (effect.category !== undefined) data.category = effect.category;
        }
        validateState(state);
        if (autoBefore[0] !== state.autoClose || autoBefore[1] !== state.duration) {
            if (state.paused || state.entriesClosed)
                state.pausedCloseRemainingSeconds = state.autoClose ? state.duration : null;
            else
                state.closeTime =
                    state.autoClose && !state.ended
                        ? new Date(this.now() + state.duration! * 1000).toISOString()
                        : undefined;
        }
        if (effect.mode === 'updateDisplay') {
            if (effect.closeTimeSeconds != null) apply('autoCloseSeconds', effect.closeTimeSeconds);
            if (effect.clearCloseTime != null && boolean(effect.clearCloseTime)) apply('clearCloseTime', true);
        }
    }
    private historyAction(root: DatabaseRoot, effect: Partial<GiveawayUpdateModel>) {
        const action = choice(
            effect.winnerHistoryAction ?? 'setRetention',
            ['setRetention', 'purgeOlderThan', 'purgeUser', 'purgeUserOlderThan', 'purgeAll'],
            'history action',
        );
        const units = { minutes: 60000, hours: 3600000, days: 86400000, years: 365 * 86400000 },
            unit = choice(
                effect.winnerHistoryUnit ?? 'days',
                Object.keys(units) as (keyof typeof units)[],
                'history unit',
            );
        const age = positive(effect.winnerHistoryValue ?? 30, 'History retention') * units[unit];
        if (!Number.isSafeInteger(Math.floor(age))) throw new Error('History duration is too large');
        if (action === 'setRetention') root.winnerHistorySettings = { retentionMs: age, updatedAt: this.iso() };
        const name = ['purgeUser', 'purgeUserOlderThan'].includes(action)
            ? username(effect.winnerHistoryUsername)
            : undefined;
        const cutoff = ['setRetention', 'purgeOlderThan', 'purgeUserOlderThan'].includes(action)
            ? this.now() - age
            : undefined;
        let removed = 0;
        for (const [id, r] of Object.entries(root.winnerHistory))
            if (
                (!name || key(r.winner.username) === key(name)) &&
                (cutoff === undefined || Date.parse(r.winner.approvedAt || r.winner.wonAt || r.storedAt) < cutoff)
            ) {
                delete root.winnerHistory[id];
                removed++;
            }
        return { success: true, removed, outputs: { winner: '', entryCount: 0 } };
    }
    async restoreGiveaway(backupId: string, mode: 'merge' | 'overwrite' = 'overwrite') {
        return this.transaction((root, notices) => {
            choice(mode, ['merge', 'overwrite'], 'restore mode');
            const backup = root.backups[backupId];
            if (!backup) throw new Error('Backup not found');
            const id = resolveId(backupId.split('::backup::')[0]),
                current = root.giveaways[id];
            let skipped = 0;
            if (mode === 'merge' && current) {
                const known = new Set(
                    [
                        ...current.entries,
                        ...current.winners.map((w) => w.entry!),
                        ...(current.pendingWinners || []).map((w) => w.entry!),
                    ]
                        .filter(Boolean)
                        .map((e) => e.entryId),
                );
                const cap = current.allowMultipleEntries ? current.maxEntriesPerUser : 1;
                for (const entry of backup.entries) {
                    if (known.has(entry.entryId)) continue;
                    const used = current.admissions![key(entry.username)] || 0;
                    if (used >= cap) {
                        skipped++;
                        continue;
                    }
                    current.entries.push(clone(entry));
                    known.add(entry.entryId);
                    current.admissions![key(entry.username)] = used + 1;
                }
                const wins = new Set([...current.winners, ...(current.pendingWinners || [])].map((w) => w.winId));
                for (const win of backup.winners)
                    if (!wins.has(win.winId)) {
                        const restored = clone(win),
                            revoked = root.approvals[win.winId!]?.revokedAt;
                        if (restored.status === 'approved' && revoked) {
                            restored.status = 'denied';
                            restored.deniedAt = revoked;
                            restored.resolutionReason = 'approval revoked';
                        }
                        current.winners.push(restored);
                        wins.add(win.winId);
                    }
                // Unresolved claims cannot be moved into another run without changing their policy context.
                skipped += (backup.pendingWinners || []).filter((w) => !wins.has(w.winId)).length;
                if (!skipped) delete root.backups[backupId];
                this.touch(id, current, notices);
                return { skipped, retained: skipped > 0, id };
            }
            this.archiveState(root, id, current || backup);
            const state = clone(backup);
            delete state.id;
            delete (state as any).removedAt;
            for (const win of [...state.winners, ...(state.pendingWinners || [])]) {
                const approval = root.approvals[win.winId!];
                if (!approval) continue;
                if (approval.revokedAt) {
                    win.status = 'denied';
                    win.deniedAt = approval.revokedAt;
                    win.resolutionReason = 'approval revoked';
                } else {
                    win.status = 'approved';
                    win.approvedAt = approval.approvedAt;
                }
                if (state.pendingWinners!.some((w) => w.winId === win.winId)) this.finish(state, win);
            }
            if (current) this.touch(id, current, notices, 'remove');
            state.uuid = randomUUID();
            root.giveaways[id] = state;
            delete root.backups[backupId];
            this.renewExpired(state);
            this.touch(id, state, notices);
            return { skipped: 0, retained: false, id };
        });
    }
    async removeBackup(backupId: string) {
        return this.transaction((root) => {
            const backup = root.backups[backupId];
            if (!backup) throw new Error('Backup not found');
            this.archiveState(root, backupId.split('::backup::')[0], backup);
            delete root.backups[backupId];
            return true;
        });
    }
    async manualBackup(title: string, action: string) {
        const backups = await this.getBackupGiveaways(),
            id = title.includes('::backup::') ? title : resolveId(title);
        const backup = title.includes('::backup::')
            ? backups.find((b) => b.id === title)
            : backups
                .filter((b) => b.id?.split('::backup::')[0] === id)
                .sort((a, b) => Date.parse(b.removedAt) - Date.parse(a.removedAt))[0];
        if (!backup?.id) throw new Error('No backup found for this giveaway');
        if (action === 'restore') return this.restoreGiveaway(backup.id);
        if (action === 'remove') return this.removeBackup(backup.id);
        throw new Error('Invalid backup action');
    }
    private renewExpired(state: GiveawayState) {
        if (state.paused) return;
        for (const win of state.pendingWinners || [])
            if (
                win.status === 'pending' &&
                state.claimMode === 'timer' &&
                (!win.claimDeadline || Date.parse(win.claimDeadline) <= this.now())
            )
                this.deadline(state, win);
    }
    async initialize() {
        return this.transaction((root) => {
            for (const state of Object.values(root.giveaways)) this.renewExpired(state);
        });
    }
    async tick() {
        if (this.now() < this.nextDue) return;
        return this.transaction((root, notices) => {
            for (const [id, state] of Object.entries(root.giveaways)) {
                let changed = false;
                if (!state.paused)
                    for (const win of [...(state.pendingWinners || [])])
                        if (
                            win.status === 'pending' &&
                            win.claimDeadline &&
                            Date.parse(win.claimDeadline) <= this.now()
                        ) {
                            this.expire(root, id, state, win, notices);
                            changed = true;
                        }
                if (!state.paused && !state.ended && state.closeTime && Date.parse(state.closeTime) <= this.now()) {
                    state.entriesClosed = true;
                    state.entriesClosedAt = this.iso();
                    delete state.closeTime;
                    delete state.pausedCloseRemainingSeconds;
                    if (!state.pendingWinners?.length) this.draw(root, id, state, notices);
                    changed = true;
                }
                if (changed) this.touch(id, state, notices);
                if (state.overlayHideAt && Date.parse(state.overlayHideAt) <= this.now()) {
                    delete state.overlayHideAt;
                    this.touch(id, state, notices, 'remove');
                }
            }
        });
    }
    async cleanupExpiredGiveaways() {
        return this.transaction(
            (root, notices) => {
                for (const [id, state] of Object.entries(root.giveaways))
                    if (state.ended && this.now() - Date.parse(state.updatedAt) > state.retentionDays * 86400000) {
                        this.archiveState(root, id, state);
                        delete root.giveaways[id];
                        this.touch(id, state, notices, 'remove');
                    }
                for (const [id, state] of Object.entries(root.backups))
                    if (this.now() - Date.parse(state.removedAt) > state.retentionDays * 86400000) {
                        this.archiveState(root, id.split('::backup::')[0], state);
                        delete root.backups[id];
                    }
                const age = root.winnerHistorySettings?.retentionMs ?? 30 * 86400000;
                for (const [id, r] of Object.entries(root.winnerHistory))
                    if (Date.parse(r.winner.approvedAt || r.winner.wonAt || r.storedAt) < this.now() - age)
                        delete root.winnerHistory[id];
            },
            ['history', 'backups'],
        );
    }
    async getGiveaway(id: string) {
        return clone((await this.read()).giveaways[id]);
    }
    async getActiveGiveaways() {
        return Object.entries((await this.read()).giveaways)
            .filter(([, s]) => !s.ended)
            .map(([id]) => id);
    }
    async getEndedGiveaways() {
        return Object.entries((await this.read()).giveaways)
            .filter(([, s]) => s.ended)
            .map(([id]) => id);
    }
    async getAllGiveawaysWithStatus() {
        return Object.entries((await this.read()).giveaways).map(([giveawayId, s]) => ({
            giveawayId,
            displayTitle: s.giveawayData.title,
            status: s.ended ? ('stopped' as const) : ('active' as const),
        }));
    }
    async getBackupGiveaways() {
        return clone(Object.entries((await this.read()).backups).map(([id, s]) => ({ ...s, id })));
    }
    async getWinnerHistory() {
        return clone(Object.entries((await this.read()).winnerHistory).map(([id, r]) => ({ ...r, id })));
    }
    async getEntryCount(id: string, name?: string) {
        const state = await this.getGiveaway(id);
        return state?.entries.filter((e) => !name || key(e.username) === key(name)).length || 0;
    }
    async checkGiveawayExists(id: string) {
        return !!(await this.getGiveaway(id));
    }
    async eligibility(id: string, name?: string) {
        const root = await this.read(),
            state = this.require(root, id),
            pool = eligible(root, id, state, this.now()),
            user = name ? key(name) : undefined,
            entries = user ? pool.filter((e) => key(e.username) === user) : pool;
        const max = pool.reduce((m, e) => Math.max(m, e.oddsMultiplier), 0),
            total = max ? pool.reduce((s, e) => s + e.oddsMultiplier / max, 0) : 0,
            weight = max ? entries.reduce((s, e) => s + e.oddsMultiplier / max, 0) : 0;
        return {
            rawEntries: state.entries.length,
            eligibleEntries: entries.length,
            eligibleUsers: new Set(pool.map((e) => key(e.username))).size,
            eligibleWeight: weight * max,
            oddsPercentage: total ? Number(((100 * weight) / total).toFixed(2)) : 0,
            approvedWins: name ? winCount(Object.values(root.approvals), id, state, name, this.now()) : 0,
            admissions: name
                ? state.admissions?.[key(name)] || 0
                : Object.values(state.admissions || {}).reduce((s, n) => s + n, 0),
            winLimit: policy(state.winLimit),
            held: !!name && (state.pendingWinners || []).some((w) => key(w.username) === key(name)),
        };
    }
    async snapshot() {
        const root = await this.read();
        return {
            giveaways: clone(root.giveaways),
            backups: clone(root.backups),
            history: clone(root.winnerHistory),
            historyRetentionDays: (root.winnerHistorySettings?.retentionMs ?? 30 * 86400000) / 86400000,
        };
    }
    private configRevision(state: GiveawayState) {
        return digest(JSON.stringify(configurationOf(state)));
    }
    async dashboard() {
        const root = await this.read();
        return {
            generation: this.generation,
            revision: this.revision,
            selectedId: (await this.resources?.preference()) || '',
            historyRetentionDays: (root.winnerHistorySettings?.retentionMs ?? 30 * 86400000) / 86400000,
            giveaways: Object.entries(root.giveaways).map(([id, s]) => ({
                id,
                title: s.giveawayData.title,
                prize: s.giveawayData.prize,
                category: s.giveawayData.category,
                status: s.ended ? 'stopped' : s.paused ? 'paused' : s.entriesClosed ? 'closed' : 'active',
                ended: s.ended,
                paused: s.paused,
                entriesClosed: s.entriesClosed,
                entryCount: s.entries.length,
                pendingCount: s.pendingWinners?.length || 0,
                winnerCount: s.winners.length,
            })),
        };
    }
    async rememberSelection(id: string) {
        if (typeof id !== 'string') throw new Error('Invalid selection');
        await this.resources?.preference(id);
        return true;
    }
    async configuration(id: string) {
        const state = this.require(await this.read(), resolveId(id));
        return { configuration: configurationOf(state), configRevision: this.configRevision(state) };
    }
    async rows(query: RowQuery) {
        const root = await this.read();
        let rows: any[] = [];
        const area = choice(
            query.area,
            ['entries', 'pending', 'winners', 'history', 'backups', 'templates'] as const,
            'data area',
        );
        if (['entries', 'pending', 'winners'].includes(area)) {
            const state = this.require(root, resolveId(query.id));
            rows = area === 'entries' ? state.entries : area === 'pending' ? state.pendingWinners || [] : state.winners;
            rows = [...rows].sort(
                (a, b) =>
                    (area === 'entries' || area === 'pending' ? 1 : -1) *
                    String(area === 'entries' ? a.enteredAt : a.wonAt).localeCompare(
                        String(area === 'entries' ? b.enteredAt : b.wonAt),
                    ) || String(a.entryId || a.winId).localeCompare(String(b.entryId || b.winId)),
            );
        } else if (area === 'history')
            rows = Object.entries(root.winnerHistory)
                .map(([id, r]) => ({ ...r, id }))
                .sort(
                    (a, b) =>
                        String(b.winner.approvedAt || b.winner.wonAt).localeCompare(
                            String(a.winner.approvedAt || a.winner.wonAt),
                        ) || a.id.localeCompare(b.id),
                );
        else if (area === 'backups')
            rows = Object.entries(root.backups)
                .map(([id, b]) => ({ id, title: b.giveawayData.title, removedAt: b.removedAt }))
                .sort((a, b) => b.removedAt.localeCompare(a.removedAt) || a.id.localeCompare(b.id));
        else
            rows = Object.values(root.templateLibrary || {})
                .map(templateSummary)
                .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        if (query.search) {
            const search = String(query.search).trim().toLowerCase();
            rows = rows.filter((r) =>
                [r.username, r.name, r.description, r.title, r.giveawayTitle, r.category, r.winner?.username, r.status]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(search),
            );
        }
        const pageSize = Math.min(100, positive(query.pageSize ?? 50, 'Page size', true)),
            total = rows.length,
            pages = Math.max(1, Math.ceil(total / pageSize)),
            page = Math.min(pages, positive(query.page ?? 1, 'Page', true));
        return {
            generation: this.generation,
            revision: this.revision,
            rows: clone(rows.slice((page - 1) * pageSize, page * pageSize)),
            total,
            page,
            pages,
            pageSize,
        };
    }
    async template(id: string) {
        const record = templateRecord((await this.read()).templateLibrary, id);
        if (!record) throw new Error('Template not found');
        return clone(record);
    }
    async saveTemplate(input: { id?: string; name: string; description?: string; configuration: EffectModel }) {
        return this.transaction(
            async (root) => {
                const library = (root.templateLibrary ||= {}),
                    old = input.id ? templateRecord(library, input.id) : undefined;
                if (input.id && !old) throw new Error('Template no longer exists');
                const name = templateName(input.name);
                if (Object.values(library).some((t) => t.id !== input.id && key(t.name) === key(name)))
                    throw new Error('A template with this name exists, edit it explicitly or choose another name');
                const configuration = templateConfiguration(input.configuration),
                    styles = configuration.styles;
                if (styles.imageMode === 'local' && styles.imageFile) {
                    if (!this.resources) throw new Error('Image storage is unavailable');
                    styles.imageFile = await this.resources.capture(styles.imageFile);
                } else styles.imageFile = '';
                const id = old?.id || randomUUID(),
                    record: GiveawayTemplate = {
                        id,
                        name,
                        description: String(input.description || '').slice(0, 2000),
                        configuration,
                        createdAt: old?.createdAt || this.iso(),
                        updatedAt: this.iso(),
                    };
                library[id] = record;
                return clone(record);
            },
            ['templates'],
        );
    }
    async renameTemplate(id: string, name: string) {
        return this.transaction(
            (root) => {
                const t = templateRecord(root.templateLibrary, id);
                if (!t) throw new Error('Template not found');
                name = templateName(name);
                if (Object.values(root.templateLibrary!).some((r) => r.id !== id && key(r.name) === key(name)))
                    throw new Error('Template name already exists');
                t.name = name;
                t.updatedAt = this.iso();
                return templateSummary(t);
            },
            ['templates'],
        );
    }
    async deleteTemplate(id: string) {
        return this.transaction(
            (root) => {
                if (!templateRecord(root.templateLibrary, id)) throw new Error('Template not found');
                delete root.templateLibrary![id];
                return true;
            },
            ['templates'],
        );
    }
    async exportTemplates(ids?: string[]) {
        const root = await this.read(),
            library = root.templateLibrary || {},
            records = ids
                ? ids.map((id) => {
                    const record = templateRecord(library, id);
                    if (!record) throw new Error('Template not found');
                    return record;
                })
                : Object.values(library);
        if (!records.length) throw new Error('Select at least one template');
        if (records.length > 500) throw new Error('Export at most 500 templates per file, use Export Selected');
        const bundle: TemplateBundle = { format: 'msgg:giveaway-templates', version: 1, templates: [], assets: {} };
        for (const t of records) {
            const configuration = clone(t.configuration);
            let image: string | undefined;
            if (configuration.styles.imageMode === 'local' && configuration.styles.imageFile) {
                if (!this.resources) throw new Error('Image storage is unavailable');
                const exported = await this.resources.export(configuration.styles.imageFile);
                image = exported.hash;
                bundle.assets[image] = exported.asset;
            }
            configuration.styles.imageFile = '';
            delete configuration.styles.imageToken;
            configuration.overlayInstance = '';
            bundle.templates.push({
                name: t.name,
                description: t.description,
                configuration,
                ...(image ? { image } : {}),
            });
        }
        const text = JSON.stringify(bundle, null, 2);
        if (Buffer.byteLength(text) > bundleLimit) throw new Error('Export exceeds 50 MB, select fewer templates');
        return {
            text,
            filename:
                records.length === 1
                    ? records[0].name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.giveaway-template.json'
                    : 'giveaway-templates.json',
        };
    }
    async previewImport(text: string) {
        const bundle = readBundle(text),
            library = (await this.read()).templateLibrary || {};
        return bundle.templates.map((t, index) => ({
            index,
            name: t.name,
            description: t.description,
            hasImage: !!t.image,
            conflicts: Object.values(library)
                .filter((r) => key(r.name) === key(t.name))
                .map(templateSummary),
        }));
    }
    async importTemplates(
        text: string,
        choices: { index: number; action: 'copy' | 'replace' | 'skip'; targetId?: string }[],
    ) {
        const bundle = readBundle(text);
        if (
            !Array.isArray(choices) ||
            choices.length !== bundle.templates.length ||
            new Set(choices.map((c) => c.index)).size !== choices.length
        )
            throw new Error('Choose an action for every imported template');
        return this.transaction(
            async (root) => {
                const library = (root.templateLibrary ||= {}),
                    added: string[] = [],
                    replaced = new Set<string>();
                for (const selection of choices) {
                    const t = bundle.templates[selection.index];
                    if (!t) throw new Error('Invalid import selection');
                    choice(selection.action, ['copy', 'replace', 'skip'], 'import action');
                    if (selection.action === 'skip') continue;
                    const old =
                        selection.action === 'replace' ? templateRecord(library, selection.targetId || '') : undefined;
                    if (selection.action === 'replace' && (!old || replaced.has(old.id)))
                        throw new Error('Replacement target is missing or selected twice');
                    let name = t.name;
                    if (old) {
                        if (Object.values(library).some((r) => r.id !== old.id && key(r.name) === key(name)))
                            throw new Error('Replacement name conflicts with another template');
                        replaced.add(old.id);
                    } else {
                        let suffix = 2;
                        while (Object.values(library).some((r) => key(r.name) === key(name)))
                            name = t.name + ' (' + suffix++ + ')';
                    }
                    const configuration = clone(t.configuration);
                    if (t.image) {
                        if (!this.resources) throw new Error('Image storage is unavailable');
                        configuration.styles.imageFile = await this.resources.store(
                            Buffer.from(bundle.assets[t.image].data, 'base64'),
                        );
                    }
                    const id = old?.id || randomUUID();
                    library[id] = {
                        id,
                        name,
                        description: t.description,
                        configuration,
                        createdAt: old?.createdAt || this.iso(),
                        updatedAt: this.iso(),
                    };
                    added.push(id);
                }
                return { ids: added, count: added.length };
            },
            ['templates'],
        );
    }
    async dispose() {
        this.abortEntryAttempts();
        this.disposed = true;
        await this.tail;
    }
}

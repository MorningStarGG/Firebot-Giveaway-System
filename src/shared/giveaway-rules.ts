import { randomBytes, randomUUID } from 'node:crypto';
import type {
    GiveawayState,
    GiveawayEntry,
    GiveawayWinner,
    WinLimit,
    ApprovalRecord,
    EffectModel,
} from '../types/types';
import { defaultState } from './defaults';
export const clone = <T>(value: T): T => structuredClone(value);
export const key = (value: string) => value.trim().toLowerCase();
export function resolveId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Giveaway title or ID is required');
    const title = value.trim();
    const id = title.startsWith('giveaway_') ? title : `giveaway_${title.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (!/^giveaway_[a-zA-Z0-9_]+$/.test(id)) throw new Error('Invalid giveaway ID');
    return id;
}
export function positive(value: unknown, label: string, integer = false, zero = false): number {
    if (value === '' || value == null || typeof value === 'boolean') throw new Error(`${label} must be a number`);
    const n = Number(value);
    if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0) || (integer && !Number.isSafeInteger(n)))
        throw new Error(`${label} must be ${zero ? 'nonnegative' : 'positive'}${integer ? ' and a whole number' : ''}`);
    return n;
}
export function boolean(value: unknown): boolean {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('Expected true or false');
}
export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
    if (!values.includes(value as T)) throw new Error(`Invalid ${label}`);
    return value as T;
}
function requiredText(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value))
        throw new Error(`${label} is required`);
    return value.trim();
}
/** Account identifiers use one spelling, regardless of manual input or Firebot variable casing. */
export function username(value: unknown): string {
    return requiredText(value, 'Username').toLowerCase();
}
export function normalizeUsernameRecord(record: { username: string }): boolean {
    const name = username(record.username);
    if (record.username === name) return false;
    record.username = name;
    return true;
}
export function normalizeWinnerUsername(win: GiveawayWinner): boolean {
    let changed = normalizeUsernameRecord(win);
    if (win.entry) changed = normalizeUsernameRecord(win.entry) || changed;
    return changed;
}
export function normalizeStateUsernames(state: GiveawayState): boolean {
    let changed = false;
    for (const entry of state.entries) changed = normalizeUsernameRecord(entry) || changed;
    for (const win of [...state.winners, ...(state.pendingWinners || [])])
        changed = normalizeWinnerUsername(win) || changed;
    if (state.admissions) {
        const counts = new Map<string, number>();
        let renamed = false;
        for (const [name, count] of Object.entries(state.admissions)) {
            const normalized = username(name),
                total = (counts.get(normalized) || 0) + count;
            if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid admission count');
            counts.set(normalized, total);
            renamed ||= normalized !== name;
        }
        if (renamed) {
            state.admissions = Object.fromEntries(counts);
            changed = true;
        }
    }
    return changed;
}
export function policy(input?: Partial<WinLimit>): WinLimit {
    return {
        maximum:
            input?.maximum == null || (input.maximum as unknown) === ''
                ? null
                : positive(input.maximum, 'Win limit', true),
        scope: choice(input?.scope ?? 'giveaway', ['giveaway', 'category', 'all'], 'win-limit scope'),
        period: choice(input?.period ?? 'untilReset', ['untilReset', 'rolling'], 'win-limit period'),
        days: positive(input?.days ?? 30, 'Rolling days'),
    };
}
export function normalizeModes(state: GiveawayState) {
    const d = state.giveawayData.display as any,
        s = state.giveawayData.styles;
    d.displayMode ??= d.imageOnlyMode ? 'imageOnly' : 'widgetImage';
    d.widgetMode ??= d.tickerOnly ? 'ticker' : d.minimalMode ? 'minimal' : 'full';
    choice(d.displayMode, ['widgetImage', 'widgetOnly', 'imageOnly', 'disabled'], 'display mode');
    choice(d.widgetMode, ['full', 'minimal', 'ticker'], 'widget mode');
    d.imageOnlyMode = d.displayMode === 'imageOnly';
    d.tickerOnly = d.widgetMode === 'ticker';
    d.minimalMode = d.widgetMode !== 'full';
    d.disabled = d.displayMode === 'disabled';
    d.slideMode ??= 'disabled';
    choice(d.slideMode, ['disabled', 'widget', 'image', 'cycle'], 'slide mode');
    if (d.displayMode !== 'widgetImage' || ['none', 'background'].includes(s.imagePlacement || ''))
        d.slideMode = 'disabled';
    if (d.oddsMode) {
        choice(d.oddsMode, ['both', 'ratio', 'percent', 'disabled'], 'odds mode');
        d.showOdds = d.oddsMode !== 'disabled';
        d.showOddsPercentage = ['both', 'percent'].includes(d.oddsMode);
        d.showOddsRatio = ['both', 'ratio'].includes(d.oddsMode);
    }
}
export function validateState(state: GiveawayState) {
    requiredText(state.giveawayData.title, 'Giveaway title');
    for (const k of [
        'allowMultipleEntries',
        'requeueDenied',
        'requeueExpired',
        'autoRerollOnExpire',
        'ended',
        'paused',
        'entriesClosed',
    ] as const)
        state[k] = boolean(state[k]);
    state.maxEntriesPerUser = positive(state.maxEntriesPerUser, 'Entries per person per run', true);
    state.claimDuration = positive(state.claimDuration, 'Claim duration', false, state.claimMode !== 'timer');
    state.displayDuration = positive(state.displayDuration, 'Display duration', false, true);
    state.retentionDays = positive(state.retentionDays, 'Retention days', false, true);
    state.autoClose = boolean(state.autoClose ?? false);
    state.autoRemoveAfterClose = boolean(state.autoRemoveAfterClose ?? true);
    state.duration = positive(state.duration ?? 0, 'Auto-close duration', false, !state.autoClose);
    state.claimMode = choice(state.claimMode, ['enabled', 'timer', 'disabled'] as const, 'claim mode');
    state.enableClaimTimer = state.claimMode === 'timer';
    state.requireClaim = state.claimMode !== 'disabled';
    state.winLimit = policy(state.winLimit);
    state.rerollMode = choice(state.rerollMode ?? 'different', ['different', 'allowPrevious'] as const, 'reroll mode');
    state.giveawayData.category ??= '';
    state.overlayInstance ??= '';
    choice(
        state.position,
        [
            'Top Left',
            'Top Middle',
            'Top Right',
            'Middle Left',
            'Middle',
            'Middle Right',
            'Bottom Left',
            'Bottom Middle',
            'Bottom Right',
            'Custom',
            'Random',
        ],
        'position',
    );
    if (state.position === 'Random')
        state.position = [
            'Top Left',
            'Top Middle',
            'Top Right',
            'Middle Left',
            'Middle',
            'Middle Right',
            'Bottom Left',
            'Bottom Middle',
            'Bottom Right',
        ][Math.floor(randomUnit() * 9)];
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const value = state.customCoords?.[side];
        if (value != null && (value as unknown) !== '' && !Number.isFinite(Number(value)))
            throw new Error('Coordinates must be finite numbers');
        state.customCoords[side] = value == null || (value as unknown) === '' ? null : Number(value);
    }
    const s = state.giveawayData.styles as any,
        d = state.giveawayData.display as any;
    for (const [k, v] of Object.entries(d)) {
        if (typeof (defaultState.giveawayData.display as any)[k] === 'boolean') d[k] = boolean(v);
        if (k.endsWith('Seconds') || k === 'imageTextSize') d[k] = positive(v, k, false, k.endsWith('UrgentSeconds'));
    }
    for (const k of ['showImage', 'imageOverlay']) if (s[k] !== undefined) s[k] = boolean(s[k]);
    for (const k of ['giveawayScale', 'imageScale']) s[k] = positive(s[k] ?? 1, k);
    for (const k of ['giveawayWidth', 'fontSize'])
        if (typeof s[k] !== 'string' || !/^\d+(\.\d+)?px$/.test(s[k]) || parseFloat(s[k]) <= 0)
            throw new Error(`${k} must be positive pixels`);
    choice(s.imageMode ?? 'url', ['url', 'local'], 'image mode');
    choice(s.imagePlacement ?? 'above', ['above', 'below', 'left', 'right', 'background', 'none'], 'image placement');
    normalizeModes(state);
    for (const entry of state.entries) {
        username(entry.username);
        positive(entry.oddsMultiplier, 'Entry weight');
    }
    if (!Number.isFinite(state.entries.reduce((sum, e) => sum + e.oddsMultiplier, 0)))
        throw new Error('Combined entry weight is too large');
    state.totalEntries = state.entries.length;
}
export function hydrate(state: GiveawayState): GiveawayState {
    state.runId ||= randomUUID();
    state.admissions ||= {};
    state.entries ||= [];
    state.winners ||= [];
    state.pendingWinners ||= [];
    normalizeStateUsernames(state);
    state.entriesClosed ??= false;
    state.autoRemoveAfterClose ??= true;
    state.paused ??= false;
    state.claimMode ??=
        state.requireClaim === false ? 'disabled' : state.enableClaimTimer === false ? 'enabled' : 'timer';
    state.winLimit = policy(state.winLimit);
    state.rerollMode ??= 'different';
    state.giveawayData.styles = { ...clone(defaultState.giveawayData.styles), ...state.giveawayData.styles };
    state.giveawayData.display = { ...clone(defaultState.giveawayData.display), ...state.giveawayData.display };
    const counts: Record<string, number> = {};
    const known = new Set<string>();
    for (const entry of state.entries) {
        entry.entryId ||= randomUUID();
        if (!known.has(entry.entryId)) {
            counts[key(entry.username)] = (counts[key(entry.username)] || 0) + 1;
            known.add(entry.entryId);
        }
    }
    for (const win of [...state.winners, ...state.pendingWinners]) {
        win.winId ||= randomUUID();
        win.runId ||= state.runId;
        win.entry ||= {
            entryId: randomUUID(),
            username: win.username,
            oddsMultiplier: win.oddsMultiplier,
            enteredAt: win.wonAt,
        };
        win.entry.entryId ||= randomUUID();
        if (win.runId === state.runId && !known.has(win.entry.entryId)) {
            counts[key(win.username)] = (counts[key(win.username)] || 0) + 1;
            known.add(win.entry.entryId);
        }
    }
    for (const [name, count] of Object.entries(counts))
        state.admissions[name] = Math.max(state.admissions[name] || 0, count);
    state.totalEntries = state.entries.length;
    return state;
}
export function fromEffect(effect: EffectModel, existing?: GiveawayState): GiveawayState {
    const state = existing
        ? clone(existing)
        : { ...clone(defaultState), uuid: randomUUID(), createdAt: new Date().toISOString() };
    const options = effect.giveawayOptions || {};
    for (const name of [
        'autoClose',
        'duration',
        'displayDuration',
        'autoRemoveAfterClose',
        'claimMode',
        'claimDuration',
        'requireClaim',
        'enableClaimTimer',
        'autoRerollOnExpire',
        'retentionDays',
        'requeueExpired',
        'requeueDenied',
        'allowMultipleEntries',
        'maxEntriesPerUser',
        'winLimit',
        'rerollMode',
    ] as const)
        if (options[name] !== undefined) (state as any)[name] = clone(options[name]);
    state.giveawayData = {
        ...state.giveawayData,
        title: requiredText(effect.giveawayTitle, 'Giveaway title'),
        prize: effect.prize ?? '',
        category: effect.category ?? '',
        entryCommand: options.entryCommand ?? state.giveawayData.entryCommand,
        claimCommand: options.claimCommand ?? state.giveawayData.claimCommand,
        styles: { ...state.giveawayData.styles, ...effect.styles },
        display: { ...state.giveawayData.display, ...effect.display },
    };
    for (const k of ['prizeLabelText', 'statLabelText', 'entriesClosedText'] as const)
        state.giveawayData[k] = state.giveawayData.display[k];
    state.position = effect.position ?? state.position;
    state.customCoords = effect.customCoords ?? state.customCoords;
    state.overlayInstance = effect.overlayInstance ?? '';
    if (
        options.claimMode === undefined &&
        (options.requireClaim !== undefined || options.enableClaimTimer !== undefined)
    )
        state.claimMode =
            options.requireClaim !== undefined && !boolean(options.requireClaim)
                ? 'disabled'
                : options.enableClaimTimer !== undefined && !boolean(options.enableClaimTimer)
                    ? 'enabled'
                    : 'timer';
    hydrate(state);
    validateState(state);
    return state;
}
export function winCount(
    records: ApprovalRecord[],
    id: string,
    state: GiveawayState,
    name: string,
    now: number,
): number {
    return approvalCounts(records, id, state, now).get(key(name)) || 0;
}
export function inWinScope(
    scope: WinLimit['scope'],
    id: string,
    state: GiveawayState,
    record: { giveawayId: string; runId?: string; category?: string },
) {
    return (
        scope === 'all' ||
        (scope === 'category'
            ? key(record.category || 'uncategorized') === key(state.giveawayData.category || 'uncategorized')
            : record.giveawayId === id && record.runId === state.runId)
    );
}
function approvalCounts(records: ApprovalRecord[], id: string, state: GiveawayState, now: number): Map<string, number> {
    const p = policy(state.winLimit),
        cutoff = p.period === 'rolling' ? now - p.days * 86400000 : -Infinity;
    const counts = new Map<string, number>();
    for (const r of records) {
        const inScope = inWinScope(p.scope, id, state, r);
        if (
            !r.revokedAt &&
            inScope &&
            r.sequence > (state.winLimitResetSequence || 0) &&
            Date.parse(r.approvedAt) >= cutoff
        ) {
            const name = key(r.username);
            counts.set(name, (counts.get(name) || 0) + 1);
        }
    }
    return counts;
}
export function eligible(
    root: {
        giveaways: Record<string, GiveawayState>;
        approvals: Record<string, ApprovalRecord>;
    },
    id: string,
    state: GiveawayState,
    now: number,
    exclude?: string,
    ignoreWin?: string,
): GiveawayEntry[] {
    const held = new Set((state.pendingWinners || []).filter((w) => w.winId !== ignoreWin).map((w) => key(w.username))),
        p = policy(state.winLimit);
    const reservations =
        p.maximum == null
            ? []
            : Object.entries(root.giveaways).flatMap(([otherId, s]) =>
                (s.pendingWinners || [])
                    .filter((w) => w.winId !== ignoreWin)
                    .map((w) => ({
                        winId: w.winId!,
                        giveawayId: otherId,
                        runId: w.runId || s.runId!,
                        username: w.username,
                        category: s.giveawayData.category || '',
                        approvedAt: new Date(now).toISOString(),
                        sequence: Infinity,
                    })),
            );
    // Count the shared ledger once per draw, rather than scanning it for every ticket.
    const counts =
        p.maximum == null
            ? new Map<string, number>()
            : approvalCounts([...Object.values(root.approvals), ...reservations], id, state, now);
    return state.entries.filter((e) => {
        if (
            !Number.isFinite(e.oddsMultiplier) ||
            e.oddsMultiplier <= 0 ||
            held.has(key(e.username)) ||
            (exclude && key(e.username) === key(exclude))
        )
            return false;
        if (p.maximum == null) return true;
        return (counts.get(key(e.username)) || 0) < p.maximum;
    });
}
export function weightedPick(entries: GiveawayEntry[], random: () => number = randomUnit): GiveawayEntry | undefined {
    if (!entries.length) return;
    const max = entries.reduce((m, e) => Math.max(m, positive(e.oddsMultiplier, 'Entry weight')), 0);
    const total = entries.reduce((sum, e) => sum + e.oddsMultiplier / max, 0);
    const u = random();
    if (!Number.isFinite(u) || u < 0 || u >= 1) throw new Error('Invalid random draw');
    let point = u * total;
    for (const entry of entries) {
        point -= entry.oddsMultiplier / max;
        if (point < 0) return entry;
    }
    return entries[entries.length - 1]; // rounding only, every element here has passed eligibility
}
export function randomUnit(): number {
    return randomBytes(6).readUIntBE(0, 6) / 281474976710656;
}
export function odds(entries: GiveawayEntry[], selected: GiveawayEntry) {
    const max = entries.reduce((m, e) => Math.max(m, e.oddsMultiplier), 0),
        total = entries.reduce((s, e) => s + e.oddsMultiplier / max, 0);
    const weight = entries
        .filter((e) => key(e.username) === key(selected.username))
        .reduce((s, e) => s + e.oddsMultiplier / max, 0);
    return {
        oddsPercentage: ((weight / total) * 100).toFixed(2),
        oddsString: `${Number((weight * max).toPrecision(8))}/${Number((total * max).toPrecision(8))}`,
        selectedEntryWeight: selected.oddsMultiplier,
        eligibleEntries: entries.length,
        eligibleWeight: total * max,
    };
}

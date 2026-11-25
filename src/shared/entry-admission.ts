import type { DatabaseRoot } from '../utility/database';
import type { GiveawayState } from '../types/types';
import { inWinScope, key, policy, winCount } from './giveaway-rules';

export const entryReasons = {
    accepted: 'Entry accepted.',
    cancelled: 'This entry attempt was cancelled.',
    stopped: 'This giveaway has stopped.',
    paused: 'This giveaway is paused.',
    closed: 'This giveaway is closed to entries.',
    win_limit: 'You have reached the approved-win limit.',
    entry_limit: 'You have reached the entry limit for this run.',
    giveaway_changed: 'The giveaway was removed, replaced, or reset during this attempt.',
} as const;
export type EntryReason = keyof typeof entryReasons;

/** One admission decision for both event snapshots and the final serialized check. */
export function entryAdmission(root: DatabaseRoot, id: string, state: GiveawayState, username: string, now: number) {
    const limit = policy(state.winLimit);
    const approvedWins = winCount(Object.values(root.approvals), id, state, username, now);
    let pendingWins = 0,
        claimedWins = 0;
    for (const [giveawayId, other] of Object.entries(root.giveaways)) {
        for (const win of other.pendingWinners || []) {
            if (
                key(win.username) !== key(username) ||
                !inWinScope(limit.scope, id, state, {
                    giveawayId,
                    runId: win.runId || other.runId,
                    category: other.giveawayData.category,
                })
            )
                continue;
            if (win.status === 'pending') pendingWins++;
            if (win.status === 'claimed') claimedWins++;
        }
    }
    const admissions = state.admissions?.[key(username)] || 0;
    const entryLimit = state.allowMultipleEntries ? state.maxEntriesPerUser : 1;
    const reason: EntryReason = state.ended
        ? 'stopped'
        : state.paused
            ? 'paused'
            : state.entriesClosed
                ? 'closed'
                : limit.maximum != null && approvedWins >= limit.maximum
                    ? 'win_limit'
                    : admissions >= entryLimit
                        ? 'entry_limit'
                        : 'accepted';
    return {
        approvedWins,
        pendingWins,
        claimedWins,
        admissions,
        entryLimit,
        winLimitMaximum: limit.maximum,
        winLimitScope: limit.scope,
        winLimitPeriod: limit.period,
        winLimitDays: limit.days,
        canEnter: reason === 'accepted',
        reason,
        reasonText: reason === 'accepted' ? 'Entry allowed by current built-in rules.' : entryReasons[reason],
    };
}

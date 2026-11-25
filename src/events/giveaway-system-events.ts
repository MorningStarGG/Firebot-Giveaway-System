import type { EventSource } from '@crowbartools/firebot-types';
export const GIVEAWAY_SYSTEM_SOURCE_ID = 'msgg:giveaway-system';
export const GIVEAWAY_START_EVENT = 'giveawayStart';
export const GIVEAWAY_STOP_EVENT = 'giveawayStop';
export const WINNER_PICKED_EVENT = 'winnerPicked';
export const WINNER_CLAIMED_EVENT = 'winnerClaimed';
export const WINNER_APPROVED_EVENT = 'winnerApproved';
export const WINNER_DENIED_EVENT = 'winnerDenied';
export const WINNER_EXPIRED_EVENT = 'winnerExpired';
export const GIVEAWAY_EMPTY_EVENT = 'giveawayEmpty';
export const ENTRY_ATTEMPTED_EVENT = 'entryAttempted';
export const ENTRY_ACCEPTED_EVENT = 'entryAccepted';
export const ENTRY_REJECTED_EVENT = 'entryRejected';
const entryMetadata = {
    entryAttemptId: 'example-entry-attempt-id',
    username: 'entryusername',
    giveawayId: 'giveaway_example',
    giveawayTitle: 'Example Giveaway',
    category: 'Example Category',
    prize: 'Steam Game Key',
    runId: 'example-run-id',
    totalEntries: 10,
    oddsMultiplier: 1,
    approvedWins: 0,
    pendingWins: 0,
    claimedWins: 0,
    admissions: 0,
    entryLimit: 1,
    winLimitMaximum: 1,
    winLimitScope: 'category',
    winLimitPeriod: 'rolling',
    winLimitDays: 30,
};
export const GiveawaySystemEventSource: EventSource = {
    id: GIVEAWAY_SYSTEM_SOURCE_ID,
    name: 'Giveaway System',
    events: [
        {
            id: ENTRY_ATTEMPTED_EVENT,
            name: 'Giveaway Entry Attempted',
            cached: false,
            description:
                'Triggered before admission completes. You can use Advanced Giveaway Manager can cancel the entry or change its odds, otherwise normal rules apply.',
            manualMetadata: {
                ...entryMetadata,
                canEnter: true,
                reason: 'accepted',
                reasonText: 'Entry allowed by current built-in rules.',
            },
        },
        {
            id: ENTRY_ACCEPTED_EVENT,
            name: 'Giveaway Entry Accepted',
            cached: false,
            description: 'Triggered after an entry is saved.',
            manualMetadata: {
                ...entryMetadata,
                entryAccepted: true,
                canEnter: true,
                reason: 'accepted',
                reasonText: 'Entry accepted.',
                entryId: 'example-entry-id',
            },
        },
        {
            id: ENTRY_REJECTED_EVENT,
            name: 'Giveaway Entry Rejected',
            cached: false,
            description: 'Triggered when an attempt was cancelled or rejected.',
            manualMetadata: {
                ...entryMetadata,
                approvedWins: 1,
                entryAccepted: false,
                canEnter: false,
                reason: 'win_limit',
                reasonText: 'You have reached the approved-win limit.',
            },
        },
        {
            id: GIVEAWAY_START_EVENT,
            name: 'Giveaway Started',
            description: 'Triggered when a new giveaway starts',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                duration: 300,
            },
        },
        {
            id: GIVEAWAY_STOP_EVENT,
            name: 'Giveaway Stopped',
            description: 'Triggered when a giveaway is stopped (manually or automatically)',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                totalEntries: 50,
                stopType: 'manual/automatic',
                runTime: '300',
            },
        },
        {
            id: WINNER_PICKED_EVENT,
            name: 'Giveaway Winner Picked',
            description: 'Triggered when a winner is randomly selected',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                winner: 'winnerusername',
                winId: 'example-win-id',
                entryId: 'example-entry-id',
                runId: 'example-run-id',
                totalEntries: 50,
                oddsPercentage: '2.00',
                oddsString: '1/50',
            },
        },
        {
            id: WINNER_CLAIMED_EVENT,
            name: 'Giveaway Winner Claimed',
            description: 'Triggered when the winner claims their prize',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                winner: 'winnerusername',
            },
        },
        {
            id: WINNER_APPROVED_EVENT,
            name: 'Giveaway Winner Approved',
            description: 'Triggered when the streamer approves the winner',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                winner: 'winnerusername',
                winId: 'example-win-id',
                entryId: 'example-entry-id',
                runId: 'example-run-id',
                approved: true,
            },
        },
        {
            id: WINNER_DENIED_EVENT,
            name: 'Giveaway Winner Denied',
            description: 'Triggered when the streamer denies the winner',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                winner: 'winnerusername',
                winId: 'example-win-id',
                entryId: 'example-entry-id',
                runId: 'example-run-id',
                approved: false,
            },
        },
        {
            id: WINNER_EXPIRED_EVENT,
            name: 'Giveaway Winner Expired',
            description: 'Triggered when the winner fails to claim in time',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                winner: 'winnerusername',
            },
        },
        {
            id: GIVEAWAY_EMPTY_EVENT,
            name: 'Giveaway Empty',
            description: 'Triggered when no entries remain after resolving a winner',
            cached: false,
            manualMetadata: {
                giveawayId: 'giveaway_example',
                giveawayTitle: 'Example Giveaway',
                category: 'Example Category',
                prize: 'Steam Game Key',
                reason: 'approved/denied/expired',
            },
        },
    ],
};

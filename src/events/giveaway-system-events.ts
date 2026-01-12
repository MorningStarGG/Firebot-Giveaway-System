import { EventSource } from "@crowbartools/firebot-custom-scripts-types/types/modules/event-manager";
import type { GiveawayStartMetadata, GiveawayWinnerMetadata, GiveawayClaimMetadata, GiveawayApprovalMetadata, GiveawayEmptyMetadata } from '../types/types';
import { logger } from "../logger";

export const GIVEAWAY_SYSTEM_SOURCE_ID = "msgg:giveaway-system";
export const GIVEAWAY_START_EVENT = "giveawayStart";
export const GIVEAWAY_STOP_EVENT = "giveawayStop";
export const WINNER_PICKED_EVENT = "winnerPicked";
export const WINNER_CLAIMED_EVENT = "winnerClaimed";
export const WINNER_APPROVED_EVENT = "winnerApproved";
export const WINNER_DENIED_EVENT = "winnerDenied";
export const WINNER_EXPIRED_EVENT = "winnerExpired";
export const GIVEAWAY_EMPTY_EVENT = "giveawayEmpty";

export const GiveawaySystemEventSource: EventSource = {
    id: GIVEAWAY_SYSTEM_SOURCE_ID,
    name: "Giveaway System",
    events: [
        {
            id: GIVEAWAY_START_EVENT,
            name: "Giveaway Started",
            description: "Triggered when a new giveaway starts",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                duration: 300
            }
        },
        {
            id: GIVEAWAY_STOP_EVENT,
            name: "Giveaway Stopped",
            description: "Triggered when a giveaway is stopped (manually or automatically)",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                totalEntries: 50,
                stopType: "manual/automatic",
                runTime: "300"
            }
        },
        {
            id: WINNER_PICKED_EVENT,
            name: "Giveaway Winner Picked",
            description: "Triggered when a winner is randomly selected",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                winner: "WinnerUsername",
                totalEntries: 50,
                oddsPercentage: "2.00",
                oddsString: "1/50"
            }
        },
        {
            id: WINNER_CLAIMED_EVENT,
            name: "Giveaway Winner Claimed",
            description: "Triggered when the winner claims their prize",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                winner: "WinnerUsername"
            }
        },
        {
            id: WINNER_APPROVED_EVENT,
            name: "Giveaway Winner Approved",
            description: "Triggered when the streamer approves the winner",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                winner: "WinnerUsername",
                approved: true
            }
        },
        {
            id: WINNER_DENIED_EVENT,
            name: "Giveaway Winner Denied",
            description: "Triggered when the streamer denies the winner",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                winner: "WinnerUsername",
                approved: false
            }
        },
        {
            id: WINNER_EXPIRED_EVENT,
            name: "Giveaway Winner Expired",
            description: "Triggered when the winner fails to claim in time",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                winner: "WinnerUsername"
            }
        },
        {
            id: GIVEAWAY_EMPTY_EVENT,
            name: "Giveaway Empty",
            description: "Triggered when no entries remain after resolving a winner",
            cached: false,
            manualMetadata: {
                giveawayId: "giveaway_example",
                giveawayTitle: "Example Giveaway",
                category: "Example Category",
                prize: "Steam Game Key",
                reason: "approved/denied/expired"
            }
        }
    ]
};

// Helper function to emit giveaway start event
export const emitGiveawayStart = async (
    eventManager: any,
    giveawayData: GiveawayStartMetadata
) => {
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        GIVEAWAY_START_EVENT,
        giveawayData
    );
};

// Helper function to emit giveaway stop event
export const emitGiveawayStop = async (
    eventManager: any,
    giveawayData: {
        giveawayId: string;
        giveawayTitle: string;
        category: string;
        prize: string;
        totalEntries: number;
        stopType: 'manual' | 'automatic';
        startTime?: string;
    }
) => {
    try {
        logger.info('Starting giveaway stop event emission for:', giveawayData.giveawayId);

        const runTime = giveawayData.startTime ?
            Math.floor((Date.now() - new Date(giveawayData.startTime).getTime()) / 1000) :
            0;

        const eventData = {
            giveawayId: giveawayData.giveawayId,
            giveawayTitle: giveawayData.giveawayTitle,
            category: giveawayData.category,
            prize: giveawayData.prize,
            totalEntries: giveawayData.totalEntries,
            stopType: giveawayData.stopType,
            runTime: runTime,
            timestamp: Date.now()
        };

        logger.info('Emitting giveaway stop event with data:', eventData);

        await eventManager.triggerEvent(
            GIVEAWAY_SYSTEM_SOURCE_ID,
            GIVEAWAY_STOP_EVENT,
            eventData
        );

        logger.info('Giveaway stop event emission completed successfully');
        return true;
    } catch (error) {
        logger.error('Error emitting giveaway stop event:', error);
        throw error;
    }
};

// Helper function to emit winner picked event
export const emitWinnerPicked = async (
    eventManager: any,
    winnerData: GiveawayWinnerMetadata
) => {
    logger.info('Emitting winner picked event:', winnerData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        WINNER_PICKED_EVENT,
        winnerData
    );
    logger.info('Winner picked event emission completed');
};

// Helper function to emit winner claimed event
export const emitWinnerClaimed = async (
    eventManager: any,
    claimData: GiveawayClaimMetadata
) => {
    logger.info('Emitting winner claimed event:', claimData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        WINNER_CLAIMED_EVENT,
        claimData
    );
    logger.info('Winner claimed event emission completed');
};

// Helper function to emit winner approved event
export const emitWinnerApproved = async (
    eventManager: any,
    approvalData: GiveawayApprovalMetadata
) => {
    logger.info('Emitting winner approved event:', approvalData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        WINNER_APPROVED_EVENT,
        approvalData
    );
    logger.info('Winner approved event emission completed');
};

// Helper function to emit winner denied event
export const emitWinnerDenied = async (
    eventManager: any,
    denialData: GiveawayApprovalMetadata
) => {
    logger.info('Emitting winner denied event:', denialData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        WINNER_DENIED_EVENT,
        denialData
    );
    logger.info('Winner denied event emission completed');
};

// Helper function to emit winner expired event
export const emitWinnerExpired = async (
    eventManager: any,
    expiredData: GiveawayClaimMetadata
) => {
    logger.info('Emitting winner expired event:', expiredData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        WINNER_EXPIRED_EVENT,
        expiredData
    );
    logger.info('Winner expired event emission completed');
};

// Helper function to emit giveaway empty event
export const emitGiveawayEmpty = async (
    eventManager: any,
    emptyData: GiveawayEmptyMetadata
) => {
    logger.info('Emitting giveaway empty event:', emptyData);
    await eventManager.triggerEvent(
        GIVEAWAY_SYSTEM_SOURCE_ID,
        GIVEAWAY_EMPTY_EVENT,
        emptyData
    );
    logger.info('Giveaway empty event emission completed');
};

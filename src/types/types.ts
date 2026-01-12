// ============================================================================
// Basic Type Definitions
// ============================================================================

/**
 * Different modes of giveaway selection
 */
export type GiveawaySelectionMode = 'giveawayList' | 'manual';

/**
 * Actions that can be performed on a giveaway
 */
export type GiveawayAction = 'add' | 'remove' | 'clear';
export type BackupAction = 'restore' | 'remove';
export type StatusControlAction = 'stop' | 'restart' | 'reset' | 'remove' | 'pause' | 'resume' | 'closeEntries' | 'openEntries';
export type VisibilityAction = 'show' | 'hide';
export type EntryManagementAction = 'add' | 'remove' | 'pick' | 'approve' | 'claim' | 'deny' | 'reroll';
export type WinnerHistoryAction = 'setRetention' | 'purgeOlderThan' | 'purgeUser' | 'purgeUserOlderThan' | 'purgeAll';
export type WinnerHistoryUnit = 'minutes' | 'hours' | 'days' | 'years';

/**
 * Winner status states
 */
export type WinnerStatus = 'pending' | 'claimed' | 'approved' | 'denied' | 'expired';

/**
 * Claim mode configuration
 */
export type ClaimMode = 'enabled' | 'timer' | 'disabled';

/**
 * Image text position options
 */
export type ImageTextPosition = 'top' | 'bottom' | 'top-left' | 'bottom-left' | 'top-right' | 'bottom-right' | 'center' | 'center-left' | 'center-right';

// ============================================================================
// Base Interfaces
// ============================================================================

/**
 * Custom coordinates for giveaway positioning
 */
export interface CustomCoords {
    top: number | null;
    bottom: number | null;
    left: number | null;
    right: number | null;
}

/**
 * Represents an entry in the giveaway
 */
export interface GiveawayEntry {
    username: string;
    oddsMultiplier: number;
    enteredAt: string;
    userId?: string;
}

/**
 * Represents a winner in the giveaway
 */
export interface GiveawayWinner {
    winId?: string;
    username: string;
    oddsMultiplier: number;
    oddsPercentage?: string;
    oddsString?: string;
    wonAt: string;
    status: WinnerStatus;
    claimedAt?: string;
    approvedAt?: string;
    deniedAt?: string;
    expiredAt?: string;
    claimDeadline?: string;
}

// ============================================================================
// Display & Style Configuration
// ============================================================================

/**
 * Shared display mode types (used by multiple effects and overlay)
 */
export type SlideMode = 'image' | 'widget' | 'cycle' | 'disabled';
export type DisplayMode = 'widgetImage' | 'widgetOnly' | 'imageOnly' | 'disabled';
export type WidgetMode = 'full' | 'minimal' | 'ticker';

/**
 * Controls the visual display settings of a giveaway
 */
export interface GiveawayDisplay {
    showTitle?: boolean;
    showPrize?: boolean;
    showPrizeLabel?: boolean;
    prizeVisibility?: 'label-prize' | 'label-only' | 'prize-only' | 'disabled';
    showEntryCount: boolean;
    showEntryCommand: boolean;
    showWinner: boolean;
    showOdds?: boolean;
    showOddsPercentage?: boolean;
    showOddsRatio?: boolean;
    oddsMode?: 'both' | 'ratio' | 'percent' | 'disabled';
    showClaimCommand: boolean;
    showTimer: boolean;
    showCloseTimer: boolean;
    animateWinner: boolean;
    rotateWinners: boolean;
    pendingWinnerRotationSeconds?: number;
    minimalMode?: boolean;
    tickerIntervalSeconds?: number;
    commandCycleIntervalSeconds?: number;
    imageOnlyMode?: boolean;
    cycleIntervalSeconds?: number;
    displayMode?: DisplayMode;
    widgetMode?: WidgetMode;
    tickerOnly?: boolean;
    slideMode?: SlideMode;
    slideRevealIntervalSeconds?: number;
    slideVisibleSeconds?: number;
    prizeLabelText?: string;
    statLabelText?: string;
    entriesClosedText?: string;
    entryCommandText?: string;
    closeTimerText?: string;
    closeTimerUrgentSeconds?: number;
    claimCommandText?: string;
    claimTimerUrgentSeconds?: number;
    winnerPendingText?: string;
    oddsText?: string;
    showImageText?: boolean;
    imageTextTemplate?: string;
    imageTextPosition?: ImageTextPosition;
    imageTextSize?: number;
}

/**
 * Visual styling configuration for giveaways
 */
export interface GiveawayStyles {
    backgroundColor: string;
    accentColor: string;
    textColor: string;
    titleColor: string;
    fontSize: string;
    winnerColor: string;
    shadowColor: string;
    giveawayWidth?: string;
    giveawayScale: number;
    imageScale?: number;
    customCSS?: string;
    showImage?: boolean;
    imageMode?: 'url' | 'local';
    imageUrl?: string;
    imageFile?: string;
    imageToken?: string;
    imagePlacement?: 'above' | 'below' | 'left' | 'right' | 'background' | 'none';
    imageOverlay?: boolean;
    entriesClosedColor?: string;
    prizeLabelColor?: string;
    statLabelColor?: string;
    prizeColor?: string;
    entryCommandColor?: string;
    closeTimerColor?: string;
    closeTimerTextColor?: string;
    closeTimerValueColor?: string;
    closeTimerUrgentColor?: string;
    claimCommandColor?: string;
    claimTimerTextColor?: string;
    claimTimerValueColor?: string;
    claimTimerUrgentColor?: string;
    winnerPendingColor?: string;
    imageTextColor?: string;
    imageTextPlaceholderColor?: string;
    oddsColor?: string;
    entryNumberColor?: string;
    entryTextColor?: string;
    claimTextColor?: string;
    claimTimerColor?: string;
    statusClosedColor?: string;
    statusPausedColor?: string;
    statusEndedColor?: string;
    statusLabelColor?: string;
}

// ============================================================================
// Giveaway Configuration
// ============================================================================

/**
 * Configuration for giveaway options and behavior
 */
export interface GiveawayOptionsConfig {
    entryCommand: string;
    claimCommand: string;
    claimMode?: ClaimMode;
    requireClaim?: boolean;
    enableClaimTimer?: boolean;
    autoClose: boolean;
    duration: number;
    displayDuration: number;
    autoRemoveAfterClose?: boolean;
    claimDuration: number;
    autoRerollOnExpire: boolean;
    retentionDays: number;
    requeueExpired: boolean;
    requeueDenied: boolean;
    allowMultipleEntries: boolean;
    maxEntriesPerUser: number;
}

/**
 * Core giveaway data structure
 */
export interface GiveawayData {
    title: string;
    prize: string;
    category?: string;
    entryCommand: string;
    claimCommand: string;
    display: GiveawayDisplay;
    styles: GiveawayStyles;
    prizeLabelText?: string;
    statLabelText?: string;
    entriesClosedText?: string;
}

/**
 * Base configuration for creating/updating giveaways
 */
export interface BaseGiveawayConfig {
    giveawayTitle: string;
    prize: string;
    category?: string;
    styles: GiveawayStyles;
    display: GiveawayDisplay;
    position: string;
    customCoords: CustomCoords;
    overlayInstance: string;
}

/**
 * Complete giveaway configuration including options and data
 */
export interface GiveawayConfig extends BaseGiveawayConfig {
    oldGiveawayTitle?: string;
    giveawayOptions: GiveawayOptionsConfig;
    giveawayData?: GiveawayData;
}

// ============================================================================
// State & Events
// ============================================================================

/**
 * Represents the current state of a giveaway
 */
export interface GiveawayState {
    uuid: string;
    giveawayData: GiveawayData;
    entries: GiveawayEntry[];
    totalEntries: number;
    winners: GiveawayWinner[];
    pendingWinners?: GiveawayWinner[];
    ended: boolean;
    paused: boolean;
    entriesClosed: boolean;
    entriesClosedAt?: string;
    createdAt: string;
    updatedAt: string;
    closeTime?: string;
    claimMode?: ClaimMode;
    displayDuration: number;
    autoClose?: boolean;
    duration?: number;
    autoRemoveAfterClose?: boolean;
    enableClaimTimer?: boolean;
    claimDuration: number;
    pausedCloseRemainingSeconds?: number | null;
    pausedClaimRemaining?: Record<string, number>;
    requireClaim?: boolean;
    autoRerollOnExpire: boolean;
    retentionDays: number;
    requeueExpired: boolean;
    requeueDenied: boolean;
    position: string;
    customCoords: CustomCoords;
    overlayInstance: string;
    allowMultipleEntries: boolean;
    maxEntriesPerUser: number;
}

/**
 * Backup giveaway extension
 */
export interface BackupGiveaway extends GiveawayState {
    removedAt: string;
    id?: string;
}

/**
 * Winner history records (stored separately from giveaways/backups so win history can persist after cleanup).
 */
export type WinnerHistorySource = 'approved' | 'giveawayCleanup' | 'backupRemove' | 'backupCleanup' | 'manual';

export interface WinnerHistoryRecord {
    id?: string;
    giveawayId: string;
    giveawayUuid?: string;
    giveawayTitle: string;
    prize: string;
    category: string;
    storedAt: string;
    source: WinnerHistorySource;
    winner: GiveawayWinner;
}

export interface WinnerHistorySettings {
    retentionMs: number;
    updatedAt: string;
}

/**
 * Model for backup manager effect
 */
export interface BackupEffectModel {
    mode?: string;
    giveawaySelectionMode: string;
    manualGiveawayTitle: string;
    action: BackupAction;
}

// ============================================================================
// Event Metadata
// ============================================================================

/**
 * Various metadata interfaces for giveaway events
 */
export interface GiveawayStartMetadata {
    giveawayId: string;
    giveawayTitle: string;
    category: string;
    prize: string;
    duration: number;
}

export interface GiveawayWinnerMetadata {
    giveawayId: string;
    giveawayTitle: string;
    category: string;
    prize: string;
    winner: string;
    totalEntries: number;
    oddsPercentage?: string;
    oddsString?: string;
}

export interface GiveawayClaimMetadata {
    giveawayId: string;
    giveawayTitle: string;
    category: string;
    prize: string;
    winner: string;
}

export interface GiveawayApprovalMetadata {
    giveawayId: string;
    giveawayTitle: string;
    category: string;
    prize: string;
    winner: string;
    approved: boolean;
}

export interface GiveawayEmptyMetadata {
    giveawayId: string;
    giveawayTitle: string;
    category: string;
    prize: string;
    reason: 'approved' | 'denied' | 'expired' | 'reroll';
}

// ============================================================================
// Effect Models
// ============================================================================

/**
 * Base model for giveaway effects
 */
export interface BaseEffectModel extends BaseGiveawayConfig {
    giveawaySelectionMode: GiveawaySelectionMode;
    manualGiveawayTitle?: string;
}

/**
 * Model for giveaway update effects
 */
export interface GiveawayUpdateModel extends BaseEffectModel {
    action: GiveawayAction;
    entryAction?: EntryManagementAction;
    mode: string;
    username?: string;
    winnerHistoryAction?: WinnerHistoryAction;
    winnerHistoryUsername?: string;
    winnerHistoryValue?: number;
    winnerHistoryUnit?: WinnerHistoryUnit;
    winnerCount?: number;
    autoApproveMulti?: boolean;
    oddsMultiplier?: number;
    removeAllEntries?: boolean;
    closeTimeSeconds?: number;
    clearCloseTime?: boolean;
    giveawayOptions: Partial<GiveawayOptionsConfig> & { category?: string };
    statusAction?: StatusControlAction;
    visibilityAction?: VisibilityAction;
    setting?: SettingUpdate;
}

/**
 * Setting update types
 */
export type SettingUpdate = BooleanSetting | CommandSetting | StyleSetting | NumberSetting | SlideModeSetting | DisplayModeSetting;

export interface BooleanSetting {
    type: 'allowMultipleEntries' | 'showEntryCount' | 'showEntryCommand' |
          'showWinner' | 'showOdds' | 'showOddsPercentage' | 'showOddsRatio' | 'showClaimCommand' | 'showTimer' | 'showCloseTimer' | 'animateWinner' | 'rotateWinners' | 'minimalMode' | 'imageOnlyMode' | 'requireClaim' | 'autoRerollOnExpire' |
          'requeueExpired' | 'requeueDenied' | 'autoRemoveAfterClose' | 'enableClaimTimer' | 'clearCloseTime' | 'autoClose' | 'showImageText';
    value: boolean;
}

export interface SlideModeSetting {
    type: 'slideMode';
    value: SlideMode;
}

export interface DisplayModeSetting {
    type: 'displayMode' | 'widgetMode' | 'oddsMode' | 'claimMode' | 'imageTextPosition';
    value: string | ClaimMode | ImageTextPosition;
}

export interface StyleSetting {
    type: 'backgroundColor' | 'accentColor' | 'textColor' | 'titleColor' |
          'winnerColor' | 'shadowColor' | 'giveawayScale' |
          'showImage' | 'imageMode' | 'imageUrl' | 'imageFile' | 'imagePlacement' | 'imageOverlay' | 'imageScale' |
          'prizeLabelColor' | 'prizeColor' | 'statLabelColor' | 'entryCommandColor' | 'closeTimerColor' | 'closeTimerTextColor' | 'closeTimerValueColor' | 'closeTimerUrgentColor' | 'claimCommandColor' | 'claimTimerColor' | 'claimTimerTextColor' | 'claimTimerValueColor' | 'claimTimerUrgentColor' | 'winnerPendingColor' | 'oddsColor' | 'imageTextColor' | 'imageTextPlaceholderColor' | 'entryTextColor' | 'claimTextColor' | 'entryNumberColor' | 'statusClosedColor' | 'statusPausedColor' | 'statusEndedColor' | 'statusLabelColor';
    value: string | number | boolean;
}

export interface CommandSetting {
    type: 'entryCommand' | 'claimCommand' | 'category' | 'entriesClosedText' | 'prizeLabelText' | 'statLabelText' | 'entryCommandText' | 'closeTimerText' | 'claimCommandText' | 'winnerPendingText' | 'oddsText' | 'imageTextTemplate';
    value: string;
}

export interface NumberSetting {
    type: 'maxEntriesPerUser' | 'retentionDays' | 'pendingWinnerRotationSeconds' | 'cycleIntervalSeconds' | 'tickerIntervalSeconds' | 'commandCycleIntervalSeconds' | 'slideRevealIntervalSeconds' | 'slideVisibleSeconds' | 'autoCloseSeconds' | 'claimDuration' | 'displayDuration' | 'closeTimerUrgentSeconds' | 'claimTimerUrgentSeconds' | 'imageTextSize' | 'duration';
    value: number;
}

/**
 * Model for general effects
 */
export interface EffectModel extends BaseGiveawayConfig {
    giveawayOptions: GiveawayOptionsConfig;
}

/**
 * Event-related data structures
 */
export interface EventData {
    uuid: string;
    config: GiveawayConfig;
    paused?: boolean;
    entriesClosed?: boolean;
    overlayInstance: string | null;
}

export interface GiveawayTitleInfo {
    giveawayId: string;
    displayTitle: string;
}

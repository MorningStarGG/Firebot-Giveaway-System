import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import type { GiveawayUpdateModel, SlideMode } from "../types/types";
import { giveawayManager } from "../utility/giveaway-manager";
import updaterTemplate from "../templates/updater-template.html";
import { webServer, frontendCommunicator, modules } from "../main";

function durationToMs(value?: number, unit?: string): number | null {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;

    const u = (unit || 'days').toLowerCase();
    const multipliers: Record<string, number> = {
        minute: 60 * 1000,
        minutes: 60 * 1000,
        hour: 60 * 60 * 1000,
        hours: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000,
        years: 365 * 24 * 60 * 60 * 1000
    };

    const mult = multipliers[u] ?? multipliers.days;
    return Math.floor(numeric * mult);
}

function resolveSlideMode(display: any): SlideMode {
    if (!display) return 'disabled';
    const mode = (display.slideMode || '').toLowerCase();
    if (mode === 'image' || mode === 'widget' || mode === 'cycle' || mode === 'disabled') return mode as SlideMode;
    return 'disabled';
}

function applySlideMode(display: any, mode: SlideMode) {
    if (!display) return;
    display.slideMode = mode;
}

function normalizeSlideMode(display: any) {
    if (!display) return;
    applySlideMode(display, resolveSlideMode(display));
}

function normalizeDisplayModes(display: any) {
    if (!display) return;

    const allowedDisplayModes = ['widgetImage', 'widgetOnly', 'imageOnly', 'disabled'] as const;
    const allowedWidgetModes = ['full', 'minimal', 'ticker'] as const;

    const rawMode = (display.displayMode || '').toString();
    const rawWidgetMode = (display.widgetMode || '').toString();

    const mode = (allowedDisplayModes as readonly string[]).includes(rawMode)
        ? (rawMode as typeof allowedDisplayModes[number])
        : 'widgetImage';
    const widgetMode = (allowedWidgetModes as readonly string[]).includes(rawWidgetMode)
        ? (rawWidgetMode as typeof allowedWidgetModes[number])
        : 'full';

    display.displayMode = mode;
    display.widgetMode = widgetMode;
    const usesWidget = mode === 'widgetImage' || mode === 'widgetOnly';
    const usesImage = mode === 'widgetImage' || mode === 'imageOnly';

    display.imageOnlyMode = mode === 'imageOnly';
    display.tickerOnly = usesWidget && widgetMode === 'ticker';
    display.disabled = mode === 'disabled';
    display.minimalMode = usesWidget && (widgetMode === 'minimal' || widgetMode === 'ticker');

    if (!usesWidget || !usesImage || display.disabled) {
        applySlideMode(display, 'disabled');
    } else {
        normalizeSlideMode(display);
    }
}

function normalizeClaimMode(
    options: any,
    modeOverride?: 'enabled' | 'timer' | 'disabled'
): 'enabled' | 'timer' | 'disabled' {
    const modeInput = modeOverride || options?.claimMode;
    let resolved: 'enabled' | 'timer' | 'disabled';

    if (modeInput === 'enabled' || modeInput === 'timer' || modeInput === 'disabled') {
        resolved = modeInput;
    } else if (options?.requireClaim === false) {
        resolved = 'disabled';
    } else if (options?.enableClaimTimer !== false) {
        resolved = 'timer';
    } else {
        resolved = 'enabled';
    }

    if (options) {
        options.claimMode = resolved;
        if (resolved === 'disabled') {
            options.requireClaim = false;
            options.enableClaimTimer = false;
        } else if (resolved === 'timer') {
            options.requireClaim = true;
            options.enableClaimTimer = true;
        } else {
            options.requireClaim = true;
            options.enableClaimTimer = false;
        }
    }

    return resolved;
}

function prepareStylesForOverlay(styles: any, retentionDays?: number) {
    const prepared = { ...(styles || {}) };
    const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
    const rawPlacement = (prepared.imagePlacement ?? 'above') as typeof allowedPlacements[number];
    let placement = allowedPlacements.includes(rawPlacement) ? rawPlacement : 'above';

    if (prepared.showImage === false) {
        placement = 'none';
    }

    prepared.imagePlacement = placement;
    prepared.showImage = placement !== 'none';

    if (placement === 'none') {
        delete prepared.imageToken;
        delete prepared.imageUrl;
        delete prepared.imageFile;
        return prepared;
    }

    if (prepared.imageMode === 'local') {
        const filePath = prepared.imageFile || prepared.imageUrl;
        const resourceTokenManager = (modules as any)?.resourceTokenManager;
        if (filePath && resourceTokenManager?.storeResourcePath) {
            try {
                const ttlSeconds = Math.max(60, Math.floor((retentionDays ?? 7) * 24 * 60 * 60));
                prepared.imageToken = resourceTokenManager.storeResourcePath(filePath, ttlSeconds);
            } catch (error) {
                console.warn('Failed to prepare giveaway image file', error);
            }
        }
    } else {
        delete prepared.imageToken;
    }

    return prepared;
}

export function giveawaySystemUpdateEffectType() {
    const updateEffectType: Firebot.EffectType<GiveawayUpdateModel> = {
        definition: {
            id: "msgg:giveaway-system-update",
            name: "Advanced Giveaway Manager",
            description: "Add/remove entries, pick winners, approve/deny wins, and more",
            icon: "fad fa-gift",
            categories: ["overlay"],
            outputs: [
                {
                    label: "Winner",
                    description: "The selected winner username",
                    defaultName: "winner"
                },
                {
                    label: "Entry Count",
                    description: "The current number of entries",
                    defaultName: "entryCount"
                }
            ]
        },

        optionsTemplate: updaterTemplate,

        optionsController: ($scope: any, backendCommunicator: any) => {
            const resolveSlideModeLocal = (display: any): SlideMode => {
                if (!display) return 'disabled';
                const mode = (display.slideMode || '').toLowerCase();
                if (mode === 'image' || mode === 'widget' || mode === 'cycle' || mode === 'disabled') return mode as SlideMode;
                return 'disabled';
            };

            const applySlideModeLocal = (display: any, mode: SlideMode) => {
                if (!display) return;
                display.slideMode = mode;
            };

            const normalizeSlideModeLocal = (display: any) => {
                if (!display) return;
                applySlideModeLocal(display, resolveSlideModeLocal(display));
            };

            const normalizeDisplayModesLocal = (display: any) => {
                if (!display) return;

                const allowedDisplayModes = ['widgetImage', 'widgetOnly', 'imageOnly', 'disabled'] as const;
                const allowedWidgetModes = ['full', 'minimal', 'ticker'] as const;

                const rawMode = (display.displayMode || '').toString();
                const rawWidgetMode = (display.widgetMode || '').toString();

                const mode = (allowedDisplayModes as readonly string[]).includes(rawMode)
                    ? rawMode
                    : 'widgetImage';
                const widgetMode = (allowedWidgetModes as readonly string[]).includes(rawWidgetMode)
                    ? rawWidgetMode
                    : 'full';

                display.displayMode = mode;
                display.widgetMode = widgetMode;

                const usesWidget = mode === 'widgetImage' || mode === 'widgetOnly';
                const usesImage = mode === 'widgetImage' || mode === 'imageOnly';

                display.imageOnlyMode = mode === 'imageOnly';
                display.tickerOnly = usesWidget && widgetMode === 'ticker';
                display.disabled = mode === 'disabled';
                display.minimalMode = usesWidget && (widgetMode === 'minimal' || widgetMode === 'ticker');

                if (!usesWidget || !usesImage || display.disabled) {
                    applySlideModeLocal(display, 'disabled');
                } else {
                    normalizeSlideModeLocal(display);
                }
            };

            const normalizeClaimModeLocal = (
                options: any,
                modeOverride?: 'enabled' | 'timer' | 'disabled'
            ): 'enabled' | 'timer' | 'disabled' => {
                const modeInput = modeOverride || options?.claimMode;
                let resolved: 'enabled' | 'timer' | 'disabled';

                if (modeInput === 'enabled' || modeInput === 'timer' || modeInput === 'disabled') {
                    resolved = modeInput;
                } else if (options?.requireClaim === false) {
                    resolved = 'disabled';
                } else if (options?.enableClaimTimer !== false) {
                    resolved = 'timer';
                } else {
                    resolved = 'enabled';
                }

                if (options) {
                    options.claimMode = resolved;
                    options.requireClaim = resolved !== 'disabled';
                    options.enableClaimTimer = resolved === 'timer';
                }

                return resolved;
            };

            const DEFAULT_STYLES = {
                backgroundColor: "#111111",
                accentColor: "#a60000",
                textColor: "#e3e3e3",
                titleColor: "#e3e3e3",
                fontSize: "24px",
                winnerColor: "#ffcc00",
                shadowColor: "#a60000",
                giveawayWidth: "350px",
                giveawayScale: 1,
                imageScale: 1,
                customCSS: "",
                showImage: true,
                imageMode: "url",
                imageUrl: "",
                imageFile: "",
                imagePlacement: "above",
                imageOverlay: true,
                entriesClosedColor: "#ffcc00",
                prizeLabelColor: "#e3e3e3",
                statLabelColor: "#e3e3e3",
                prizeColor: "#e3e3e3",
                entryCommandColor: "#a60000",
                entryTextColor: "#e3e3e3",
                closeTimerColor: "#e3e3e3",
                closeTimerTextColor: "#e3e3e3",
                closeTimerValueColor: "#a60000",
                closeTimerUrgentColor: "#ff4444",
                claimCommandColor: "#a60000",
                claimTextColor: "#e3e3e3",
                claimTimerColor: "#e3e3e3",
                claimTimerTextColor: "#e3e3e3",
                claimTimerValueColor: "#ffcc00",
                claimTimerUrgentColor: "#ff4444",
                winnerPendingColor: "#ffcc00",
                statusClosedColor: "#ffcc00",
                statusPausedColor: "#a60000",
                statusEndedColor: "#ffcc00",
                statusLabelColor: "#e3e3e3",
                entryNumberColor: "#e3e3e3",
                imageTextColor: "#e3e3e3",
                imageTextPlaceholderColor: "#ffcc00",
                oddsColor: "#e3e3e3"
            };
            const defaultEffect = {
                mode: 'entryManagement',
                action: 'add',
                entryAction: 'add',
                giveawayTitle: '',
                category: '',
                username: '',
                winnerHistoryAction: 'setRetention',
                winnerHistoryUsername: '',
                winnerHistoryValue: 30,
                winnerHistoryUnit: 'days',
                oddsMultiplier: 1,
                removeAllEntries: true,
                closeTimeSeconds: undefined,
                clearCloseTime: false,
                displayDuration: 30,
                autoRemoveAfterClose: true,
                statusAction: 'stop',
                overlayInstance: '',
                display: {
                    showTitle: true,
                    showPrize: true,
                    showPrizeLabel: true,
                    prizeVisibility: 'label-prize',
                    showEntryCount: true,
                    showEntryCommand: true,
                    showWinner: true,
                    showClaimCommand: true,
                    showTimer: true,
                    showCloseTimer: true,
                    animateWinner: true,
                    rotateWinners: false,
                    pendingWinnerRotationSeconds: 5,
                    minimalMode: false,
                    tickerIntervalSeconds: 2,
                    commandCycleIntervalSeconds: 3,
                    oddsMode: 'both',
                    showOdds: true,
                    showOddsPercentage: true,
                    showOddsRatio: true,
                    imageOnlyMode: false,
                    cycleIntervalSeconds: 6,
                    displayMode: 'widgetImage',
                    widgetMode: 'full',
                    tickerOnly: false,
                    slideMode: 'disabled',
                    slideRevealIntervalSeconds: 8,
                    slideVisibleSeconds: 4,
                    prizeLabelText: 'PRIZE',
                    statLabelText: 'ENTRIES',
                    entriesClosedText: 'Entries closed',
                    entryCommandText: 'Type {command} to join!',
                    closeTimerText: 'Time left: {time}',
                    claimCommandText: 'Type {command} to claim your prize!',
                    winnerPendingText: 'Winner pending',
                    oddsText: 'Win odds: {percent}{ratio}',
                    closeTimerUrgentSeconds: 30,
                    claimTimerUrgentSeconds: 10,
                    showImageText: false,
                    imageTextTemplate: '{title} - {prize}',
                    imageTextPosition: 'bottom',
                    imageTextSize: 18
                },
                styles: { ...DEFAULT_STYLES },
                winnerCount: 1,
                autoApproveMulti: true,
                giveawayOptions: {
                    entryCommand: '!enter',
                    claimCommand: '!claim',
                    claimMode: 'timer',
                    requireClaim: true,
                    enableClaimTimer: true,
                    claimDuration: 60,
                    displayDuration: 30,
                    autoRemoveAfterClose: true,
                    autoRerollOnExpire: false,
                    retentionDays: 7,
                    requeueExpired: false,
                    requeueDenied: false,
                    allowMultipleEntries: false,
                    maxEntriesPerUser: 1
                }
            };

            const normalizeImagePlacement = (styles: any) => {
                if (!styles) return;
                const rawPlacement = (styles.imagePlacement ?? 'above') as typeof allowedPlacements[number];
                const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
                let placement = allowedPlacements.includes(rawPlacement) ? rawPlacement : 'above';
                if (styles.showImage === false) {
                    placement = 'none';
                }
                styles.imagePlacement = placement;
                styles.showImage = placement !== 'none';
            };

            const applyModePlacementRules = () => {
                normalizeDisplayModesLocal($scope.effect.display);
                if (!$scope.effect.styles) return;

                const mode = $scope.effect.display.displayMode;
                if (mode === 'disabled') {
                    $scope.effect.styles.imagePlacement = 'none';
                    $scope.effect.styles.showImage = false;
                } else if (mode === 'widgetOnly') {
                    $scope.effect.styles.imagePlacement = 'none';
                    $scope.effect.styles.showImage = false;
                } else {
                    $scope.effect.styles.showImage = true;
                    if (!$scope.effect.styles.imagePlacement || $scope.effect.styles.imagePlacement === 'none') {
                        $scope.effect.styles.imagePlacement = 'above';
                    }
                    if (mode === 'imageOnly') {
                        $scope.effect.styles.imagePlacement = 'above';
                    }
                }
            };

            $scope.effect = { ...defaultEffect, ...$scope.effect };
            $scope.effect.styles = { ...DEFAULT_STYLES, ...($scope.effect.styles || {}) };
            const colorKeys = [
                'backgroundColor', 'accentColor', 'textColor', 'titleColor', 'winnerColor', 'shadowColor',
                'entriesClosedColor', 'prizeLabelColor', 'statLabelColor', 'prizeColor',
                'entryCommandColor', 'entryTextColor', 'entryNumberColor',
                'closeTimerColor', 'closeTimerTextColor', 'closeTimerValueColor', 'closeTimerUrgentColor',
                'claimCommandColor', 'claimTextColor', 'claimTimerColor', 'claimTimerTextColor', 'claimTimerValueColor', 'claimTimerUrgentColor',
                'winnerPendingColor', 'statusClosedColor', 'statusPausedColor', 'statusEndedColor', 'statusLabelColor',
                'imageTextColor', 'imageTextPlaceholderColor', 'oddsColor'
            ] as const;
            for (const key of colorKeys) {
                if ($scope.effect.styles[key] == null || $scope.effect.styles[key] === '') {
                    $scope.effect.styles[key] = (DEFAULT_STYLES as any)[key];
                }
            }
            if (!$scope.effect.entryAction) {
                $scope.effect.entryAction = 'add';
            }
            if (!$scope.effect.statusAction) {
                $scope.effect.statusAction = 'stop';
            }
            normalizeClaimModeLocal($scope.effect.giveawayOptions);
            normalizeSlideModeLocal($scope.effect.display);
            normalizeDisplayModesLocal($scope.effect.display);
            normalizeImagePlacement($scope.effect.styles);
            applyModePlacementRules();
            $scope.onClaimModeChange = () => {
                normalizeClaimModeLocal($scope.effect.giveawayOptions);
            };
            $scope.activeGiveaways = [];
            $scope.allGiveaways = [];
            $scope.currentEntries = [];
            $scope.pendingWinners = [];

            $scope.styleLabels = {
                backgroundColor: "Background Color",
                accentColor: "Accent Color",
                textColor: "Text Color",
                titleColor: "Title Color",
                winnerColor: "Winner Color",
                shadowColor: "Text Shadow",
                giveawayScale: "Giveaway Scale",
                imageScale: "Image Scale",
                imageMode: "Image Source",
                imageUrl: "Image URL",
                imageFile: "Image File",
                imagePlacement: "Image Placement",
                imageOverlay: "Image Overlay",
                closeTimerTextColor: "Close Timer Text",
                closeTimerValueColor: "Close Timer Number",
                closeTimerUrgentColor: "Close Timer Urgent",
                claimTimerTextColor: "Claim Timer Text",
                claimTimerValueColor: "Claim Timer Number",
                claimTimerUrgentColor: "Claim Timer Urgent",
                entryCommandColor: "Entry Command Color",
                entryTextColor: "Entry Text Color",
                entryNumberColor: "Entry Number Color",
                claimCommandColor: "Claim Command Color",
                claimTextColor: "Claim Text Color",
                statusClosedColor: "Status Closed Color",
                statusPausedColor: "Status Paused Color",
                statusEndedColor: "Status Ended Color",
                statusLabelColor: "Status Label Color",
                prizeLabelColor: "Prize Label Color",
                statLabelColor: "Stat Label Color",
                prizeColor: "Prize Text Color",
                winnerPendingColor: "Winner Pending Color",
                oddsColor: "Odds Color",
                imageTextColor: "Image Text Color",
                imageTextPlaceholderColor: "Image Text Placeholder Color"
            };

            function getGiveawayId(giveawayTitle: string | undefined, communicator: any): string {
                if (!giveawayTitle) return '';

                let displayTitle = giveawayTitle;
                if (giveawayTitle.startsWith('$customVariable[') || giveawayTitle.startsWith('$$')) {
                    const variableName = giveawayTitle.startsWith('$$')
                        ? giveawayTitle.substring(2)
                        : giveawayTitle.replace('$customVariable[', '').replace(']', '');
                    const variableData = communicator.fireEventSync("get-custom-variable", variableName);
                    displayTitle = variableData;
                    return variableData?.startsWith('giveaway_') ? variableData : `giveaway_${variableData}`;
                }

                return displayTitle.startsWith('giveaway_') ? displayTitle : `giveaway_${displayTitle}`;
            }

            function safeApply(fn: () => void) {
                try {
                    if (!$scope.$$phase && !$scope.$root.$$phase) {
                        $scope.$apply(fn);
                    } else {
                        fn();
                    }
                } catch (error) {
                    console.error("[GiveawaySystemUpdater] Error in safeApply:", error);
                }
            }

            $scope.loadGiveawayData = () => {
                let giveawayId = $scope.effect.giveawaySelectionMode === 'manual'
                    ? getGiveawayId($scope.effect.manualGiveawayTitle, backendCommunicator)
                    : getGiveawayId($scope.effect.giveawayTitle, backendCommunicator);

                if (!giveawayId) {
                    safeApply(() => {
                        $scope.currentEntries = [];
                        $scope.pendingWinners = [];
                    });
                    return;
                }

                backendCommunicator.fireEventAsync("getGiveawayData", giveawayId)
                    .then((giveawayData: any) => {
                        if (giveawayData) {
                            normalizeClaimModeLocal(giveawayData);
                            safeApply(() => {
                                $scope.currentEntries = giveawayData.entries || [];
                                $scope.pendingWinners = giveawayData.pendingWinners || [];

                                if (giveawayData.giveawayData?.display) {
                                    const display = giveawayData.giveawayData.display;
                                    $scope.effect.display = {
                                        ...defaultEffect.display,
                                        ...display,
                                        rotateWinners: display.rotateWinners ?? false,
                                        pendingWinnerRotationSeconds: display.pendingWinnerRotationSeconds ?? 5,
                                        minimalMode: display.minimalMode ?? false,
                                        tickerIntervalSeconds: display.tickerIntervalSeconds ?? 2,
                                        commandCycleIntervalSeconds: display.commandCycleIntervalSeconds ?? 3,
                                        imageOnlyMode: display.imageOnlyMode ?? false,
                                        cycleIntervalSeconds: display.cycleIntervalSeconds ?? 6,
                                        slideMode: display.slideMode ?? 'disabled',
                                        slideRevealIntervalSeconds: display.slideRevealIntervalSeconds ?? 8,
                                        slideVisibleSeconds: display.slideVisibleSeconds ?? 4,
                                        imageTextTemplate: display.imageTextTemplate || defaultEffect.display.imageTextTemplate,
                                        imageTextPosition: display.imageTextPosition || defaultEffect.display.imageTextPosition,
                                        imageTextSize: display.imageTextSize || defaultEffect.display.imageTextSize,
                                        showImageText: display.showImageText ?? defaultEffect.display.showImageText
                                    };
                                    $scope.effect.display.prizeLabelText = giveawayData.giveawayData?.prizeLabelText || $scope.effect.display.prizeLabelText;
                                    $scope.effect.display.statLabelText = giveawayData.giveawayData?.statLabelText || $scope.effect.display.statLabelText;
                                    $scope.effect.display.entriesClosedText = giveawayData.giveawayData?.entriesClosedText || $scope.effect.display.entriesClosedText;
                                    $scope.effect.display.entryCommandText = giveawayData.giveawayData?.display?.entryCommandText || $scope.effect.display.entryCommandText;
                                    $scope.effect.display.closeTimerText = giveawayData.giveawayData?.display?.closeTimerText || $scope.effect.display.closeTimerText;
                                    $scope.effect.display.claimCommandText = giveawayData.giveawayData?.display?.claimCommandText || $scope.effect.display.claimCommandText;
                                    $scope.effect.display.winnerPendingText = giveawayData.giveawayData?.display?.winnerPendingText || $scope.effect.display.winnerPendingText;
                                    normalizeSlideModeLocal($scope.effect.display);
                                    normalizeDisplayModesLocal($scope.effect.display);
                                    applyModePlacementRules();
                                }

                                if (giveawayData.giveawayData?.styles) {
                                    $scope.effect.styles = { ...DEFAULT_STYLES, ...giveawayData.giveawayData.styles };
                                    for (const key of colorKeys) {
                                        if ($scope.effect.styles[key] == null || $scope.effect.styles[key] === '') {
                                            $scope.effect.styles[key] = (DEFAULT_STYLES as any)[key];
                                        }
                                    }
                                    normalizeImagePlacement($scope.effect.styles);
                                    applyModePlacementRules();
                                }

                                $scope.effect.category = giveawayData.giveawayData?.category || '';

                                $scope.effect.giveawayOptions = {
                                    entryCommand: giveawayData.giveawayData?.entryCommand || '!enter',
                                    claimCommand: giveawayData.giveawayData?.claimCommand || '!claim',
                                    claimMode: giveawayData.claimMode,
                                    requireClaim: giveawayData.requireClaim !== false,
                                    autoRerollOnExpire: !!giveawayData.autoRerollOnExpire,
                                    category: giveawayData.giveawayData?.category || '',
                                    retentionDays: giveawayData.retentionDays || 7,
                                    requeueExpired: !!giveawayData.requeueExpired,
                                    requeueDenied: !!giveawayData.requeueDenied,
                                    displayDuration: giveawayData.displayDuration ?? defaultEffect.giveawayOptions.displayDuration,
                                    autoRemoveAfterClose: giveawayData.autoRemoveAfterClose !== false,
                                    claimDuration: giveawayData.claimDuration ?? defaultEffect.giveawayOptions.claimDuration,
                                    enableClaimTimer: giveawayData.enableClaimTimer !== false,
                                    allowMultipleEntries: !!giveawayData.allowMultipleEntries,
                                    maxEntriesPerUser: giveawayData.maxEntriesPerUser || 1
                                };
                                normalizeClaimModeLocal($scope.effect.giveawayOptions);
                            });
                        }
                    });
            };

            $scope.onSlideModeChange = () => {
                normalizeSlideModeLocal($scope.effect.display);
                normalizeDisplayModesLocal($scope.effect.display);
            };

            $scope.onDisplayModeChange = () => {
                applyModePlacementRules();
                normalizeImagePlacement($scope.effect.styles);
            };

            $scope.$watch('effect.styles.imagePlacement', (placement: string) => {
                if (placement === 'background' || placement === 'none') {
                    applySlideModeLocal($scope.effect.display, 'disabled');
                }
            });

            $scope.$watch('effect.mode', (newMode: string) => {
                if (!newMode) return;

                if (newMode === 'winnerHistory') {
                    if (!$scope.effect.winnerHistoryAction) $scope.effect.winnerHistoryAction = 'setRetention';
                    if ($scope.effect.winnerHistoryValue == null) $scope.effect.winnerHistoryValue = 30;
                    if (!$scope.effect.winnerHistoryUnit) $scope.effect.winnerHistoryUnit = 'days';
                    if ($scope.effect.winnerHistoryUsername == null) $scope.effect.winnerHistoryUsername = '';
                    return;
                }

                const giveawayId = $scope.effect.giveawaySelectionMode === 'manual'
                    ? getGiveawayId($scope.effect.manualGiveawayTitle, backendCommunicator)
                    : $scope.effect.giveawayTitle;

                if (newMode === 'updateStyles' || newMode === 'updateDisplay') {
                    if (!$scope.effect.setting?.type) {
                        $scope.effect.setting = {
                            type: newMode === 'updateStyles' ? 'backgroundColor' : 'showEntryCount',
                            value: newMode === 'updateStyles' ? '' : true
                        };
                    }
                }

                if (giveawayId) {
                    $scope.loadGiveawayData();
                }
            });

            $scope.$watch('[effect.giveawaySelectionMode, effect.manualGiveawayTitle, effect.giveawayTitle]',
                (newVal: [string, string, string], oldVal: [string, string, string]) => {
                    if ($scope.effect.mode === 'winnerHistory') {
                        return;
                    }
                    const [newMode, newManual, newTitle] = newVal;
                    const [oldMode, oldManual, oldTitle] = oldVal;

                    if (newMode !== oldMode || newManual !== oldManual || newTitle !== oldTitle) {
                        $scope.loadGiveawayData();
                    }
                }, true);

            backendCommunicator.on("giveawayRemoved", () => {
                loadGiveaways();
                loadAllGiveaways();
            });

            backendCommunicator.on("giveawayEnded", () => {
                loadGiveaways();
                loadAllGiveaways();
            });

            backendCommunicator.on("giveawayStarted", () => {
                loadGiveaways();
                loadAllGiveaways();
            });

            backendCommunicator.on("giveawayDataChanged", (updatedGiveawayId: string) => {
                if (updatedGiveawayId === $scope.effect.giveawayTitle ||
                    (updatedGiveawayId === $scope.effect.manualGiveawayTitle?.replace(/^giveaway_/, ''))) {
                    $scope.loadGiveawayData();
                }
            });

            function handleResponse(response: unknown) {
                if (Array.isArray(response) && response.every(item => typeof item === 'string')) {
                    backendCommunicator.fireEventAsync("getAllGiveawaysWithStatus", {})
                        .then((giveawaysWithStatus: Array<{ giveawayId: string, displayTitle: string, status: 'active' | 'stopped' }>) => {
                            const mappedGiveaways = response.map(giveawayId => {
                                const giveawayInfo = giveawaysWithStatus.find((g: { giveawayId: string }) => g.giveawayId === giveawayId);
                                return {
                                    value: giveawayId,
                                    label: giveawayInfo ? giveawayInfo.displayTitle : giveawayId.replace('giveaway_', '')
                                };
                            });

                            safeApply(() => {
                                $scope.activeGiveaways = mappedGiveaways;
                                if ($scope.effect.giveawayTitle) {
                                    $scope.loadGiveawayData();
                                }
                            });
                        });
                }
            }

            function handleAllGiveawaysResponse(response: Array<{ giveawayId: string, displayTitle: string, status: 'active' | 'stopped' }>) {
                if (Array.isArray(response)) {
                    const mappedGiveaways = response.map(giveaway => ({
                        value: giveaway.giveawayId,
                        label: `${giveaway.displayTitle} (${giveaway.status})`
                    }));

                    safeApply(() => {
                        $scope.allGiveaways = mappedGiveaways;
                    });
                }
            }

            function loadGiveaways() {
                backendCommunicator.fireEventAsync("getActiveGiveaways", {})
                    .then((response: unknown) => {
                        handleResponse(response);
                    })
                    .catch((error: unknown) => {
                        console.error("[GiveawaySystemUpdater] Error:", error);
                    });
            }

            function loadAllGiveaways() {
                backendCommunicator.fireEventAsync("getAllGiveawaysWithStatus", {})
                    .then((response: unknown) => {
                        handleAllGiveawaysResponse(response as Array<{
                            giveawayId: string,
                            displayTitle: string,
                            status: 'active' | 'stopped'
                        }>);
                    })
                    .catch((error: unknown) => {
                        console.error("[GiveawaySystemUpdater] Error loading giveaways:", error);
                    });
            }

            loadGiveaways();
            loadAllGiveaways();
        },

        onTriggerEvent: async (event) => {
            try {
                if (event.effect.mode === 'winnerHistory') {
                    const action = (event.effect.winnerHistoryAction || 'setRetention') as string;
                    const unit = event.effect.winnerHistoryUnit || 'days';
                    const value = event.effect.winnerHistoryValue ?? 30;
                    const username = (event.effect.winnerHistoryUsername || '').trim();

                    if (action === 'setRetention') {
                        const ms = durationToMs(value, unit) ?? (30 * 24 * 60 * 60 * 1000);
                        await giveawayManager.setWinnerHistoryRetentionMs(ms);
                        await giveawayManager.cleanupWinnerHistory();
                        return { success: true };
                    }

                    if (action === 'purgeAll') {
                        await giveawayManager.clearWinnerHistory();
                        return { success: true };
                    }

                    if (action === 'purgeUser' || action === 'purgeUserOlderThan') {
                        if (!username) throw new Error('Username is required');
                        const olderThanMs = action === 'purgeUserOlderThan'
                            ? (durationToMs(value, unit) ?? await giveawayManager.getWinnerHistoryRetentionMs())
                            : undefined;
                        await giveawayManager.purgeWinnerHistory({ username, olderThanMs });
                        return { success: true };
                    }

                    if (action === 'purgeOlderThan') {
                        const olderThanMs = durationToMs(value, unit) ?? await giveawayManager.getWinnerHistoryRetentionMs();
                        await giveawayManager.purgeWinnerHistory({ olderThanMs });
                        return { success: true };
                    }

                    throw new Error(`Unknown winnerHistoryAction: ${action}`);
                }

                let giveawayId: string;
                if (event.effect.display) {
                    normalizeSlideMode(event.effect.display);
                    normalizeDisplayModes(event.effect.display);
                }

                if (event.effect.giveawaySelectionMode === 'manual') {
                    if (event.effect.manualGiveawayTitle) {
                        giveawayId = event.effect.manualGiveawayTitle.startsWith('giveaway_')
                            ? event.effect.manualGiveawayTitle
                            : `giveaway_${event.effect.manualGiveawayTitle.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    } else {
                        const activeGiveaways = await giveawayManager.getActiveGiveaways();
                        if (activeGiveaways.length === 1) {
                            giveawayId = activeGiveaways[0];
                        } else if (activeGiveaways.length === 0) {
                            throw new Error('No active giveaways found');
                        } else {
                            throw new Error('Multiple giveaways active - please specify target giveaway');
                        }
                    }
                } else {
                    const normalizeId = (value: string | undefined) => {
                        if (!value) return '';
                        return value.startsWith('giveaway_')
                            ? value
                            : `giveaway_${value.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    };
                    giveawayId = normalizeId(event.effect.giveawayTitle);
                }

                const giveawayData = await giveawayManager.getGiveaway(giveawayId);
                if (giveawayData?.giveawayData?.styles) {
                    giveawayData.giveawayData.styles = prepareStylesForOverlay(
                        giveawayData.giveawayData.styles,
                        giveawayData.retentionDays
                    );
                }
                if (giveawayData?.giveawayData?.display) {
                    normalizeSlideMode(giveawayData.giveawayData.display);
                    normalizeDisplayModes(giveawayData.giveawayData.display);
                }
                if (giveawayData) {
                    normalizeClaimMode(giveawayData);
                }

                if (!giveawayData) {
                    throw new Error(`Giveaway ${giveawayId} not found`);
                }

                if (!event.effect.entryAction) {
                    event.effect.entryAction = 'add';
                }

                switch (event.effect.mode) {
                    case 'entryManagement': {
                        const entryAction = (event.effect.entryAction || 'add') as string;
                        const normalizedAction = ['add', 'remove', 'pick', 'approve', 'claim', 'deny', 'reroll'].includes(entryAction)
                            ? entryAction
                            : 'add';
                        const username = event.effect.username;

                        if (normalizedAction === 'add' || normalizedAction === 'remove') {
                            if (!username) {
                                throw new Error('Username is required');
                            }

                            if (normalizedAction === 'add') {
                                const oddsMultiplier = Number(event.effect.oddsMultiplier) || 1;
                                const success = await giveawayManager.addEntry(giveawayId, username, oddsMultiplier);
                                if (!success) {
                                    throw new Error('Failed to add entry - user may have reached max entries or giveaway is paused/closed/ended');
                                }
                            } else {
                                const removeAll = event.effect.removeAllEntries ?? true;
                                await giveawayManager.removeEntry(giveawayId, username, removeAll);
                            }

                            frontendCommunicator.send('giveawayDataChanged', giveawayId);

                            const updatedGiveaway = await giveawayManager.getGiveaway(giveawayId);
                            return {
                                success: true,
                                outputs: {
                                    entryCount: updatedGiveaway?.totalEntries || 0
                                }
                            };
                        }

                        if (normalizedAction === 'pick') {
                            const count = Math.max(1, Number(event.effect.winnerCount) || 1);
                            const autoApprove = event.effect.autoApproveMulti !== false;
                            const requireClaim = giveawayData?.requireClaim !== false;

                            const winners: string[] = [];

                            for (let i = 0; i < count; i++) {
                                const winner = await giveawayManager.pickWinner(giveawayId, modules.eventManager);
                                if (!winner) {
                                    break;
                                }

                                winners.push(winner.username);

                                if (autoApprove && requireClaim) {
                                    const approved = await giveawayManager.approveWin(giveawayId, modules.eventManager, winner.username);
                                    if (!approved) {
                                        break;
                                    }
                                }
                            }

                            if (winners.length === 0) {
                                throw new Error('No entries available to pick a winner');
                            }

                            frontendCommunicator.send('giveawayDataChanged', giveawayId);

                            return {
                                success: true,
                                outputs: {
                                    winner: winners.join(', ')
                                }
                            };
                        }

                        if (normalizedAction === 'claim') {
                            if (!username) {
                                throw new Error('Username is required');
                            }

                            const success = await giveawayManager.claimWin(giveawayId, username, modules.eventManager);
                            if (!success) {
                                throw new Error('Failed to claim win - user may not be the winner, already claimed, or deadline passed');
                            }

                            frontendCommunicator.send('giveawayDataChanged', giveawayId);
                            return { success: true };
                        }

                        if (normalizedAction === 'approve') {
                            const success = await giveawayManager.approveWin(giveawayId, modules.eventManager, username);
                            if (!success) {
                                throw new Error('Failed to approve win - winner may not have claimed yet');
                            }
                            frontendCommunicator.send('giveawayDataChanged', giveawayId);
                            return { success: true };
                        }

                        if (normalizedAction === 'deny') {
                            const success = await giveawayManager.denyWin(giveawayId, modules.eventManager, username);
                            if (!success) {
                                throw new Error('Failed to deny win - no matching winner found');
                            }
                            frontendCommunicator.send('giveawayDataChanged', giveawayId);
                            return { success: true };
                        }

                        if (normalizedAction === 'reroll') {
                            const newWinner = await giveawayManager.rerollWinner(giveawayId, modules.eventManager, true);
                            if (!newWinner) {
                                throw new Error('No remaining entries to pick a new winner');
                            }
                            frontendCommunicator.send('giveawayDataChanged', giveawayId);
                            return {
                                success: true,
                                outputs: {
                                    winner: newWinner.username
                                }
                            };
                        }

                        throw new Error(`Unsupported entry action: ${normalizedAction}`);
                    }

                    case 'clearEntries': {
                        await giveawayManager.clearEntries(giveawayId);
                        frontendCommunicator.send('giveawayDataChanged', giveawayId);
                        return { success: true };
                    }

                    case 'updateStyles': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        const defaultStyles = {
                            backgroundColor: "#111111",
                            accentColor: "#a60000",
                            textColor: "#e3e3e3",
                            titleColor: "#e3e3e3",
                            fontSize: "24px",
                            winnerColor: "#ffcc00",
                            shadowColor: "#a60000",
                            giveawayWidth: "350px",
                            giveawayScale: 1,
                            imageScale: 1,
                            customCSS: "",
                            showImage: true,
                            imageMode: "url",
                            imageUrl: "",
                            imageFile: "",
                            imagePlacement: "above",
                            imageOverlay: true,
                            entriesClosedColor: "#ffcc00",
                            prizeLabelColor: "#e3e3e3",
                            statLabelColor: "#e3e3e3",
                            prizeColor: "#e3e3e3",
                            entryCommandColor: "",
                            entryTextColor: "",
                            closeTimerColor: "",
                            closeTimerTextColor: "",
                            closeTimerValueColor: "",
                            closeTimerUrgentColor: "#ff4444",
                            claimCommandColor: "",
                            claimTextColor: "",
                            claimTimerColor: "",
                            claimTimerTextColor: "",
                            claimTimerValueColor: "",
                            claimTimerUrgentColor: "#ff4444",
                            winnerPendingColor: "",
                            statusClosedColor: "",
                            statusPausedColor: "",
                            statusEndedColor: "",
                            statusLabelColor: "",
                            entryNumberColor: "",
                            imageTextColor: "#e3e3e3",
                            imageTextPlaceholderColor: "#ffcc00",
                            oddsColor: ""
                        };

                        const prepareStyles = (incoming: any) => {
                            const prepared = { ...(incoming || {}) };
                            const rawPlacement = (prepared.imagePlacement ?? 'above') as typeof allowedPlacements[number];
                            const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
                            let placement = allowedPlacements.includes(rawPlacement) ? rawPlacement : 'above';

                            if (prepared.showImage === false) {
                                placement = 'none';
                            }

                            prepared.imagePlacement = placement;
                            prepared.showImage = placement !== 'none';

                            if (placement === 'none') {
                                delete prepared.imageToken;
                                delete prepared.imageUrl;
                                delete prepared.imageFile;
                                return prepared;
                            }
                            if (prepared.imageMode === 'local') {
                                const filePath = prepared.imageFile || prepared.imageUrl;
                                const resourceTokenManager = (modules as any)?.resourceTokenManager;
                                if (filePath && resourceTokenManager?.storeResourcePath) {
                                    try {
                                        const ttlSeconds = Math.max(
                                            60,
                                            Math.floor((giveawayData?.retentionDays ?? 7) * 24 * 60 * 60)
                                        );
                                        prepared.imageToken = resourceTokenManager.storeResourcePath(filePath, ttlSeconds);
                                    } catch (err) {
                                        console.warn('Failed to prepare giveaway image file', err);
                                    }
                                }
                            } else {
                                delete prepared.imageToken;
                            }
                            return prepared;
                        };

                        if (event.effect.giveawaySelectionMode === 'manual' && event.effect.setting) {
                            switch (event.effect.setting.type) {
                                case 'backgroundColor':
                                    giveawayData.giveawayData.styles.backgroundColor = String(event.effect.setting.value);
                                    break;
                                case 'accentColor':
                                    giveawayData.giveawayData.styles.accentColor = String(event.effect.setting.value);
                                    break;
                                case 'textColor':
                                    giveawayData.giveawayData.styles.textColor = String(event.effect.setting.value);
                                    break;
                                case 'titleColor':
                                    giveawayData.giveawayData.styles.titleColor = String(event.effect.setting.value);
                                    break;
                                case 'winnerColor':
                                    giveawayData.giveawayData.styles.winnerColor = String(event.effect.setting.value);
                                    break;
                                case 'shadowColor':
                                    giveawayData.giveawayData.styles.shadowColor = String(event.effect.setting.value);
                                    break;
                                case 'showImage':
                                    giveawayData.giveawayData.styles.showImage = Boolean(event.effect.setting.value);
                                    if (!giveawayData.giveawayData.styles.showImage) {
                                        giveawayData.giveawayData.styles.imagePlacement = 'none';
                                    } else if (!giveawayData.giveawayData.styles.imagePlacement || giveawayData.giveawayData.styles.imagePlacement === 'none') {
                                        giveawayData.giveawayData.styles.imagePlacement = 'above';
                                    }
                                    break;
                                case 'imageTextTemplate':
                                    giveawayData.giveawayData.display = giveawayData.giveawayData.display || {};
                                    giveawayData.giveawayData.display.imageTextTemplate = String(event.effect.setting.value || '{title} - {prize}');
                                    break;
                                case 'oddsColor':
                                    giveawayData.giveawayData.styles.oddsColor = String(event.effect.setting.value);
                                    break;
                                case 'prizeLabelColor':
                                    giveawayData.giveawayData.styles.prizeLabelColor = String(event.effect.setting.value);
                                    break;
                                case 'statLabelColor':
                                    giveawayData.giveawayData.styles.statLabelColor = String(event.effect.setting.value);
                                    break;
                                case 'prizeColor':
                                    giveawayData.giveawayData.styles.prizeColor = String(event.effect.setting.value);
                                    break;
                                case 'entryCommandColor':
                                    giveawayData.giveawayData.styles.entryCommandColor = String(event.effect.setting.value);
                                    break;
                                case 'entryTextColor':
                                    giveawayData.giveawayData.styles.entryTextColor = String(event.effect.setting.value);
                                    break;
                                case 'closeTimerColor':
                                    giveawayData.giveawayData.styles.closeTimerColor = String(event.effect.setting.value);
                                    break;
                                case 'closeTimerTextColor':
                                    giveawayData.giveawayData.styles.closeTimerTextColor = String(event.effect.setting.value);
                                    break;
                                case 'closeTimerValueColor':
                                    giveawayData.giveawayData.styles.closeTimerValueColor = String(event.effect.setting.value);
                                    break;
                                case 'closeTimerUrgentColor':
                                    giveawayData.giveawayData.styles.closeTimerUrgentColor = String(event.effect.setting.value);
                                    break;
                                case 'claimCommandColor':
                                    giveawayData.giveawayData.styles.claimCommandColor = String(event.effect.setting.value);
                                    break;
                                case 'claimTextColor':
                                    giveawayData.giveawayData.styles.claimTextColor = String(event.effect.setting.value);
                                    break;
                                case 'claimTimerColor':
                                    giveawayData.giveawayData.styles.claimTimerColor = String(event.effect.setting.value);
                                    break;
                                case 'claimTimerTextColor':
                                    giveawayData.giveawayData.styles.claimTimerTextColor = String(event.effect.setting.value);
                                    break;
                                case 'claimTimerValueColor':
                                    giveawayData.giveawayData.styles.claimTimerValueColor = String(event.effect.setting.value);
                                    break;
                                case 'claimTimerUrgentColor':
                                    giveawayData.giveawayData.styles.claimTimerUrgentColor = String(event.effect.setting.value);
                                    break;
                                case 'winnerPendingColor':
                                    giveawayData.giveawayData.styles.winnerPendingColor = String(event.effect.setting.value);
                                    break;
                                case 'statusClosedColor':
                                    giveawayData.giveawayData.styles.statusClosedColor = String(event.effect.setting.value);
                                    break;
                                case 'statusPausedColor':
                                    giveawayData.giveawayData.styles.statusPausedColor = String(event.effect.setting.value);
                                    break;
                                case 'statusEndedColor':
                                    giveawayData.giveawayData.styles.statusEndedColor = String(event.effect.setting.value);
                                    break;
                                case 'statusLabelColor':
                                    giveawayData.giveawayData.styles.statusLabelColor = String(event.effect.setting.value);
                                    break;
                                case 'entryNumberColor':
                                    giveawayData.giveawayData.styles.entryNumberColor = String(event.effect.setting.value);
                                    break;
                                case 'imageTextColor':
                                    giveawayData.giveawayData.styles.imageTextColor = String(event.effect.setting.value);
                                    break;
                                case 'imageTextPlaceholderColor':
                                    giveawayData.giveawayData.styles.imageTextPlaceholderColor = String(event.effect.setting.value);
                                    break;
                            }
                            const rawPlacement = giveawayData.giveawayData.styles.imagePlacement;
                            const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
                            const normalizedRaw = (rawPlacement ?? 'above') as typeof allowedPlacements[number];
                            let placement = allowedPlacements.includes(normalizedRaw) ? normalizedRaw : 'above';
                            if (giveawayData.giveawayData.styles.showImage === false) {
                                placement = 'none';
                            }
                            giveawayData.giveawayData.styles.imagePlacement = placement;
                            giveawayData.giveawayData.styles.showImage = placement !== 'none';
                            giveawayData.giveawayData.styles = prepareStyles(giveawayData.giveawayData.styles);
                        } else {
                            giveawayData.giveawayData.styles = prepareStyles({
                                ...giveawayData.giveawayData.styles,
                                backgroundColor: event.effect.styles?.backgroundColor ?? defaultStyles.backgroundColor,
                                accentColor: event.effect.styles?.accentColor ?? defaultStyles.accentColor,
                                textColor: event.effect.styles?.textColor ?? defaultStyles.textColor,
                                titleColor: event.effect.styles?.titleColor ?? defaultStyles.titleColor,
                                winnerColor: event.effect.styles?.winnerColor ?? defaultStyles.winnerColor,
                                shadowColor: event.effect.styles?.shadowColor ?? defaultStyles.shadowColor,
                                giveawayWidth: event.effect.styles?.giveawayWidth ?? defaultStyles.giveawayWidth,
                                giveawayScale: event.effect.styles?.giveawayScale ?? defaultStyles.giveawayScale,
                                customCSS: event.effect.styles?.customCSS ?? defaultStyles.customCSS,
                                imageMode: event.effect.styles?.imageMode ?? defaultStyles.imageMode,
                                imageUrl: event.effect.styles?.imageUrl ?? defaultStyles.imageUrl,
                                imageFile: event.effect.styles?.imageFile ?? defaultStyles.imageFile,
                                imagePlacement: event.effect.styles?.imagePlacement ?? defaultStyles.imagePlacement,
                                imageOverlay: event.effect.styles?.imageOverlay ?? defaultStyles.imageOverlay,
                                imageScale: event.effect.styles?.imageScale ?? defaultStyles.imageScale,
                                showImage: event.effect.styles?.showImage ?? defaultStyles.showImage,
                                entriesClosedColor: event.effect.styles?.entriesClosedColor ?? defaultStyles.entriesClosedColor,
                                prizeLabelColor: event.effect.styles?.prizeLabelColor ?? defaultStyles.prizeLabelColor,
                                statLabelColor: event.effect.styles?.statLabelColor ?? defaultStyles.statLabelColor,
                                prizeColor: event.effect.styles?.prizeColor ?? defaultStyles.prizeColor,
                                entryCommandColor: event.effect.styles?.entryCommandColor ?? defaultStyles.entryCommandColor,
                                entryTextColor: event.effect.styles?.entryTextColor ?? defaultStyles.entryTextColor,
                                closeTimerTextColor: event.effect.styles?.closeTimerTextColor ?? defaultStyles.closeTimerTextColor,
                                closeTimerValueColor: event.effect.styles?.closeTimerValueColor ?? defaultStyles.closeTimerValueColor,
                                closeTimerUrgentColor: event.effect.styles?.closeTimerUrgentColor ?? defaultStyles.closeTimerUrgentColor,
                                claimCommandColor: event.effect.styles?.claimCommandColor ?? defaultStyles.claimCommandColor,
                                claimTextColor: event.effect.styles?.claimTextColor ?? defaultStyles.claimTextColor,
                                claimTimerColor: event.effect.styles?.claimTimerColor ?? defaultStyles.claimTimerColor,
                                claimTimerTextColor: event.effect.styles?.claimTimerTextColor ?? defaultStyles.claimTimerTextColor,
                                claimTimerValueColor: event.effect.styles?.claimTimerValueColor ?? defaultStyles.claimTimerValueColor,
                                claimTimerUrgentColor: event.effect.styles?.claimTimerUrgentColor ?? defaultStyles.claimTimerUrgentColor,
                                winnerPendingColor: event.effect.styles?.winnerPendingColor ?? defaultStyles.winnerPendingColor,
                                statusClosedColor: event.effect.styles?.statusClosedColor ?? defaultStyles.statusClosedColor,
                                statusPausedColor: event.effect.styles?.statusPausedColor ?? defaultStyles.statusPausedColor,
                                statusEndedColor: event.effect.styles?.statusEndedColor ?? defaultStyles.statusEndedColor,
                                statusLabelColor: event.effect.styles?.statusLabelColor ?? defaultStyles.statusLabelColor,
                                entryNumberColor: event.effect.styles?.entryNumberColor ?? defaultStyles.entryNumberColor,
                                imageTextColor: event.effect.styles?.imageTextColor ?? defaultStyles.imageTextColor,
                                imageTextPlaceholderColor: event.effect.styles?.imageTextPlaceholderColor ?? defaultStyles.imageTextPlaceholderColor,
                                oddsColor: event.effect.styles?.oddsColor ?? defaultStyles.oddsColor
                            });
                        }

                        await giveawayManager.updateGiveaway(giveawayId, giveawayData);

                        await webServer.sendToOverlay("giveaway-updater", {
                            type: 'update',
                            overlayInstance: giveawayData.overlayInstance,
                            config: {
                                giveawayTitle: giveawayId.replace('giveaway_', ''),
                                giveawayData: giveawayData.giveawayData,
                                entries: giveawayData.entries,
                                totalEntries: giveawayData.totalEntries,
                                pendingWinners: giveawayData.pendingWinners,
                                winners: giveawayData.winners,
                                styles: giveawayData.giveawayData.styles,
                                display: giveawayData.giveawayData.display,
                                paused: giveawayData.paused,
                                ended: giveawayData.ended,
                                position: giveawayData.position,
                                customCoords: giveawayData.customCoords,
                                enableClaimTimer: giveawayData.enableClaimTimer,
                                claimMode: giveawayData.claimMode,
                                claimDuration: giveawayData.claimDuration,
                                entriesClosed: giveawayData.entriesClosed,
                                closeTime: giveawayData.closeTime
                            }
                        });
                        break;
                    }

                    case 'updateDisplay': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        if (event.effect.giveawaySelectionMode === 'manual' && event.effect.setting) {
                            switch (event.effect.setting.type) {
                                case 'showEntryCount':
                                    giveawayData.giveawayData.display.showEntryCount = Boolean(event.effect.setting.value);
                                    break;
                                case 'showEntryCommand':
                                    giveawayData.giveawayData.display.showEntryCommand = Boolean(event.effect.setting.value);
                                    break;
                                case 'showWinner':
                                    giveawayData.giveawayData.display.showWinner = Boolean(event.effect.setting.value);
                                    break;
                                case 'showClaimCommand':
                                    giveawayData.giveawayData.display.showClaimCommand = Boolean(event.effect.setting.value);
                                    break;
                                case 'showTimer':
                                    giveawayData.giveawayData.display.showTimer = Boolean(event.effect.setting.value);
                                    break;
                                case 'showCloseTimer':
                                    giveawayData.giveawayData.display.showCloseTimer = Boolean(event.effect.setting.value);
                                    break;
                                case 'animateWinner':
                                    giveawayData.giveawayData.display.animateWinner = Boolean(event.effect.setting.value);
                                    break;
                                case 'oddsMode':
                                    giveawayData.giveawayData.display.oddsMode = (event.effect.setting.value as 'both' | 'ratio' | 'percent' | 'disabled' | undefined) || 'both';
                                    break;
                                case 'showOdds':
                                    giveawayData.giveawayData.display.showOdds = Boolean(event.effect.setting.value);
                                    break;
                                case 'showOddsPercentage':
                                    giveawayData.giveawayData.display.showOddsPercentage = Boolean(event.effect.setting.value);
                                    break;
                                case 'showOddsRatio':
                                    giveawayData.giveawayData.display.showOddsRatio = Boolean(event.effect.setting.value);
                                    break;
                                case 'rotateWinners':
                                    giveawayData.giveawayData.display.rotateWinners = Boolean(event.effect.setting.value);
                                    break;
                                case 'tickerIntervalSeconds':
                                    giveawayData.giveawayData.display.tickerIntervalSeconds = Math.max(1, Number(event.effect.setting.value) || 2);
                                    break;
                                case 'commandCycleIntervalSeconds':
                                    giveawayData.giveawayData.display.commandCycleIntervalSeconds = Math.max(1, Number(event.effect.setting.value) || 3);
                                    break;
                                case 'closeTimerUrgentSeconds':
                                    giveawayData.giveawayData.display.closeTimerUrgentSeconds = Math.max(1, Number(event.effect.setting.value) || 30);
                                    break;
                                case 'claimTimerUrgentSeconds':
                                    giveawayData.giveawayData.display.claimTimerUrgentSeconds = Math.max(1, Number(event.effect.setting.value) || 10);
                                    break;
                                case 'minimalMode':
                                    giveawayData.giveawayData.display.minimalMode = Boolean(event.effect.setting.value);
                                    break;
                                case 'imageOnlyMode':
                                    giveawayData.giveawayData.display.imageOnlyMode = Boolean(event.effect.setting.value);
                                    break;
                                case 'pendingWinnerRotationSeconds':
                                    giveawayData.giveawayData.display.pendingWinnerRotationSeconds = Number(event.effect.setting.value) || 5;
                                    break;
                                case 'cycleIntervalSeconds':
                                    giveawayData.giveawayData.display.cycleIntervalSeconds = Math.max(1, Number(event.effect.setting.value) || 6);
                                    break;
                                case 'displayMode':
                                    giveawayData.giveawayData.display.displayMode = String(event.effect.setting.value || 'widgetImage') as any;
                                    normalizeDisplayModes(giveawayData.giveawayData.display);
                                    break;
                                case 'widgetMode':
                                    giveawayData.giveawayData.display.widgetMode = String(event.effect.setting.value || 'full') as any;
                                    normalizeDisplayModes(giveawayData.giveawayData.display);
                                    break;
                                case 'slideMode': {
                                    const mode = (String(event.effect.setting.value || 'disabled') as SlideMode);
                                    applySlideMode(giveawayData.giveawayData.display, mode);
                                    break;
                                }
                                case 'slideRevealIntervalSeconds':
                                    giveawayData.giveawayData.display.slideRevealIntervalSeconds = Math.max(1, Number(event.effect.setting.value) || 8);
                                    break;
                                case 'slideVisibleSeconds':
                                    giveawayData.giveawayData.display.slideVisibleSeconds = Math.max(1, Number(event.effect.setting.value) || 4);
                                    break;
                                case 'entryCommand':
                                    giveawayData.giveawayData.entryCommand = String(event.effect.setting.value);
                                    break;
                                case 'claimCommand':
                                    giveawayData.giveawayData.claimCommand = String(event.effect.setting.value);
                                    break;
                                case 'allowMultipleEntries':
                                    giveawayData.allowMultipleEntries = Boolean(event.effect.setting.value);
                                    break;
                                case 'maxEntriesPerUser':
                                    giveawayData.maxEntriesPerUser = Math.max(1, Number(event.effect.setting.value) || 1);
                                    break;
                                case 'autoClose':
                                    giveawayData.autoClose = Boolean(event.effect.setting.value);
                                    break;
                                case 'duration':
                                    giveawayData.duration = Math.max(0, Number(event.effect.setting.value) || 0);
                                    break;
                                case 'requireClaim':
                                    normalizeClaimMode(giveawayData, event.effect.setting.value ? 'enabled' : 'disabled');
                                    break;
                                case 'claimMode':
                                    normalizeClaimMode(giveawayData, event.effect.setting.value as any);
                                    break;
                                case 'category':
                                    giveawayData.giveawayData.category = String(event.effect.setting.value || '');
                                    break;
                                case 'autoRerollOnExpire':
                                    giveawayData.autoRerollOnExpire = Boolean(event.effect.setting.value);
                                    break;
                                case 'requeueExpired':
                                    giveawayData.requeueExpired = Boolean(event.effect.setting.value);
                                    break;
                                case 'requeueDenied':
                                    giveawayData.requeueDenied = Boolean(event.effect.setting.value);
                                    break;
                                case 'retentionDays':
                                    giveawayData.retentionDays = Number(event.effect.setting.value) || 7;
                                    break;
                                case 'displayDuration':
                                    giveawayData.displayDuration = Math.max(0, Number(event.effect.setting.value) || giveawayData.displayDuration || 0);
                                    break;
                                case 'autoRemoveAfterClose':
                                    giveawayData.autoRemoveAfterClose = Boolean(event.effect.setting.value);
                                    break;
                                case 'claimDuration': {
                                    const seconds = Number(event.effect.setting.value);
                                    if (!isNaN(seconds) && seconds >= 0 && normalizeClaimMode(giveawayData) === 'timer') {
                                        giveawayData.claimDuration = seconds;
                                    }
                                    break;
                                }
                                case 'enableClaimTimer':
                                    normalizeClaimMode(giveawayData, event.effect.setting.value ? 'timer' : 'enabled');
                                    break;
                                case 'autoCloseSeconds': {
                                    const seconds = Number(event.effect.setting.value);
                                    if (!isNaN(seconds) && seconds > 0) {
                                        giveawayData.closeTime = new Date(Date.now() + seconds * 1000).toISOString();
                                        giveawayData.duration = seconds;
                                        giveawayData.autoClose = true;
                                    }
                                    break;
                                }
                                case 'clearCloseTime': {
                                    if (event.effect.setting.value) {
                                        giveawayData.closeTime = undefined;
                                        giveawayData.duration = 0;
                                        giveawayData.autoClose = false;
                                    }
                                    break;
                                }
                                case 'giveawayScale':
                                    giveawayData.giveawayData.styles.giveawayScale = Number(event.effect.setting.value) || 1;
                                    break;
                                case 'imageScale':
                                    giveawayData.giveawayData.styles.imageScale = Number(event.effect.setting.value) || 1;
                                    break;
                                case 'imageMode':
                                    giveawayData.giveawayData.styles.imageMode = String(event.effect.styles?.imageMode || event.effect.setting.value) as any;

                                    if (giveawayData.giveawayData.styles.imageMode === 'url' && event.effect.styles?.imageUrl) {
                                        giveawayData.giveawayData.styles.imageUrl = String(event.effect.styles.imageUrl);
                                    }

                                    if (giveawayData.giveawayData.styles.imageMode === 'local' && event.effect.styles?.imageFile) {
                                        giveawayData.giveawayData.styles.imageFile = String(event.effect.styles.imageFile);
                                    }
                                    break;
                                case 'imagePlacement':
                                    giveawayData.giveawayData.styles.imagePlacement = String(event.effect.setting.value) as any;
                                    break;
                                case 'imageOverlay':
                                    giveawayData.giveawayData.styles.imageOverlay = Boolean(event.effect.setting.value);
                                    break;
                                case 'imageTextSize':
                                    giveawayData.giveawayData.display.imageTextSize = Number(event.effect.setting.value) || 18;
                                    break;
                                case 'imageTextPosition': {
                                    const positionValue = String(event.effect.setting.value || 'bottom');
                                    const validPositions = ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'center-left', 'center-right'] as const;
                                    giveawayData.giveawayData.display.imageTextPosition = validPositions.includes(positionValue as any)
                                        ? positionValue as typeof validPositions[number]
                                        : 'bottom';
                                    break;
                                }
                                case 'showImageText':
                                    giveawayData.giveawayData.display.showImageText = Boolean(event.effect.setting.value);
                                    break;
                            }
                            normalizeSlideMode(giveawayData.giveawayData.display);
                        } else {
                            giveawayData.giveawayData.display = {
                                showEntryCount: event.effect.display?.showEntryCount ?? true,
                                showEntryCommand: event.effect.display?.showEntryCommand ?? true,
                                showWinner: event.effect.display?.showWinner ?? true,
                                showClaimCommand: event.effect.display?.showClaimCommand ?? true,
                                showTimer: event.effect.display?.showTimer ?? true,
                                showCloseTimer: event.effect.display?.showCloseTimer ?? true,
                                animateWinner: event.effect.display?.animateWinner ?? true,
                                rotateWinners: event.effect.display?.rotateWinners ?? false,
                                minimalMode: event.effect.display?.minimalMode ?? false,
                                imageOnlyMode: event.effect.display?.imageOnlyMode ?? false,
                                cycleIntervalSeconds: event.effect.display?.cycleIntervalSeconds ?? 6,
                                pendingWinnerRotationSeconds: event.effect.display?.pendingWinnerRotationSeconds ?? 5,
                                tickerIntervalSeconds: event.effect.display?.tickerIntervalSeconds ?? 2,
                                commandCycleIntervalSeconds: event.effect.display?.commandCycleIntervalSeconds ?? 3,
                                closeTimerUrgentSeconds: event.effect.display?.closeTimerUrgentSeconds ?? 30,
                                claimTimerUrgentSeconds: event.effect.display?.claimTimerUrgentSeconds ?? 10,
                                oddsMode: event.effect.display?.oddsMode ?? 'both',
                                showOdds: event.effect.display?.showOdds ?? true,
                                showOddsPercentage: event.effect.display?.showOddsPercentage ?? true,
                                showOddsRatio: event.effect.display?.showOddsRatio ?? true,
                                displayMode: event.effect.display?.displayMode || 'widgetImage',
                                widgetMode: event.effect.display?.widgetMode || 'full',
                                slideMode: resolveSlideMode(event.effect.display),
                                slideRevealIntervalSeconds: event.effect.display?.slideRevealIntervalSeconds ?? 8,
                                slideVisibleSeconds: event.effect.display?.slideVisibleSeconds ?? 4,
                                prizeLabelText: event.effect.display?.prizeLabelText ?? 'PRIZE',
                                statLabelText: event.effect.display?.statLabelText ?? 'ENTRIES',
                                entriesClosedText: event.effect.display?.entriesClosedText ?? 'Entries closed',
                                entryCommandText: event.effect.display?.entryCommandText ?? 'Type {command} to join!',
                                closeTimerText: event.effect.display?.closeTimerText ?? 'Time left: {time}',
                                claimCommandText: event.effect.display?.claimCommandText ?? 'Type {command} to claim your prize!',
                                winnerPendingText: event.effect.display?.winnerPendingText ?? 'Winner pending',
                                oddsText: event.effect.display?.oddsText ?? 'Win odds: {percent}{ratio}',
                                imageTextTemplate: event.effect.display?.imageTextTemplate ?? '{title} - {prize}',
                                imageTextPosition: event.effect.display?.imageTextPosition ?? 'bottom',
                                imageTextSize: event.effect.display?.imageTextSize ?? 18,
                                showImageText: event.effect.display?.showImageText ?? false
                            };
                            normalizeSlideMode(giveawayData.giveawayData.display);
                            normalizeDisplayModes(giveawayData.giveawayData.display);
                            giveawayData.giveawayData.entryCommand = event.effect.giveawayOptions?.entryCommand ?? '!enter';
                            giveawayData.giveawayData.claimCommand = event.effect.giveawayOptions?.claimCommand ?? '!claim';
                            giveawayData.giveawayData.category = event.effect.giveawayOptions?.category ?? event.effect.category ?? giveawayData.giveawayData.category ?? '';
                            const claimMode = normalizeClaimMode(event.effect.giveawayOptions ?? giveawayData);
                            normalizeClaimMode(giveawayData, claimMode);
                            giveawayData.giveawayData.prizeLabelText = event.effect.display?.prizeLabelText ?? giveawayData.giveawayData.prizeLabelText ?? 'PRIZE';
                            giveawayData.giveawayData.statLabelText = event.effect.display?.statLabelText ?? giveawayData.giveawayData.statLabelText ?? 'ENTRIES';
                            giveawayData.giveawayData.entriesClosedText = event.effect.display?.entriesClosedText ?? giveawayData.giveawayData.entriesClosedText ?? 'Entries closed';
                            giveawayData.giveawayData.display.entryCommandText = event.effect.display?.entryCommandText ?? giveawayData.giveawayData.display.entryCommandText ?? 'Type {command} to join!';
                            giveawayData.giveawayData.display.closeTimerText = event.effect.display?.closeTimerText ?? giveawayData.giveawayData.display.closeTimerText ?? 'Time left: {time}';
                            giveawayData.giveawayData.display.claimCommandText = event.effect.display?.claimCommandText ?? giveawayData.giveawayData.display.claimCommandText ?? 'Type {command} to claim your prize!';
                            giveawayData.giveawayData.display.winnerPendingText = event.effect.display?.winnerPendingText ?? giveawayData.giveawayData.display.winnerPendingText ?? 'Winner pending';
                            giveawayData.giveawayData.display.oddsText = event.effect.display?.oddsText ?? giveawayData.giveawayData.display.oddsText ?? 'Win odds: {percent}{ratio}';
                            giveawayData.giveawayData.display.imageTextTemplate = event.effect.display?.imageTextTemplate ?? giveawayData.giveawayData.display.imageTextTemplate ?? '{title} - {prize}';
                            giveawayData.giveawayData.display.imageTextPosition = event.effect.display?.imageTextPosition ?? giveawayData.giveawayData.display.imageTextPosition ?? 'bottom';
                            giveawayData.giveawayData.display.imageTextSize = event.effect.display?.imageTextSize ?? giveawayData.giveawayData.display.imageTextSize ?? 18;
                            giveawayData.giveawayData.display.showImageText = event.effect.display?.showImageText ?? giveawayData.giveawayData.display.showImageText ?? false;
                            giveawayData.giveawayData.display.oddsMode = event.effect.display?.oddsMode ?? giveawayData.giveawayData.display.oddsMode ?? 'both';
                            giveawayData.giveawayData.display.showOdds = event.effect.display?.showOdds ?? giveawayData.giveawayData.display.showOdds ?? true;
                            giveawayData.giveawayData.display.showOddsPercentage = event.effect.display?.showOddsPercentage ?? giveawayData.giveawayData.display.showOddsPercentage ?? true;
                            giveawayData.giveawayData.display.showOddsRatio = event.effect.display?.showOddsRatio ?? giveawayData.giveawayData.display.showOddsRatio ?? true;
                            giveawayData.giveawayData.display.showOdds = event.effect.display?.showOdds ?? giveawayData.giveawayData.display.showOdds ?? true;
                            giveawayData.giveawayData.display.showOddsPercentage = event.effect.display?.showOddsPercentage ?? giveawayData.giveawayData.display.showOddsPercentage ?? true;
                            giveawayData.giveawayData.display.showOddsRatio = event.effect.display?.showOddsRatio ?? giveawayData.giveawayData.display.showOddsRatio ?? true;

                            const targetStyles = giveawayData.giveawayData.styles || {};
                            const incomingStyles = event.effect.styles || {};
                            giveawayData.giveawayData.styles = targetStyles;

                            const defaultStyles = {
                                imageTextColor: "#e3e3e3",
                                imageTextPlaceholderColor: "#ffcc00",
                                entryCommandColor: "",
                                closeTimerColor: "",
                                closeTimerTextColor: "",
                                closeTimerValueColor: "",
                                closeTimerUrgentColor: "#ff4444",
                                claimCommandColor: "",
                                winnerPendingColor: "",
                                entriesClosedColor: "#ffcc00",
                                prizeLabelColor: "#e3e3e3",
                                statLabelColor: "#e3e3e3",
                                prizeColor: "#e3e3e3",
                                oddsColor: "",
                                entryTextColor: "",
                                claimTextColor: "",
                                claimTimerColor: "",
                                claimTimerTextColor: "",
                                claimTimerValueColor: "",
                                claimTimerUrgentColor: "#ff4444",
                                entryNumberColor: "",
                                statusClosedColor: "",
                                statusPausedColor: "",
                                statusEndedColor: "",
                                statusLabelColor: ""
                            };

                            if (event.effect.styles) {
                                targetStyles.imageTextColor = incomingStyles.imageTextColor ?? targetStyles.imageTextColor ?? defaultStyles.imageTextColor;
                                targetStyles.imageTextPlaceholderColor = incomingStyles.imageTextPlaceholderColor ?? targetStyles.imageTextPlaceholderColor ?? defaultStyles.imageTextPlaceholderColor;
                                targetStyles.entryCommandColor = incomingStyles.entryCommandColor ?? targetStyles.entryCommandColor ?? defaultStyles.entryCommandColor;
                                targetStyles.entryTextColor = incomingStyles.entryTextColor ?? targetStyles.entryTextColor ?? defaultStyles.entryTextColor;
                                targetStyles.entryNumberColor = incomingStyles.entryNumberColor ?? targetStyles.entryNumberColor ?? defaultStyles.entryNumberColor;
                                targetStyles.closeTimerTextColor = incomingStyles.closeTimerTextColor ?? targetStyles.closeTimerTextColor ?? defaultStyles.closeTimerTextColor;
                                targetStyles.closeTimerValueColor = incomingStyles.closeTimerValueColor ?? targetStyles.closeTimerValueColor ?? defaultStyles.closeTimerValueColor;
                                targetStyles.closeTimerUrgentColor = incomingStyles.closeTimerUrgentColor ?? targetStyles.closeTimerUrgentColor ?? defaultStyles.closeTimerUrgentColor;
                                targetStyles.claimCommandColor = incomingStyles.claimCommandColor ?? targetStyles.claimCommandColor ?? defaultStyles.claimCommandColor;
                                targetStyles.claimTextColor = incomingStyles.claimTextColor ?? targetStyles.claimTextColor ?? defaultStyles.claimTextColor;
                                targetStyles.claimTimerColor = incomingStyles.claimTimerColor ?? targetStyles.claimTimerColor ?? defaultStyles.claimTimerColor;
                                targetStyles.claimTimerTextColor = incomingStyles.claimTimerTextColor ?? targetStyles.claimTimerTextColor ?? defaultStyles.claimTimerTextColor;
                                targetStyles.claimTimerValueColor = incomingStyles.claimTimerValueColor ?? targetStyles.claimTimerValueColor ?? defaultStyles.claimTimerValueColor;
                                targetStyles.claimTimerUrgentColor = incomingStyles.claimTimerUrgentColor ?? targetStyles.claimTimerUrgentColor ?? defaultStyles.claimTimerUrgentColor;
                                targetStyles.winnerPendingColor = incomingStyles.winnerPendingColor ?? targetStyles.winnerPendingColor ?? defaultStyles.winnerPendingColor;
                                targetStyles.statusClosedColor = incomingStyles.statusClosedColor ?? targetStyles.statusClosedColor ?? defaultStyles.statusClosedColor;
                                targetStyles.statusPausedColor = incomingStyles.statusPausedColor ?? targetStyles.statusPausedColor ?? defaultStyles.statusPausedColor;
                                targetStyles.statusEndedColor = incomingStyles.statusEndedColor ?? targetStyles.statusEndedColor ?? defaultStyles.statusEndedColor;
                                targetStyles.statusLabelColor = incomingStyles.statusLabelColor ?? targetStyles.statusLabelColor ?? defaultStyles.statusLabelColor;
                                targetStyles.entriesClosedColor = incomingStyles.entriesClosedColor ?? targetStyles.entriesClosedColor ?? defaultStyles.entriesClosedColor;
                                targetStyles.prizeLabelColor = incomingStyles.prizeLabelColor ?? targetStyles.prizeLabelColor ?? defaultStyles.prizeLabelColor;
                                targetStyles.statLabelColor = incomingStyles.statLabelColor ?? targetStyles.statLabelColor ?? defaultStyles.statLabelColor;
                                targetStyles.prizeColor = incomingStyles.prizeColor ?? targetStyles.prizeColor ?? defaultStyles.prizeColor;
                            }

                            if (incomingStyles.giveawayScale !== undefined) {
                                targetStyles.giveawayScale = Number(incomingStyles.giveawayScale) || 1;
                            }
                            if (incomingStyles.imageScale !== undefined) {
                                targetStyles.imageScale = Number(incomingStyles.imageScale) || 1;
                            }
                            if (incomingStyles.imageMode !== undefined) {
                                targetStyles.imageMode = String(incomingStyles.imageMode) as any;
                            }
                            if (incomingStyles.imageUrl !== undefined) {
                                targetStyles.imageUrl = String(incomingStyles.imageUrl);
                                if (targetStyles.imageMode !== 'local') {
                                    targetStyles.imageMode = 'url';
                                }
                            }
                            if (incomingStyles.imageFile !== undefined) {
                                targetStyles.imageFile = String(incomingStyles.imageFile);
                                targetStyles.imageMode = 'local';
                            }
                            if (incomingStyles.imagePlacement !== undefined) {
                                targetStyles.imagePlacement = String(incomingStyles.imagePlacement) as any;
                            }
                            if (incomingStyles.imageOverlay !== undefined) {
                                targetStyles.imageOverlay = Boolean(incomingStyles.imageOverlay);
                            }
                            if (incomingStyles.showImage !== undefined) {
                                targetStyles.showImage = Boolean(incomingStyles.showImage);
                            }

                            const displayMode = giveawayData.giveawayData.display.displayMode;
                            const placementValue: string = (targetStyles.imagePlacement as string | undefined) || '';
                            if (displayMode === 'widgetOnly') {
                                targetStyles.imagePlacement = 'none';
                                targetStyles.showImage = false;
                            } else {
                                let resolvedPlacement = placementValue || 'above';
                                if (resolvedPlacement === 'none') {
                                    resolvedPlacement = 'above';
                                }
                                if (displayMode === 'imageOnly') {
                                    resolvedPlacement = 'above';
                                }
                                targetStyles.imagePlacement = resolvedPlacement as any;
                                targetStyles.showImage = resolvedPlacement !== 'none';
                            }

                            giveawayData.giveawayData.styles = prepareStylesForOverlay(targetStyles, giveawayData.retentionDays);
                            if (event.effect.giveawayOptions?.autoRerollOnExpire !== undefined) {
                                giveawayData.autoRerollOnExpire = Boolean(event.effect.giveawayOptions.autoRerollOnExpire);
                            }
                            if (event.effect.giveawayOptions?.retentionDays !== undefined) {
                                giveawayData.retentionDays = Number(event.effect.giveawayOptions.retentionDays) || giveawayData.retentionDays || 7;
                            }
                            if (event.effect.giveawayOptions?.requeueExpired !== undefined) {
                                giveawayData.requeueExpired = Boolean(event.effect.giveawayOptions.requeueExpired);
                            }
                            if (event.effect.giveawayOptions?.requeueDenied !== undefined) {
                                giveawayData.requeueDenied = Boolean(event.effect.giveawayOptions.requeueDenied);
                            }
                            if (event.effect.giveawayOptions?.allowMultipleEntries !== undefined) {
                                giveawayData.allowMultipleEntries = Boolean(event.effect.giveawayOptions.allowMultipleEntries);
                            }
                            if (event.effect.giveawayOptions?.maxEntriesPerUser !== undefined) {
                                giveawayData.maxEntriesPerUser = Math.max(1, Number(event.effect.giveawayOptions.maxEntriesPerUser) || giveawayData.maxEntriesPerUser || 1);
                            }
                            if (event.effect.giveawayOptions?.displayDuration !== undefined) {
                                giveawayData.displayDuration = Math.max(0, Number(event.effect.giveawayOptions.displayDuration) || giveawayData.displayDuration || 0);
                            }
                            if (event.effect.giveawayOptions?.autoRemoveAfterClose !== undefined) {
                                giveawayData.autoRemoveAfterClose = event.effect.giveawayOptions.autoRemoveAfterClose !== false;
                            }
                            if (event.effect.giveawayOptions?.claimDuration !== undefined && claimMode === 'timer') {
                                giveawayData.claimDuration = Math.max(0, Number(event.effect.giveawayOptions.claimDuration) || giveawayData.claimDuration || 0);
                            }
                            if (event.effect.clearCloseTime) {
                                giveawayData.closeTime = undefined;
                                giveawayData.duration = 0;
                                giveawayData.autoClose = false;
                            }
                            if (event.effect.closeTimeSeconds !== undefined && event.effect.closeTimeSeconds !== null) {
                                const seconds = Number(event.effect.closeTimeSeconds);
                                if (!isNaN(seconds) && seconds > 0) {
                                    giveawayData.closeTime = new Date(Date.now() + seconds * 1000).toISOString();
                                    giveawayData.duration = seconds;
                                    giveawayData.autoClose = true;
                                }
                            }
                            if (event.effect.display?.imageTextTemplate !== undefined) {
                                giveawayData.giveawayData.display.imageTextTemplate = event.effect.display.imageTextTemplate;
                            }
                            if (event.effect.display?.imageTextPosition !== undefined) {
                                giveawayData.giveawayData.display.imageTextPosition = event.effect.display.imageTextPosition;
                            }
                            if (event.effect.display?.imageTextSize !== undefined) {
                                giveawayData.giveawayData.display.imageTextSize = event.effect.display.imageTextSize;
                            }
                            if (event.effect.display?.showImageText !== undefined) {
                                giveawayData.giveawayData.display.showImageText = event.effect.display.showImageText;
                            }
                        }

                        await giveawayManager.updateGiveaway(giveawayId, giveawayData);

                        await webServer.sendToOverlay("giveaway-updater", {
                            type: 'update',
                            overlayInstance: giveawayData.overlayInstance,
                            config: {
                                giveawayTitle: giveawayId.replace('giveaway_', ''),
                                giveawayData: giveawayData.giveawayData,
                                entries: giveawayData.entries,
                                totalEntries: giveawayData.totalEntries,
                                pendingWinners: giveawayData.pendingWinners,
                                winners: giveawayData.winners,
                                styles: giveawayData.giveawayData.styles,
                                display: giveawayData.giveawayData.display,
                                paused: giveawayData.paused,
                                pausedCloseRemainingSeconds: giveawayData.pausedCloseRemainingSeconds,
                                pausedClaimRemaining: giveawayData.pausedClaimRemaining,
                                ended: giveawayData.ended,
                                position: giveawayData.position,
                                customCoords: giveawayData.customCoords,
                                enableClaimTimer: giveawayData.enableClaimTimer,
                                claimMode: giveawayData.claimMode,
                                claimDuration: giveawayData.claimDuration,
                                entriesClosed: giveawayData.entriesClosed,
                                closeTime: giveawayData.closeTime
                            }
                        });
                        break;
                    }

                    case 'updateText': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        giveawayData.giveawayData.display = giveawayData.giveawayData.display || {};

                        if (event.effect.giveawaySelectionMode === 'manual' && event.effect.setting) {
                            switch (event.effect.setting.type) {
                                case 'entriesClosedText':
                                    giveawayData.giveawayData.entriesClosedText = String(event.effect.setting.value || 'Entries closed');
                                    break;
                                case 'prizeLabelText':
                                    giveawayData.giveawayData.prizeLabelText = String(event.effect.setting.value || 'PRIZE');
                                    break;
                                case 'statLabelText':
                                    giveawayData.giveawayData.statLabelText = String(event.effect.setting.value || 'ENTRIES');
                                    break;
                                case 'entryCommandText':
                                    giveawayData.giveawayData.display.entryCommandText = String(event.effect.setting.value || 'Type {command} to join!');
                                    break;
                                case 'closeTimerText':
                                    giveawayData.giveawayData.display.closeTimerText = String(event.effect.setting.value || 'Time left: {time}');
                                    break;
                                case 'claimCommandText':
                                    giveawayData.giveawayData.display.claimCommandText = String(event.effect.setting.value || 'Type {command} to claim your prize!');
                                    break;
                                case 'winnerPendingText':
                                    giveawayData.giveawayData.display.winnerPendingText = String(event.effect.setting.value || 'Winner pending');
                                    break;
                                case 'imageTextTemplate':
                                    giveawayData.giveawayData.display.imageTextTemplate = String(event.effect.setting.value || '{title} - {prize}');
                                    break;
                            }
                        } else {
                            giveawayData.giveawayData.entriesClosedText = event.effect.display?.entriesClosedText ?? giveawayData.giveawayData.entriesClosedText ?? 'Entries closed';
                            giveawayData.giveawayData.prizeLabelText = event.effect.display?.prizeLabelText ?? giveawayData.giveawayData.prizeLabelText ?? 'PRIZE';
                            giveawayData.giveawayData.statLabelText = event.effect.display?.statLabelText ?? giveawayData.giveawayData.statLabelText ?? 'ENTRIES';
                            giveawayData.giveawayData.display.entryCommandText = event.effect.display?.entryCommandText ?? giveawayData.giveawayData.display.entryCommandText ?? 'Type {command} to join!';
                            giveawayData.giveawayData.display.closeTimerText = event.effect.display?.closeTimerText ?? giveawayData.giveawayData.display.closeTimerText ?? 'Time left: {time}';
                            giveawayData.giveawayData.display.claimCommandText = event.effect.display?.claimCommandText ?? giveawayData.giveawayData.display.claimCommandText ?? 'Type {command} to claim your prize!';
                            giveawayData.giveawayData.display.winnerPendingText = event.effect.display?.winnerPendingText ?? giveawayData.giveawayData.display.winnerPendingText ?? 'Winner pending';
                            giveawayData.giveawayData.display.imageTextTemplate = event.effect.display?.imageTextTemplate ?? giveawayData.giveawayData.display.imageTextTemplate ?? '{title} - {prize}';
                            giveawayData.giveawayData.display.imageTextSize = event.effect.display?.imageTextSize ?? giveawayData.giveawayData.display.imageTextSize ?? 18;
                            giveawayData.giveawayData.display.imageTextPosition = event.effect.display?.imageTextPosition ?? giveawayData.giveawayData.display.imageTextPosition ?? 'bottom';
                        }

                        await giveawayManager.updateGiveaway(giveawayId, giveawayData);

                        await webServer.sendToOverlay("giveaway-updater", {
                            type: 'update',
                            overlayInstance: giveawayData.overlayInstance,
                            config: {
                                giveawayTitle: giveawayId.replace('giveaway_', ''),
                                giveawayData: giveawayData.giveawayData,
                                entries: giveawayData.entries,
                                totalEntries: giveawayData.totalEntries,
                                pendingWinners: giveawayData.pendingWinners,
                                winners: giveawayData.winners,
                                styles: giveawayData.giveawayData.styles,
                                display: giveawayData.giveawayData.display,
                                paused: giveawayData.paused,
                                pausedCloseRemainingSeconds: giveawayData.pausedCloseRemainingSeconds,
                                pausedClaimRemaining: giveawayData.pausedClaimRemaining,
                                ended: giveawayData.ended,
                                position: giveawayData.position,
                                customCoords: giveawayData.customCoords,
                                enableClaimTimer: giveawayData.enableClaimTimer,
                                claimMode: giveawayData.claimMode,
                                claimDuration: giveawayData.claimDuration,
                                entriesClosed: giveawayData.entriesClosed,
                                closeTime: giveawayData.closeTime
                            }
                        });
                        break;
                    }

                    case 'updatePosition': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        if (event.effect.position) {
                            let newPosition = event.effect.position;

                            if (newPosition === 'Random') {
                                const presetPositions = [
                                    'Top Left', 'Top Middle', 'Top Right',
                                    'Middle Left', 'Middle', 'Middle Right',
                                    'Bottom Left', 'Bottom Middle', 'Bottom Right'
                                ];
                                newPosition = presetPositions[Math.floor(Math.random() * presetPositions.length)];
                            }

                            giveawayData.position = newPosition;
                        }

                        if (event.effect.customCoords) {
                            giveawayData.customCoords = event.effect.customCoords;
                        }

                        await giveawayManager.updateGiveaway(giveawayId, giveawayData);

                        await webServer.sendToOverlay("giveaway-updater", {
                            type: 'update',
                            overlayInstance: giveawayData.overlayInstance,
                            config: {
                                giveawayTitle: giveawayId.replace('giveaway_', ''),
                                giveawayData: giveawayData.giveawayData,
                                entries: giveawayData.entries,
                                totalEntries: giveawayData.totalEntries,
                                pendingWinners: giveawayData.pendingWinners,
                                winners: giveawayData.winners,
                                styles: giveawayData.giveawayData.styles,
                                display: giveawayData.giveawayData.display,
                                position: giveawayData.position,
                                customCoords: giveawayData.customCoords,
                                enableClaimTimer: giveawayData.enableClaimTimer,
                                claimMode: giveawayData.claimMode,
                                claimDuration: giveawayData.claimDuration,
                                entriesClosed: giveawayData.entriesClosed,
                                closeTime: giveawayData.closeTime
                            }
                        });

                        frontendCommunicator.send('giveawayDataChanged', giveawayId);
                        break;
                    }

                    case 'giveawayStatusControl': {
                        if (!giveawayData) throw new Error('Giveaway not found');
                        const action = (event.effect.statusAction || 'stop') as string;
                        const normalizedAction = ['stop', 'restart', 'reset', 'remove', 'pause', 'resume', 'closeEntries', 'openEntries'].includes(action)
                            ? action
                            : 'stop';

                        switch (normalizedAction) {
                            case 'stop': {
                                await giveawayManager.stopGiveaway(giveawayId, 'manual', modules.eventManager);
                                break;
                            }
                            case 'restart': {
                                giveawayManager.cancelRemoveOverlay(giveawayId);
                                const updated = await giveawayManager.getGiveaway(giveawayId);
                                if (!updated) throw new Error('Giveaway not found');
                                updated.ended = false;
                                updated.entriesClosed = false;
                                updated.entriesClosedAt = undefined;
                                updated.paused = false;
                                updated.pausedCloseRemainingSeconds = undefined;
                                updated.pausedClaimRemaining = undefined;
                                updated.closeTime = undefined;
                                updated.pendingWinners = [];
                                updated.winners = [];
                                await giveawayManager.updateGiveaway(giveawayId, updated);
                                break;
                            }
                            case 'reset': {
                                await giveawayManager.resetEntriesAndWinners(giveawayId);
                                break;
                            }
                            case 'remove': {
                                await giveawayManager.backupGiveaway(giveawayId);
                                await webServer.sendToOverlay("giveaway-updater", {
                                    type: 'remove',
                                    overlayInstance: giveawayData.overlayInstance || '',
                                    config: {
                                        giveawayTitle: giveawayId.replace('giveaway_', '')
                                    }
                                });
                                frontendCommunicator.send("giveawayRemoved", giveawayId);
                                break;
                            }
                            case 'pause': {
                                await giveawayManager.pauseGiveaway(giveawayId);
                                break;
                            }
                            case 'resume': {
                                await giveawayManager.unpauseGiveaway(giveawayId, modules.eventManager);
                                break;
                            }
                            case 'closeEntries': {
                                await giveawayManager.closeEntries(giveawayId);
                                break;
                            }
                            case 'openEntries': {
                                await giveawayManager.openEntries(giveawayId);
                                break;
                            }
                        }

                        const refreshed = await giveawayManager.getGiveaway(giveawayId);
                        const skipOverlayUpdate = normalizedAction === 'reset'
                            || normalizedAction === 'closeEntries'
                            || normalizedAction === 'openEntries';

                        if (!skipOverlayUpdate && refreshed) {
                            const serverTimestamp = Date.now();
                            const computeRemainingSeconds = (timestamp?: string | null) => {
                                if (!timestamp) return null;
                                const ms = new Date(timestamp).getTime();
                                if (!Number.isFinite(ms)) return null;
                                const remaining = Math.max(0, Math.floor((ms - serverTimestamp) / 1000));
                                return remaining > 0 ? remaining : null;
                            };

                            const pendingWinners = (refreshed.pendingWinners || []).map(winner => ({
                                ...winner,
                                claimRemainingSeconds: computeRemainingSeconds(winner.claimDeadline)
                            }));

                            const closeRemainingSeconds = computeRemainingSeconds(refreshed.closeTime);

                            await webServer.sendToOverlay("giveaway-updater", {
                                type: normalizedAction === 'remove' ? 'remove' : 'update',
                                overlayInstance: refreshed.overlayInstance,
                                config: {
                                    giveawayTitle: giveawayId.replace('giveaway_', ''),
                                    giveawayData: refreshed.giveawayData,
                                    entries: refreshed.entries,
                                    totalEntries: refreshed.totalEntries,
                                    pendingWinners: pendingWinners,
                                    winners: refreshed.winners,
                                    styles: refreshed.giveawayData.styles,
                                    display: refreshed.giveawayData.display,
                                    enableClaimTimer: refreshed.enableClaimTimer,
                                    claimMode: refreshed.claimMode,
                                    claimDuration: refreshed.claimDuration,
                                    paused: refreshed.paused,
                                    pausedCloseRemainingSeconds: refreshed.pausedCloseRemainingSeconds,
                                    pausedClaimRemaining: refreshed.pausedClaimRemaining,
                                    ended: refreshed.ended,
                                    entriesClosed: refreshed.entriesClosed,
                                    position: refreshed.position,
                                    customCoords: refreshed.customCoords,
                                    closeTime: refreshed.closeTime,
                                    closeRemainingSeconds,
                                    serverTimestamp
                                }
                            });
                        }

                        frontendCommunicator.send("giveawayDataChanged", giveawayId);
                        if (normalizedAction === 'stop') {
                            frontendCommunicator.send("giveawayEnded", giveawayId);
                        } else if (normalizedAction === 'restart') {
                            frontendCommunicator.send("giveawayStarted", giveawayId);
                        }
                        break;
                    }

                    case 'toggleVisibility': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        if (event.effect.visibilityAction === 'hide') {
                            await webServer.sendToOverlay("giveaway-updater", {
                                type: 'hide',
                                overlayInstance: giveawayData.overlayInstance,
                                config: {
                                    giveawayTitle: giveawayId.replace('giveaway_', '')
                                }
                            });
                        } else {
                            await webServer.sendToOverlay("giveaway-updater", {
                                type: 'show',
                                overlayInstance: giveawayData.overlayInstance,
                                config: {
                                    giveawayTitle: giveawayId.replace('giveaway_', ''),
                                    giveawayData: giveawayData.giveawayData,
                                    entries: giveawayData.entries,
                                    totalEntries: giveawayData.totalEntries,
                                    pendingWinners: giveawayData.pendingWinners,
                                    winners: giveawayData.winners,
                                    styles: giveawayData.giveawayData.styles,
                                    display: giveawayData.giveawayData.display,
                                    enableClaimTimer: giveawayData.enableClaimTimer,
                                    claimMode: giveawayData.claimMode,
                                    claimDuration: giveawayData.claimDuration,
                                    paused: giveawayData.paused,
                                    pausedCloseRemainingSeconds: giveawayData.pausedCloseRemainingSeconds,
                                    pausedClaimRemaining: giveawayData.pausedClaimRemaining,
                                    entriesClosed: giveawayData.entriesClosed,
                                    position: giveawayData.position,
                                    customCoords: giveawayData.customCoords,
                                    closeTime: giveawayData.closeTime
                                }
                            });
                        }
                        break;
                    }

                    case 'removeGiveaway': {
                        if (!giveawayData) throw new Error('Giveaway not found');

                        await giveawayManager.backupGiveaway(giveawayId);

                        await webServer.sendToOverlay("giveaway-updater", {
                            type: 'remove',
                            overlayInstance: giveawayData.overlayInstance || '',
                            config: {
                                giveawayTitle: giveawayId.replace('giveaway_', '')
                            }
                        });

                        frontendCommunicator.send("giveawayRemoved", giveawayId);
                        break;
                    }

                    default: {
                        throw new Error(`Unknown mode: ${event.effect.mode}`);
                    }
                }

                return { success: true };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return { success: false, error: errorMessage };
            }
        },

        overlayExtension: {
            dependencies: {
                css: []
            },
            event: {
                name: "giveaway-updater",
                onOverlayEvent: (data: unknown) => {
                    if (typeof data === 'string') {
                        return giveawayManager.getGiveaway(data).then(activeGiveaway => ({
                            activeGiveaway: !!activeGiveaway
                        }));
                    }

                    if (typeof data !== 'object' || data === null || !('type' in data)) {
                        return giveawayManager.getGiveaway(String(data)).then(activeGiveaway => ({
                            activeGiveaway: !!activeGiveaway
                        }));
                    }

                    const eventData = data as { type: string, config?: { giveawayTitle: string, oldGiveawayTitle?: string, position?: string, customCoords?: any }, overlayInstance?: string };
                    const giveawayTitle = eventData.config?.giveawayTitle;

                    if (!giveawayTitle) {
                        return giveawayManager.getGiveaway(String(data)).then(activeGiveaway => ({
                            activeGiveaway: !!activeGiveaway
                        }));
                    }

                    const ids = {
                        oldId: eventData.config?.oldGiveawayTitle
                            ? `giveaway_${eventData.config.oldGiveawayTitle.replace(/[^a-zA-Z0-9]/g, '_')}`
                            : '',
                        newId: `giveaway_${giveawayTitle.replace(/[^a-zA-Z0-9]/g, '_')}`
                    };

                    const executeScript = (scriptContent: string) => {
                        const script = document.createElement('script');
                        script.textContent = scriptContent;
                        document.body.appendChild(script);
                        script.remove();
                    };

                    switch (eventData.type) {
                        case 'remove': {
                            executeScript(`
                                document.querySelectorAll('#${ids.newId}').forEach(wrapper => {
                                    wrapper.remove();
                                });
                            `);
                            return;
                        }

                        case 'update': {
                            executeScript(`
                                (function() {
                                    const config = ${JSON.stringify(eventData.config || {})};
                                    const positionClass = (config.position || 'Middle').toLowerCase().replace(' ', '-');
                                    const existingWrapper = document.getElementById('${ids.oldId}') || document.getElementById('${ids.newId}');

                                    if (existingWrapper) {
                                        if ('${ids.oldId}' && '${ids.oldId}' !== '${ids.newId}') {
                                            existingWrapper.id = '${ids.newId}';
                                        }
                                        existingWrapper.className = 'position-wrapper ' + positionClass;
                                        const innerPosition = existingWrapper.querySelector('.inner-position');
                                        if (innerPosition) {
                                            if (config.position === 'Custom' && config.customCoords) {
                                                const coords = config.customCoords;
                                                innerPosition.style.position = 'absolute';
                                                innerPosition.style.top = coords.top !== null ? coords.top + 'px' : '';
                                                innerPosition.style.bottom = coords.bottom !== null ? coords.bottom + 'px' : '';
                                                innerPosition.style.left = coords.left !== null ? coords.left + 'px' : '';
                                                innerPosition.style.right = coords.right !== null ? coords.right + 'px' : '';
                                            } else {
                                                innerPosition.style.position = '';
                                                innerPosition.style.removeProperty('top');
                                                innerPosition.style.removeProperty('bottom');
                                                innerPosition.style.removeProperty('left');
                                                innerPosition.style.removeProperty('right');
                                            }
                                        }
                                        window.dispatchEvent(new CustomEvent('giveawaySystemUpdate', {
                                            detail: {
                                                widgetId: '${ids.newId}',
                                                ...${JSON.stringify(eventData)},
                                                show: false
                                            }
                                        }));
                                    } else {
                                        fetch('http://${window.location.hostname}:7472/integrations/giveaway-system/giveaway-system.html')
                                            .then(response => response.text())
                                            .then(template => {
                                                const configString = JSON.stringify({
                                                    ...config,
                                                    widgetId: '${ids.newId}'
                                                }, null, 2);

                                                const wrapper = document.createElement('div');
                                                wrapper.id = '${ids.newId}';
                                                wrapper.className = 'position-wrapper ' + positionClass;

                                                const innerPosition = document.createElement('div');
                                                innerPosition.className = 'inner-position';

                                                if (config.position === 'Custom' && config.customCoords) {
                                                    const coords = config.customCoords;
                                                    innerPosition.style.position = 'absolute';
                                                    if (coords.top !== null) innerPosition.style.top = coords.top + 'px';
                                                    if (coords.bottom !== null) innerPosition.style.bottom = coords.bottom + 'px';
                                                    if (coords.left !== null) innerPosition.style.left = coords.left + 'px';
                                                    if (coords.right !== null) innerPosition.style.right = coords.right + 'px';
                                                }

                                                const updatedTemplate = template
                                                    .replace(/const CONFIG = {[\\s\\S]*?};/, 'const CONFIG = ' + configString + ';');

                                                innerPosition.innerHTML = updatedTemplate;
                                                wrapper.appendChild(innerPosition);
                                                $("#wrapper").append(wrapper);

                                                window.dispatchEvent(new CustomEvent('giveawaySystemUpdate', {
                                                    detail: {
                                                        widgetId: '${ids.newId}',
                                                        ...${JSON.stringify(eventData)},
                                                        show: true
                                                    }
                                                }));
                                            });
                                    }
                                })();
                            `);
                            return;
                        }

                        case 'hide': {
                            executeScript(`
                                document.querySelectorAll('#${ids.newId}').forEach(wrapper => {
                                    wrapper.style.display = 'none';
                                });
                            `);
                            return;
                        }

                        case 'show': {
                            executeScript(`
                                (function() {
                                    const config = ${JSON.stringify(eventData.config || {})};
                                    const positionClass = (config.position || 'Middle').toLowerCase().replace(' ', '-');
                                    const existingWrapper = document.getElementById('${ids.oldId}') || document.getElementById('${ids.newId}');

                                    if (existingWrapper) {
                                        existingWrapper.style.display = '';
                                        existingWrapper.className = 'position-wrapper ' + positionClass;
                                        const innerPosition = existingWrapper.querySelector('.inner-position');
                                        if (innerPosition) {
                                            if (config.position === 'Custom' && config.customCoords) {
                                                const coords = config.customCoords;
                                                innerPosition.style.position = 'absolute';
                                                innerPosition.style.top = coords.top !== null ? coords.top + 'px' : '';
                                                innerPosition.style.bottom = coords.bottom !== null ? coords.bottom + 'px' : '';
                                                innerPosition.style.left = coords.left !== null ? coords.left + 'px' : '';
                                                innerPosition.style.right = coords.right !== null ? coords.right + 'px' : '';
                                            } else {
                                                innerPosition.style.position = '';
                                                innerPosition.style.removeProperty('top');
                                                innerPosition.style.removeProperty('bottom');
                                                innerPosition.style.removeProperty('left');
                                                innerPosition.style.removeProperty('right');
                                            }
                                        }
                                        window.dispatchEvent(new CustomEvent('giveawaySystemUpdate', {
                                            detail: {
                                                widgetId: '${ids.newId}',
                                                ...${JSON.stringify(eventData)}
                                            }
                                        }));
                                    } else {
                                        fetch('http://${window.location.hostname}:7472/integrations/giveaway-system/giveaway-system.html')
                                            .then(response => response.text())
                                            .then(template => {
                                                const configString = JSON.stringify({
                                                    ...config,
                                                    widgetId: '${ids.newId}'
                                                }, null, 2);

                                                const wrapper = document.createElement('div');
                                                wrapper.id = '${ids.newId}';
                                                wrapper.className = 'position-wrapper ' + positionClass;

                                                const innerPosition = document.createElement('div');
                                                innerPosition.className = 'inner-position';

                                                if (config.position === 'Custom' && config.customCoords) {
                                                    const coords = config.customCoords;
                                                    innerPosition.style.position = 'absolute';
                                                    if (coords.top !== null) innerPosition.style.top = coords.top + 'px';
                                                    if (coords.bottom !== null) innerPosition.style.bottom = coords.bottom + 'px';
                                                    if (coords.left !== null) innerPosition.style.left = coords.left + 'px';
                                                    if (coords.right !== null) innerPosition.style.right = coords.right + 'px';
                                                }

                                                const updatedTemplate = template
                                                    .replace(/const CONFIG = {[\\s\\S]*?};/, 'const CONFIG = ' + configString + ';');

                                                innerPosition.innerHTML = updatedTemplate;
                                                wrapper.appendChild(innerPosition);
                                                $("#wrapper").append(wrapper);

                                                window.dispatchEvent(new CustomEvent('giveawaySystemUpdate', {
                                                    detail: {
                                                        widgetId: '${ids.newId}',
                                                        ...${JSON.stringify(eventData)},
                                                        show: true
                                                    }
                                                }));
                                            });
                                    }
                                })();
                            `);
                            return;
                        }

                        default:
                            return giveawayManager.getGiveaway(String(data)).then(activeGiveaway => ({
                                activeGiveaway: !!activeGiveaway
                            }));
                    }
                }
            }
        }
    };
    return updateEffectType;
}

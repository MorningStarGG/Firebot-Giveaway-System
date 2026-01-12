import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import type { EventData, GiveawayState, EffectModel, SlideMode } from "../types/types";
import { giveawayManager } from "../utility/giveaway-manager";
import mainTemplate from "../templates/main-template.html";
import { logger } from "../logger";
import { randomUUID } from "crypto";
import { webServer, settings, modules } from "../main";

let currentGiveawayState: GiveawayState = {
    uuid: '',
    giveawayData: {
        title: '',
        prize: '',
        category: '',
        entryCommand: '!enter',
        claimCommand: '!claim',
            display: {
                showTitle: true,
                showPrize: true,
                showPrizeLabel: true,
                prizeVisibility: 'label-prize',
                showEntryCount: true,
                showEntryCommand: true,
                showWinner: true,
                oddsMode: 'both',
                showOdds: true,
                showOddsPercentage: true,
                showOddsRatio: true,
                showClaimCommand: true,
                showTimer: true,
                showCloseTimer: true,
                animateWinner: true,
                rotateWinners: false,
                pendingWinnerRotationSeconds: 5,
                minimalMode: false,
                tickerIntervalSeconds: 2,
                commandCycleIntervalSeconds: 3,
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
                oddsText: 'Win odds: {percent}% ({ratio})',
                closeTimerUrgentSeconds: 30,
                claimTimerUrgentSeconds: 10,
                showImageText: false,
                imageTextTemplate: '{title} - {prize}',
                imageTextPosition: 'bottom',
                imageTextSize: 18
            },
            styles: {
                backgroundColor: "rgba(17, 17, 17, 1)",
                accentColor: "#a60000",
                textColor: "#e3e3e3",
                titleColor: "#e3e3e3",
            fontSize: "24px",
            giveawayWidth: "350px",
            winnerColor: "#ffcc00",
            shadowColor: "#a60000",
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
            }
        },
    entries: [],
    totalEntries: 0,
    winners: [],
    pendingWinners: [],
    ended: false,
    paused: false,
    entriesClosed: false,
    createdAt: '',
    updatedAt: '',
            claimMode: 'timer',
            displayDuration: 30,
            autoRemoveAfterClose: true,
            enableClaimTimer: true,
            claimDuration: 60,
            requireClaim: true,
            autoRerollOnExpire: false,
            requeueExpired: false,
            requeueDenied: false,
            retentionDays: 7,
    position: 'Middle',
    customCoords: {
        top: null,
        bottom: null,
        left: null,
        right: null
    },
    overlayInstance: '',
    allowMultipleEntries: false,
    maxEntriesPerUser: 1
};

/**
 * Generates a random integer between min and max
 */
function getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random preset position for the giveaway
 */
function getRandomPresetLocation(): string {
    const presetPositions = [
        'Top Left', 'Top Middle', 'Top Right',
        'Middle Left', 'Middle', 'Middle Right',
        'Bottom Left', 'Bottom Middle', 'Bottom Right'
    ];
    const randomIndex = getRandomInt(0, presetPositions.length - 1);
    return presetPositions[randomIndex];
}

function prepareStylesWithImage(styles: any, retentionDays?: number) {
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
                logger.warn('Failed to prepare giveaway image file', error);
            }
        }
    } else {
        delete prepared.imageToken;
    }

    return prepared;
}

function resolveSlideMode(display: any): SlideMode {
    if (!display) return 'disabled';
    if (display.slideMode === 'image' || display.slideMode === 'widget' || display.slideMode === 'cycle' || display.slideMode === 'disabled') {
        return display.slideMode;
    }
    return 'disabled';
}

function applySlideMode(display: any, mode: SlideMode) {
    if (!display) return;
    display.slideMode = mode;
}

function normalizeSlideMode(display: any) {
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

/**
 * Defines and exports the giveaway system effect type for Firebot
 */
export function giveawaySystemEffectType() {
    const effectType: Firebot.EffectType<EffectModel> = {
        definition: {
            id: "msgg:giveaway-system",
            name: "Advanced Giveaway System",
            description: "Highly customizable giveaway system with optional overlay including entry tracking and winner selection",
            icon: "fad fa-gift",
            categories: ["overlay"],
            dependencies: [],
            triggers: {
                command: true,
                custom_script: true,
                startup_script: true,
                api: true,
                event: true,
                hotkey: true,
                timer: true,
                counter: true,
                preset: true,
                manual: true,
            },
            outputs: []
        },

        optionsTemplate: mainTemplate,

        optionsController: ($scope: any, backendCommunicator: any, utilityService: any) => {
            const resolveSlideModeLocal = (display: any): SlideMode => {
                if (!display) return 'disabled';
                const mode = (display.slideMode || '').toLowerCase();
                if (mode === 'image' || mode === 'widget' || mode === 'cycle' || mode === 'disabled') return mode;
                return 'disabled';
            };

            const applySlideModeLocal = (display: any, mode: SlideMode) => {
                if (!display) return;
                display.slideMode = mode;
            };

            const normalizeSlideModeLocal = (display: any) => {
                if (!display) return;
                const mode = resolveSlideModeLocal(display);
                applySlideModeLocal(display, mode);
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

            const DEFAULT_DISPLAY = {
                showTitle: true,
                showPrize: true,
                showPrizeLabel: true,
                prizeVisibility: 'label-prize',
                showEntryCount: true,
                showEntryCommand: true,
                showWinner: true,
                oddsMode: 'both',
                showOdds: true,
                showOddsPercentage: true,
                showOddsRatio: true,
                showClaimCommand: true,
                showTimer: true,
                showCloseTimer: true,
                animateWinner: true,
                rotateWinners: false,
                pendingWinnerRotationSeconds: 5,
                minimalMode: false,
                tickerIntervalSeconds: 2,
                commandCycleIntervalSeconds: 3,
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
                showImageText: false,
                imageTextTemplate: '{title} - {prize}',
                imageTextPosition: 'bottom',
                imageTextSize: 18
            };

            const DEFAULT_GIVEAWAY_OPTIONS = {
                entryCommand: "!enter",
                claimCommand: "!claim",
                claimMode: 'timer',
                requireClaim: true,
                enableClaimTimer: true,
                autoClose: false,
                duration: 300,
                displayDuration: 30,
                claimDuration: 60,
                autoRemoveAfterClose: true,
                autoRerollOnExpire: false,
                requeueExpired: false,
                requeueDenied: false,
                retentionDays: 7,
                allowMultipleEntries: false,
                maxEntriesPerUser: 1
            };

            const POSITIONS = [
                'Random',
                'Top Left', 'Top Middle', 'Top Right',
                'Middle Left', 'Middle', 'Middle Right',
                'Bottom Left', 'Bottom Middle', 'Bottom Right',
                'Custom'
            ];

            const normalizeImagePlacement = (styles: any) => {
                if (!styles) return;
                const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
                const rawPlacement = (styles.imagePlacement ?? 'above') as typeof allowedPlacements[number];
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

            function initializeDefaults() {
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
                $scope.effect.display = { ...(DEFAULT_DISPLAY), ...($scope.effect.display || {}) };
                normalizeSlideModeLocal($scope.effect.display);
                normalizeDisplayModesLocal($scope.effect.display);
                $scope.effect.giveawayOptions = {
                    ...DEFAULT_GIVEAWAY_OPTIONS,
                    ...($scope.effect.giveawayOptions || {})
                };
                normalizeClaimModeLocal($scope.effect.giveawayOptions);
                normalizeImagePlacement($scope.effect.styles);
                applyModePlacementRules();
                $scope.positions = POSITIONS;
            }

            function loadExistingGiveawayData() {
                if (!$scope.effect.giveawayTitle) return;

                const sanitizedTitle = $scope.effect.giveawayTitle.replace(/[^a-zA-Z0-9]/g, '_');
                const giveawayId = `giveaway_${sanitizedTitle}`;

                backendCommunicator.fireEventAsync("getGiveawayData", giveawayId)
                    .then((giveawayData: any) => {
                        if (!giveawayData?.giveawayData) return;

                        if (giveawayData.giveawayData.styles) {
                            $scope.effect.styles = { ...DEFAULT_STYLES, ...giveawayData.giveawayData.styles };
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
                            normalizeImagePlacement($scope.effect.styles);
                        }

                        if (giveawayData.giveawayData.display) {
                            $scope.effect.display = { ...DEFAULT_DISPLAY, ...giveawayData.giveawayData.display };
                            normalizeSlideModeLocal($scope.effect.display);
                            normalizeDisplayModesLocal($scope.effect.display);
                            applyModePlacementRules();
                            normalizeImagePlacement($scope.effect.styles);
                        }
                        $scope.effect.display.prizeLabelText = giveawayData.giveawayData.prizeLabelText || $scope.effect.display.prizeLabelText;
                        $scope.effect.display.statLabelText = giveawayData.giveawayData.statLabelText || $scope.effect.display.statLabelText;
                        $scope.effect.display.entriesClosedText = giveawayData.giveawayData.entriesClosedText || $scope.effect.display.entriesClosedText;
                        $scope.effect.display.entryCommandText = giveawayData.giveawayData.display?.entryCommandText || $scope.effect.display.entryCommandText;
                        $scope.effect.display.closeTimerText = giveawayData.giveawayData.display?.closeTimerText || $scope.effect.display.closeTimerText;
                        $scope.effect.display.claimCommandText = giveawayData.giveawayData.display?.claimCommandText || $scope.effect.display.claimCommandText;
                        $scope.effect.display.winnerPendingText = giveawayData.giveawayData.display?.winnerPendingText || $scope.effect.display.winnerPendingText;
                        $scope.effect.display.showImageText = giveawayData.giveawayData.display?.showImageText ?? $scope.effect.display.showImageText;
                        $scope.effect.display.imageTextTemplate = giveawayData.giveawayData.display?.imageTextTemplate || $scope.effect.display.imageTextTemplate;
                        $scope.effect.display.imageTextPosition = giveawayData.giveawayData.display?.imageTextPosition || $scope.effect.display.imageTextPosition;
                        $scope.effect.display.imageTextSize = giveawayData.giveawayData.display?.imageTextSize || $scope.effect.display.imageTextSize;

                        if (giveawayData.giveawayData.category) {
                            $scope.effect.category = giveawayData.giveawayData.category;
                        }

                        if (typeof giveawayData.retentionDays === 'number') {
                            $scope.effect.giveawayOptions.retentionDays = giveawayData.retentionDays;
                        }

                        if (typeof giveawayData.claimDuration === 'number') {
                            $scope.effect.giveawayOptions.claimDuration = giveawayData.claimDuration;
                        }

                        if (typeof giveawayData.displayDuration === 'number') {
                            $scope.effect.giveawayOptions.displayDuration = giveawayData.displayDuration;
                        }

                        if (typeof giveawayData.autoRemoveAfterClose === 'boolean') {
                            $scope.effect.giveawayOptions.autoRemoveAfterClose = giveawayData.autoRemoveAfterClose;
                        }

                        if (typeof giveawayData.enableClaimTimer === 'boolean') {
                            $scope.effect.giveawayOptions.enableClaimTimer = giveawayData.enableClaimTimer;
                        }

                        if (giveawayData.claimMode) {
                            $scope.effect.giveawayOptions.claimMode = giveawayData.claimMode as any;
                        }

                        $scope.effect.giveawayOptions.requireClaim = giveawayData.requireClaim !== false;
                        normalizeClaimModeLocal($scope.effect.giveawayOptions);
                    })
                    .catch((error: Error) => {
                        console.error('Error loading giveaway data:', error);
                    });
            }

            $scope.onClaimModeChange = () => {
                normalizeClaimModeLocal($scope.effect.giveawayOptions);
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

            initializeDefaults();
            loadExistingGiveawayData();

            $scope.showOverlayInfoModal = (overlayInstance: any) => {
                utilityService.showOverlayInfoModal(overlayInstance);
            };
        },

        optionsValidator: (effect: EffectModel) => {
            const resolveClaimMode = (options: any): 'enabled' | 'timer' | 'disabled' => {
                const modeInput = options?.claimMode;
                if (modeInput === 'enabled' || modeInput === 'timer' || modeInput === 'disabled') {
                    return modeInput;
                }
                if (options?.requireClaim === false) return 'disabled';
                if (options?.enableClaimTimer !== false) return 'timer';
                return 'enabled';
            };

            const errors = [];
            if (effect.giveawayTitle == null || effect.giveawayTitle === "") {
                errors.push("Please provide a giveaway title");
            }
            if (effect.giveawayOptions.autoClose && (!effect.giveawayOptions.duration || effect.giveawayOptions.duration <= 0)) {
                errors.push("Please provide a valid duration for auto-close");
            }
            const claimMode = resolveClaimMode(effect.giveawayOptions);
            if (claimMode === 'timer') {
                if (effect.giveawayOptions.claimDuration == null || effect.giveawayOptions.claimDuration <= 0) {
                    errors.push("Please provide a valid claim duration");
                }
            }
            return errors;
        },

        onTriggerEvent: async (event) => {
            const sanitizedTitle = event.effect.giveawayTitle.replace(/[^a-zA-Z0-9]/g, '_');
            const giveawayId = `giveaway_${sanitizedTitle}`;

            try {
                const claimMode = normalizeClaimMode(event.effect.giveawayOptions);
                if (event.effect.display) {
                    normalizeSlideMode(event.effect.display);
                }
                if (event.effect.position === 'Random') {
                    event.effect.position = getRandomPresetLocation();
                }

                const existingGiveaway = await giveawayManager.getGiveaway(giveawayId);
                if (existingGiveaway?.giveawayData?.display) {
                    normalizeSlideMode(existingGiveaway.giveawayData.display);
                }

                if (existingGiveaway) {
                    const preparedStyles = prepareStylesWithImage(
                        { ...existingGiveaway.giveawayData.styles, ...event.effect.styles },
                        event.effect.giveawayOptions.retentionDays ?? existingGiveaway.retentionDays
                    );
                    event.effect.styles = preparedStyles;
                    normalizeDisplayModes(event.effect.display);
                    existingGiveaway.giveawayData = {
                        ...existingGiveaway.giveawayData,
                        title: event.effect.giveawayTitle,
                        prize: event.effect.prize,
                        category: event.effect.category || '',
                        entryCommand: event.effect.giveawayOptions.entryCommand,
                        claimCommand: event.effect.giveawayOptions.claimCommand,
                        display: event.effect.display,
                        styles: preparedStyles,
                        prizeLabelText: event.effect.display?.prizeLabelText || existingGiveaway.giveawayData.prizeLabelText || 'PRIZE',
                        statLabelText: event.effect.display?.statLabelText || existingGiveaway.giveawayData.statLabelText || 'ENTRIES',
                        entriesClosedText: event.effect.display?.entriesClosedText || existingGiveaway.giveawayData.entriesClosedText || 'Entries closed'
                    };
                    existingGiveaway.ended = false;
                    existingGiveaway.paused = false;
                    existingGiveaway.entriesClosed = false;
                    existingGiveaway.entriesClosedAt = undefined;
                    existingGiveaway.autoClose = !!event.effect.giveawayOptions.autoClose;
                    existingGiveaway.duration = Number(event.effect.giveawayOptions.duration) || 0;
                    existingGiveaway.updatedAt = new Date().toISOString();
                    existingGiveaway.closeTime = event.effect.giveawayOptions.autoClose ?
                        new Date(Date.now() + (event.effect.giveawayOptions.duration * 1000)).toISOString() :
                        undefined;
                    existingGiveaway.displayDuration = event.effect.giveawayOptions.displayDuration;
                    existingGiveaway.autoRemoveAfterClose = event.effect.giveawayOptions.autoRemoveAfterClose !== false;
                    existingGiveaway.claimMode = claimMode;
                    existingGiveaway.enableClaimTimer = claimMode === 'timer';
                    existingGiveaway.claimDuration = event.effect.giveawayOptions.claimDuration;
                    existingGiveaway.requireClaim = claimMode !== 'disabled';
                    existingGiveaway.autoRerollOnExpire = !!event.effect.giveawayOptions.autoRerollOnExpire;
                    existingGiveaway.retentionDays = Number(event.effect.giveawayOptions.retentionDays) || 7;
                    existingGiveaway.requeueExpired = !!event.effect.giveawayOptions.requeueExpired;
                    existingGiveaway.requeueDenied = !!event.effect.giveawayOptions.requeueDenied;
                    existingGiveaway.position = event.effect.position;
                    existingGiveaway.customCoords = event.effect.customCoords;
                    existingGiveaway.overlayInstance = event.effect.overlayInstance || '';
                    existingGiveaway.allowMultipleEntries = event.effect.giveawayOptions.allowMultipleEntries;
                    existingGiveaway.maxEntriesPerUser = event.effect.giveawayOptions.maxEntriesPerUser;

                    await giveawayManager.startGiveaway(giveawayId, modules.eventManager);
                    currentGiveawayState = existingGiveaway;
                } else {
                    const preparedStyles = prepareStylesWithImage(
                        event.effect.styles,
                        event.effect.giveawayOptions.retentionDays
                    );
                    event.effect.styles = preparedStyles;
                    normalizeDisplayModes(event.effect.display);
                    currentGiveawayState = {
                        uuid: randomUUID(),
                        giveawayData: {
                            title: event.effect.giveawayTitle,
                            prize: event.effect.prize,
                            category: event.effect.category || '',
                        entryCommand: event.effect.giveawayOptions.entryCommand,
                        claimCommand: event.effect.giveawayOptions.claimCommand,
                        display: event.effect.display,
                        styles: preparedStyles,
                        prizeLabelText: event.effect.display?.prizeLabelText || 'PRIZE',
                        statLabelText: event.effect.display?.statLabelText || 'ENTRIES',
                        entriesClosedText: event.effect.display?.entriesClosedText || 'Entries closed'
                    },
                        entries: [],
                        totalEntries: 0,
                        winners: [],
                        pendingWinners: [],
                        position: event.effect.position,
                        customCoords: event.effect.customCoords,
                        overlayInstance: event.effect.overlayInstance || '',
                        ended: false,
                        paused: false,
                        pausedCloseRemainingSeconds: null,
                        pausedClaimRemaining: {},
                        entriesClosed: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        closeTime: event.effect.giveawayOptions.autoClose ?
                            new Date(Date.now() + (event.effect.giveawayOptions.duration * 1000)).toISOString() :
                            undefined,
                        autoClose: !!event.effect.giveawayOptions.autoClose,
                        duration: Number(event.effect.giveawayOptions.duration) || 0,
                        claimMode: claimMode,
                        displayDuration: event.effect.giveawayOptions.displayDuration,
                        autoRemoveAfterClose: event.effect.giveawayOptions.autoRemoveAfterClose !== false,
                        enableClaimTimer: claimMode === 'timer',
                        claimDuration: event.effect.giveawayOptions.claimDuration,
                        requireClaim: claimMode !== 'disabled',
                        autoRerollOnExpire: !!event.effect.giveawayOptions.autoRerollOnExpire,
                        retentionDays: Number(event.effect.giveawayOptions.retentionDays) || 7,
                        requeueExpired: !!event.effect.giveawayOptions.requeueExpired,
                        requeueDenied: !!event.effect.giveawayOptions.requeueDenied,
                        allowMultipleEntries: event.effect.giveawayOptions.allowMultipleEntries || false,
                        maxEntriesPerUser: event.effect.giveawayOptions.maxEntriesPerUser || 1
                    };

                    await giveawayManager.createGiveaway(giveawayId, currentGiveawayState);
                    await giveawayManager.startGiveaway(giveawayId, modules.eventManager);
                }

                const data = {
                    uuid: currentGiveawayState.uuid,
                    overlayInstance: event.effect.overlayInstance,
                    config: {
                        ...event.effect,
                        giveawayData: currentGiveawayState.giveawayData,
                        entries: currentGiveawayState.entries,
                        totalEntries: currentGiveawayState.totalEntries,
                        winners: currentGiveawayState.winners,
                        pendingWinners: currentGiveawayState.pendingWinners,
                        position: event.effect.position,
                        customCoords: event.effect.customCoords,
                        styles: currentGiveawayState.giveawayData.styles,
                        enableClaimTimer: currentGiveawayState.enableClaimTimer,
                        entriesClosed: currentGiveawayState.entriesClosed,
                        paused: currentGiveawayState.paused,
                        pausedCloseRemainingSeconds: currentGiveawayState.pausedCloseRemainingSeconds,
                        pausedClaimRemaining: currentGiveawayState.pausedClaimRemaining,
                        closeTime: currentGiveawayState.closeTime,
                        claimDuration: currentGiveawayState.claimDuration,
                        claimMode: currentGiveawayState.claimMode
                    }
                };

                if (settings.useOverlayInstances()) {
                    if (event.effect.overlayInstance != null) {
                        if (settings.getOverlayInstances().includes(event.effect.overlayInstance)) {
                            data.overlayInstance = event.effect.overlayInstance;
                        }
                    }
                }
                await webServer.sendToOverlay("giveaway-system", data);
            }
            catch (error) {
                logger.error('Giveaway System Error:', error);
                return { success: false };
            }
        },

        overlayExtension: {
            dependencies: {
                css: [],
                js: []
            },

            event: {
                name: "giveaway-system",
                onOverlayEvent: (data: unknown) => {
                    const eventData = data as EventData;
                    const sanitizedTitle = eventData.config.giveawayTitle.replace(/[^a-zA-Z0-9]/g, '_');
                    const widgetId = `giveaway_${sanitizedTitle}`;
                    const positionClass = eventData.config.position.toLowerCase().replace(' ', '-');
                    const { customCoords } = eventData.config;

                    let giveawayWrapper = document.getElementById(widgetId);
                    if (giveawayWrapper) {
                        giveawayWrapper.className = `position-wrapper ${positionClass}`;

                        const innerPosition = giveawayWrapper.querySelector('.inner-position') as HTMLElement;
                        if (innerPosition) {
                            innerPosition.style.position = '';
                            innerPosition.style.top = '';
                            innerPosition.style.bottom = '';
                            innerPosition.style.left = '';
                            innerPosition.style.right = '';

                            if (eventData.config.position === 'Custom' && customCoords) {
                                innerPosition.style.position = 'absolute';
                                if (customCoords.top !== null) {
                                    innerPosition.style.top = `${customCoords.top}px`;
                                }
                                if (customCoords.bottom !== null) {
                                    innerPosition.style.bottom = `${customCoords.bottom}px`;
                                }
                                if (customCoords.left !== null) {
                                    innerPosition.style.left = `${customCoords.left}px`;
                                }
                                if (customCoords.right !== null) {
                                    innerPosition.style.right = `${customCoords.right}px`;
                                }
                            }
                        }

                        const script = document.createElement('script');
                        script.textContent = `
                            window.dispatchEvent(new CustomEvent('giveawaySystemUpdate', {
                                detail: ${JSON.stringify(eventData)}
                            }));
                        `;
                        document.body.appendChild(script);
                        script.remove();
                        return;
                    }

                    fetch(`http://${window.location.hostname}:7472/integrations/giveaway-system/giveaway-system.html`)
                        .then(response => response.text())
                        .then(template => {
                            const configString = JSON.stringify(eventData.config);
                            const updatedTemplate = template.replace(/const CONFIG = \{[\s\S]*?\};/, `const CONFIG = ${configString};`);

                            const existingGiveaways = document.querySelectorAll(`#${widgetId}`);
                            existingGiveaways.forEach(giveaway => giveaway.remove());

                            const wrapper = document.createElement('div');
                            wrapper.id = widgetId;
                            wrapper.className = `position-wrapper ${positionClass}`;

                            let innerHtml = `<div class="inner-position giveawayOverlay"`;

                            if (eventData.config.position === 'Custom' && customCoords) {
                                innerHtml += ` style="position: absolute;`;
                                if (customCoords.top !== null) {
                                    innerHtml += `top: ${customCoords.top}px;`;
                                }
                                if (customCoords.bottom !== null) {
                                    innerHtml += `bottom: ${customCoords.bottom}px; top: auto;`;
                                }
                                if (customCoords.left !== null) {
                                    innerHtml += `left: ${customCoords.left}px;`;
                                }
                                if (customCoords.right !== null) {
                                    innerHtml += `right: ${customCoords.right}px; left: auto;`;
                                }
                                innerHtml += `"`;
                            }
                            innerHtml += `>${updatedTemplate}</div>`;

                            wrapper.innerHTML = innerHtml;
                            $("#wrapper").append(wrapper);
                        });
                }
            }
        }
    };
    return effectType;
}

import type { SlideMode } from '../types/types';
import { withEditor } from '../utility/renderer-callback';
export const controller = withEditor(
    ['$scope', 'backendCommunicator'],
    (editor: any, $scope: any, backendCommunicator: any) => {
        const resolveSlideModeLocal = (display: any): SlideMode => {
            if (!display) return 'disabled';
            const mode = (display.slideMode || '').toLowerCase();
            if (mode === 'image' || mode === 'widget' || mode === 'cycle' || mode === 'disabled')
                return mode as SlideMode;
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
            const mode = (allowedDisplayModes as readonly string[]).includes(rawMode) ? rawMode : 'widgetImage';
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
            modeOverride?: 'enabled' | 'timer' | 'disabled',
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
            backgroundColor: '#111111',
            accentColor: '#a60000',
            textColor: '#e3e3e3',
            titleColor: '#e3e3e3',
            fontSize: '24px',
            winnerColor: '#ffcc00',
            shadowColor: '#a60000',
            giveawayWidth: '350px',
            giveawayScale: 1,
            imageScale: 1,
            customCSS: '',
            showImage: true,
            imageMode: 'url',
            imageUrl: '',
            imageFile: '',
            imagePlacement: 'above',
            imageOverlay: true,
            entriesClosedColor: '#ffcc00',
            prizeLabelColor: '#e3e3e3',
            statLabelColor: '#e3e3e3',
            prizeColor: '#e3e3e3',
            entryCommandColor: '#a60000',
            entryTextColor: '#e3e3e3',
            closeTimerColor: '#e3e3e3',
            closeTimerTextColor: '#e3e3e3',
            closeTimerValueColor: '#a60000',
            closeTimerUrgentColor: '#ff4444',
            claimCommandColor: '#a60000',
            claimTextColor: '#e3e3e3',
            claimTimerColor: '#e3e3e3',
            claimTimerTextColor: '#e3e3e3',
            claimTimerValueColor: '#ffcc00',
            claimTimerUrgentColor: '#ff4444',
            winnerPendingColor: '#ffcc00',
            statusClosedColor: '#ffcc00',
            statusPausedColor: '#a60000',
            statusEndedColor: '#ffcc00',
            statusLabelColor: '#e3e3e3',
            entryNumberColor: '#e3e3e3',
            imageTextColor: '#e3e3e3',
            imageTextPlaceholderColor: '#ffcc00',
            oddsColor: '#e3e3e3',
        };
        const defaultEffect = {
            entryAttemptId: '',
            cancellationReason: '',
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
                imageTextSize: 18,
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
                maxEntriesPerUser: 1,
            },
        };
        const normalizeImagePlacement = (styles: any) => {
            if (!styles) return;
            const rawPlacement = (styles.imagePlacement ?? 'above') as (typeof allowedPlacements)[number];
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
            'backgroundColor',
            'accentColor',
            'textColor',
            'titleColor',
            'winnerColor',
            'shadowColor',
            'entriesClosedColor',
            'prizeLabelColor',
            'statLabelColor',
            'prizeColor',
            'entryCommandColor',
            'entryTextColor',
            'entryNumberColor',
            'closeTimerColor',
            'closeTimerTextColor',
            'closeTimerValueColor',
            'closeTimerUrgentColor',
            'claimCommandColor',
            'claimTextColor',
            'claimTimerColor',
            'claimTimerTextColor',
            'claimTimerValueColor',
            'claimTimerUrgentColor',
            'winnerPendingColor',
            'statusClosedColor',
            'statusPausedColor',
            'statusEndedColor',
            'statusLabelColor',
            'imageTextColor',
            'imageTextPlaceholderColor',
            'oddsColor',
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
            backgroundColor: 'Background Color',
            accentColor: 'Accent Color',
            textColor: 'Text Color',
            titleColor: 'Title Color',
            winnerColor: 'Winner Color',
            shadowColor: 'Text Shadow',
            giveawayScale: 'Giveaway Scale',
            imageScale: 'Image Scale',
            imageMode: 'Image Source',
            imageUrl: 'Image URL',
            imageFile: 'Image File',
            imagePlacement: 'Image Placement',
            imageOverlay: 'Image Overlay',
            closeTimerTextColor: 'Close Timer Text',
            closeTimerValueColor: 'Close Timer Number',
            closeTimerUrgentColor: 'Close Timer Urgent',
            claimTimerTextColor: 'Claim Timer Text',
            claimTimerValueColor: 'Claim Timer Number',
            claimTimerUrgentColor: 'Claim Timer Urgent',
            entryCommandColor: 'Entry Command Color',
            entryTextColor: 'Entry Text Color',
            entryNumberColor: 'Entry Number Color',
            claimCommandColor: 'Claim Command Color',
            claimTextColor: 'Claim Text Color',
            statusClosedColor: 'Status Closed Color',
            statusPausedColor: 'Status Paused Color',
            statusEndedColor: 'Status Ended Color',
            statusLabelColor: 'Status Label Color',
            prizeLabelColor: 'Prize Label Color',
            statLabelColor: 'Stat Label Color',
            prizeColor: 'Prize Text Color',
            winnerPendingColor: 'Winner Pending Color',
            oddsColor: 'Odds Color',
            imageTextColor: 'Image Text Color',
            imageTextPlaceholderColor: 'Image Text Placeholder Color',
        };
        function getGiveawayId(giveawayTitle: string | undefined, communicator: any): string {
            if (!giveawayTitle) return '';
            if (giveawayTitle.includes('$')) return '';
            return giveawayTitle.startsWith('giveaway_')
                ? giveawayTitle
                : 'giveaway_' + giveawayTitle.replace(/[^a-zA-Z0-9]/g, '_');
        }
        function safeApply(fn: () => void) {
            try {
                if (!$scope.$$phase && !$scope.$root.$$phase) {
                    $scope.$apply(fn);
                } else {
                    fn();
                }
            } catch (error) {
                console.error('[GiveawaySystemUpdater] Error in safeApply:', error);
            }
        }
        $scope.effect.giveawayOptions.winLimit ||= { maximum: null, scope: 'giveaway', period: 'untilReset', days: 30 };
        $scope.effect.giveawayOptions.rerollMode ??= 'different';
        editor.captureDefaults();
        $scope.isAttemptControl = () =>
            $scope.effect.mode === 'entryManagement' &&
            ['cancelAttempt', 'setAttemptOdds'].includes($scope.effect.entryAction);
        $scope.loadGiveawayData = () => {
            if ($scope.isAttemptControl()) return;
            const id = getGiveawayId(
                $scope.effect.giveawaySelectionMode === 'manual'
                    ? $scope.effect.manualGiveawayTitle
                    : $scope.effect.giveawayTitle,
                backendCommunicator,
            );
            if (!id || id.includes('$')) return;
            backendCommunicator
                .fireEventAsync('getGiveawayData', id)
                .then((giveawayData: any) => {
                    if (!giveawayData?.giveawayData) return;
                    $scope.currentEntries = giveawayData.entries || [];
                    $scope.pendingWinners = giveawayData.pendingWinners || [];
                    editor.prefill('styles', giveawayData.giveawayData.styles);
                    editor.prefill('display', {
                        ...giveawayData.giveawayData.display,
                        prizeLabelText: giveawayData.giveawayData.prizeLabelText,
                        statLabelText: giveawayData.giveawayData.statLabelText,
                        entriesClosedText: giveawayData.giveawayData.entriesClosedText,
                    });
                    editor.prefill('category', giveawayData.giveawayData.category || '');
                    const options: any = {
                        entryCommand: giveawayData.giveawayData.entryCommand,
                        claimCommand: giveawayData.giveawayData.claimCommand,
                    };
                    for (const k of [
                        'autoClose',
                        'duration',
                        'allowMultipleEntries',
                        'maxEntriesPerUser',
                        'claimMode',
                        'claimDuration',
                        'requireClaim',
                        'enableClaimTimer',
                        'displayDuration',
                        'autoRemoveAfterClose',
                        'autoRerollOnExpire',
                        'retentionDays',
                        'requeueExpired',
                        'requeueDenied',
                        'winLimit',
                        'rerollMode',
                    ])
                        options[k] = giveawayData[k];
                    editor.prefill('giveawayOptions', options);
                    editor.prefill('position', giveawayData.position);
                    editor.prefill('customCoords', giveawayData.customCoords);
                    editor.prefill('overlayInstance', giveawayData.overlayInstance);
                    const type = $scope.effect.setting?.type;
                    if (type)
                        editor.prefill(
                            'setting.value',
                            giveawayData[type] ??
                            giveawayData.giveawayData.styles?.[type] ??
                            giveawayData.giveawayData.display?.[type] ??
                            giveawayData.giveawayData[type],
                        );
                })
                .catch(() => { });
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
            const giveawayId =
                $scope.effect.giveawaySelectionMode === 'manual'
                    ? getGiveawayId($scope.effect.manualGiveawayTitle, backendCommunicator)
                    : $scope.effect.giveawayTitle;
            if (newMode === 'updateStyles' || newMode === 'updateDisplay') {
                if (!$scope.effect.setting?.type) {
                    $scope.effect.setting = {
                        type: newMode === 'updateStyles' ? 'backgroundColor' : 'showEntryCount',
                        value: newMode === 'updateStyles' ? '' : true,
                    };
                }
            }
            if (giveawayId) {
                $scope.loadGiveawayData();
            }
        });
        $scope.$watch(
            '[effect.giveawaySelectionMode, effect.manualGiveawayTitle, effect.giveawayTitle]',
            (newVal: [string, string, string], oldVal: [string, string, string]) => {
                if ($scope.effect.mode === 'winnerHistory') {
                    return;
                }
                const [newMode, newManual, newTitle] = newVal;
                const [oldMode, oldManual, oldTitle] = oldVal;
                if (newMode !== oldMode || newManual !== oldManual || newTitle !== oldTitle) {
                    $scope.loadGiveawayData();
                }
            },
            true,
        );
        backendCommunicator.on('changed', () => {
            loadGiveaways();
            loadAllGiveaways();
            $scope.loadGiveawayData();
        });
        function handleResponse(response: unknown) {
            if (Array.isArray(response) && response.every((item) => typeof item === 'string')) {
                backendCommunicator.fireEventAsync('getAllGiveawaysWithStatus', {}).then(
                    (
                        giveawaysWithStatus: Array<{
                            giveawayId: string;
                            displayTitle: string;
                            status: 'active' | 'stopped';
                        }>,
                    ) => {
                        const mappedGiveaways = response.map((giveawayId) => {
                            const giveawayInfo = giveawaysWithStatus.find(
                                (g: { giveawayId: string }) => g.giveawayId === giveawayId,
                            );
                            return {
                                value: giveawayId,
                                label: giveawayInfo ? giveawayInfo.displayTitle : giveawayId.replace('giveaway_', ''),
                            };
                        });
                        safeApply(() => {
                            $scope.activeGiveaways = mappedGiveaways;
                            if ($scope.effect.giveawayTitle) {
                                $scope.loadGiveawayData();
                            }
                        });
                    },
                );
            }
        }
        function handleAllGiveawaysResponse(
            response: Array<{
                giveawayId: string;
                displayTitle: string;
                status: 'active' | 'stopped';
            }>,
        ) {
            if (Array.isArray(response)) {
                const mappedGiveaways = response.map((giveaway) => ({
                    value: giveaway.giveawayId,
                    label: `${giveaway.displayTitle} (${giveaway.status})`,
                }));
                safeApply(() => {
                    $scope.allGiveaways = mappedGiveaways;
                });
            }
        }
        function loadGiveaways() {
            backendCommunicator
                .fireEventAsync('getActiveGiveaways', {})
                .then((response: unknown) => {
                    handleResponse(response);
                })
                .catch((error: unknown) => {
                    console.error('[GiveawaySystemUpdater] Error:', error);
                });
        }
        function loadAllGiveaways() {
            backendCommunicator
                .fireEventAsync('getAllGiveawaysWithStatus', {})
                .then((response: unknown) => {
                    handleAllGiveawaysResponse(
                        response as Array<{
                            giveawayId: string;
                            displayTitle: string;
                            status: 'active' | 'stopped';
                        }>,
                    );
                })
                .catch((error: unknown) => {
                    console.error('[GiveawaySystemUpdater] Error loading giveaways:', error);
                });
        }
        loadGiveaways();
        loadAllGiveaways();
    },
);

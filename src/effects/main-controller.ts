import { defaultConfiguration } from '../shared/configuration';
import type { SlideMode } from '../types/types';
import { withEditor } from '../utility/renderer-callback';
export const controller = withEditor(
    ['$scope', 'backendCommunicator', 'utilityService'],
    (editor: any, $scope: any, backendCommunicator: any, utilityService: any, defaults: any) => {
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
        const DEFAULT_STYLES = defaults.styles;
        const DEFAULT_DISPLAY = defaults.display;
        const DEFAULT_GIVEAWAY_OPTIONS = defaults.giveawayOptions;
        const POSITIONS = [
            'Random',
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
        ];
        const normalizeImagePlacement = (styles: any) => {
            if (!styles) return;
            const allowedPlacements = ['above', 'below', 'left', 'right', 'background', 'none'] as const;
            const rawPlacement = (styles.imagePlacement ?? 'above') as (typeof allowedPlacements)[number];
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
            $scope.effect.display = { ...DEFAULT_DISPLAY, ...($scope.effect.display || {}) };
            normalizeSlideModeLocal($scope.effect.display);
            normalizeDisplayModesLocal($scope.effect.display);
            $scope.effect.giveawayOptions = {
                ...DEFAULT_GIVEAWAY_OPTIONS,
                ...($scope.effect.giveawayOptions || {}),
            };
            normalizeClaimModeLocal($scope.effect.giveawayOptions);
            normalizeImagePlacement($scope.effect.styles);
            applyModePlacementRules();
            $scope.positions = POSITIONS;
        }
        function loadExistingGiveawayData() {
            if (!$scope.effect.giveawayTitle || $scope.effect.giveawayTitle.includes('$')) return;
            const title = $scope.effect.giveawayTitle;
            const id = title.startsWith('giveaway_') ? title : 'giveaway_' + title.replace(/[^a-zA-Z0-9]/g, '_');
            backendCommunicator
                .fireEventAsync('getGiveawayData', id)
                .then((giveawayData: any) => {
                    if (!giveawayData?.giveawayData) return;
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
                })
                .catch(() => { });
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
        $scope.formView = { section: 'Basics', displayGroup: 'Layout & Images', colorGroup: 'General' };
        $scope.selectSection = (section: string) => {
            $scope.formView.section = section;
        };
        $scope.templatePicker = { open: false, rows: [], search: '', page: 1, pages: 1 };
        $scope.openTemplatePicker = async () => {
            $scope.templatePicker.open = true;
            try {
                const result = await backendCommunicator.fireEventAsync('rows', {
                    area: 'templates',
                    page: $scope.templatePicker.page,
                    search: $scope.templatePicker.search,
                });
                $scope.templatePicker.rows = result.rows;
                $scope.templatePicker.pages = result.pages;
            } catch (e: any) {
                $scope.giveawayError = e.message;
            }
            $scope.$evalAsync();
        };
        $scope.loadTemplateIntoEffect = async (id: string) => {
            try {
                const record = await backendCommunicator.fireEventAsync('template', { id });
                const yes = await utilityService.showConfirmationModal({
                    title: 'Load Template',
                    question:
                        'Copy ' +
                        record.name +
                        ' into this effect? This replaces configuration fields, preserves an existing title and overlay instance, and takes effect when you save the effect.',
                    confirmLabel: 'Copy Settings',
                    cancelLabel: 'Cancel',
                });
                if (!yes) return;
                const title = $scope.effect.giveawayTitle,
                    instance = $scope.effect.overlayInstance;
                const value = JSON.parse(JSON.stringify(record.configuration));
                for (const field of [
                    'giveawayTitle',
                    'prize',
                    'category',
                    'styles',
                    'display',
                    'giveawayOptions',
                    'position',
                    'customCoords',
                ])
                    $scope.effect[field] = value[field];
                if (title) $scope.effect.giveawayTitle = title;
                $scope.effect.overlayInstance = instance || '';
                $scope.formView.section = 'Basics';
                $scope.templatePicker.open = false;
            } catch (e: any) {
                $scope.giveawayError = e.message;
            }
            $scope.$evalAsync();
        };
        $scope.effect.position ??= defaults.position;
        $scope.effect.customCoords ??= JSON.parse(JSON.stringify(defaults.customCoords));
        $scope.effect.overlayInstance ??= '';
        initializeDefaults();
        $scope.effect.giveawayOptions.winLimit ||= { maximum: null, scope: 'giveaway', period: 'untilReset', days: 30 };
        $scope.effect.giveawayOptions.rerollMode ??= 'different';
        editor.captureDefaults();
        if ($scope.configurationContext !== 'page') loadExistingGiveawayData();
        $scope.showOverlayInfoModal = (overlayInstance: any) => {
            utilityService.showOverlayInfoModal(overlayInstance);
        };
    },
    defaultConfiguration,
);

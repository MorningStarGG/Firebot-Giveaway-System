module.exports = async function verifyFormLayout({ open, openPage, definitions, root }) {
    const paint = async () => {
        root.$digest();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    const wait = async (check) => {
        for (let i = 0; i < 200; i++) {
            if (check()) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw Error('Form layout did not finish loading');
    };
    const create = open(definitions[0], { giveawayTitle: 'Layout Preview' });
    const page = openPage();
    try {
        await wait(() => page.scope.giveaways?.length && window.__msggGiveawayEditor.pending.size === 0);
        await page.scope.selectGiveaway('giveaway_Alpha');
        await page.scope.selectTab('Configuration');
        await wait(() => page.element.querySelector('.msgg-config'));
        const pageForm = angular.element(page.element.querySelector('msgg-giveaway-configuration')).isolateScope();
        for (const [name, scope, element] of [
            ['Create', create.scope, create.element[0]],
            ['Management', pageForm, page.element],
        ]) {
            const form = element.querySelector('.msgg-config');
            const field = (model) =>
                form.querySelector('[model="effect.' + model + '"]') ||
                form.querySelector('[ng-model="effect.' + model + '"]');
            const box = (node) => {
                if (!node) throw Error(name + ': missing layout control');
                return (
                    node.matches('firebot-input,color-picker-input')
                        ? node.firstElementChild
                        : node.closest('.input-group') || node
                ).getBoundingClientRect();
            };
            const full = (model) => {
                const bounds = box(field(model)),
                    available = form.getBoundingClientRect();
                if (
                    bounds.width < available.width * 0.85 ||
                    bounds.left < available.left - 1 ||
                    bounds.right > available.right + 1
                )
                    throw Error(
                        name +
                        ': field is narrowed or overflows: ' +
                        model +
                        ' ' +
                        JSON.stringify({ width: bounds.width, available: available.width }),
                    );
            };
            const absent = (model) => {
                if (field(model)) throw Error(name + ': hidden field still mounted: ' + model);
            };
            const stacked = (models) => {
                let bottom = -Infinity;
                for (const model of models) {
                    full(model);
                    const bounds = box(field(model));
                    if (bounds.top < bottom + 8) throw Error(name + ': fields overlap or have no spacing: ' + model);
                    bottom = bounds.bottom;
                }
            };
            const select = async (section) => {
                scope.selectSection(section);
                await paint();
            };
            const display = async (group) => {
                scope.formView.displayGroup = group;
                await select('Display');
            };
            const colors = async (group) => {
                scope.formView.colorGroup = group;
                await select('Appearance');
            };

            await select('Basics');
            stacked(['giveawayTitle', 'prize', 'category']);
            if (form.querySelector('color-picker-input')) throw Error(name + ': Basics eagerly mounts colors');
            await select('Rules');
            scope.effect.giveawayOptions.allowMultipleEntries = false;
            await paint();
            absent('giveawayOptions.maxEntriesPerUser');
            scope.effect.giveawayOptions.allowMultipleEntries = true;
            await paint();
            full('giveawayOptions.maxEntriesPerUser');
            scope.effect.giveawayOptions.winLimit.maximum = 2;
            scope.effect.giveawayOptions.winLimit.period = 'rolling';
            await paint();
            full('giveawayOptions.winLimit.days');
            if (form.querySelectorAll('[ng-model="effect.giveawayOptions.winLimit.maximum"]').length !== 1)
                throw Error(name + ': duplicate policy controls');
            scope.effect.giveawayOptions.winLimit.maximum = null;
            await paint();
            absent('giveawayOptions.winLimit.days');
            absent('giveawayOptions.winLimit.period');
            full('giveawayOptions.rerollMode');

            await select('Claims & Timing');
            Object.assign(scope.effect.giveawayOptions, {
                claimMode: 'disabled',
                autoClose: false,
                autoRemoveAfterClose: false,
                claimDuration: 321,
            });
            scope.onClaimModeChange();
            await paint();
            for (const model of [
                'giveawayOptions.claimDuration',
                'display.claimTimerUrgentSeconds',
                'giveawayOptions.duration',
                'display.closeTimerUrgentSeconds',
                'giveawayOptions.displayDuration',
            ])
                absent(model);
            full('giveawayOptions.retentionDays');
            Object.assign(scope.effect.giveawayOptions, {
                claimMode: 'timer',
                autoClose: true,
                autoRemoveAfterClose: true,
            });
            scope.onClaimModeChange();
            scope.effect.display.showClaimCommand = true;
            await paint();
            stacked([
                'giveawayOptions.claimDuration',
                'display.claimTimerUrgentSeconds',
                'giveawayOptions.duration',
                'display.closeTimerUrgentSeconds',
                'giveawayOptions.displayDuration',
                'giveawayOptions.retentionDays',
            ]);
            if (scope.effect.giveawayOptions.claimDuration !== 321)
                throw Error(name + ': claim mode changes reset the configured duration');
            const toggleBoxes = [...form.querySelectorAll('.controls-fb-inline label')].map((label) =>
                label.getBoundingClientRect(),
            );
            for (let i = 0; i < toggleBoxes.length; i++)
                for (let j = i + 1; j < toggleBoxes.length; j++) {
                    const a = toggleBoxes[i],
                        b = toggleBoxes[j];
                    if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1)
                        throw Error(name + ': inline timing checkboxes overlap');
                }

            await display('Layout & Images');
            scope.effect.display.displayMode = 'widgetOnly';
            scope.onDisplayModeChange();
            await paint();
            full('styles.giveawayScale');
            absent('styles.imageScale');
            full('display.displayMode');
            full('display.widgetMode');
            scope.effect.display.displayMode = 'imageOnly';
            scope.onDisplayModeChange();
            await paint();
            full('styles.imageScale');
            absent('styles.giveawayScale');
            scope.effect.display.displayMode = 'widgetImage';
            scope.effect.styles.imagePlacement = 'above';
            scope.effect.styles.imageMode = 'url';
            scope.onDisplayModeChange();
            await paint();
            full('styles.imageUrl');
            absent('display.animateWinner');
            await display('Text & Visibility');
            if (!field('display.showWinner') || !field('display.showEntryCount'))
                throw Error(name + ': visibility controls are not with text settings');
            absent('display.displayMode');
            absent('display.rotateWinners');
            full('display.prizeVisibility');
            full('display.oddsMode');
            scope.effect.display.showEntryCommand = false;
            scope.effect.display.showClaimCommand = false;
            await paint();
            absent('giveawayOptions.entryCommand');
            absent('display.entryCommandText');
            absent('giveawayOptions.claimCommand');
            absent('display.claimCommandText');
            await display('Animation');
            Object.assign(scope.effect.display, {
                widgetMode: 'full',
                showEntryCommand: true,
                showCloseTimer: true,
                rotateWinners: true,
                slideMode: 'widget',
            });
            scope.onSlideModeChange();
            await paint();
            if (!field('display.animateWinner') || !field('display.rotateWinners'))
                throw Error(name + ': animation toggles missing');
            absent('display.showWinner');
            absent('display.displayMode');
            stacked([
                'display.commandCycleIntervalSeconds',
                'display.pendingWinnerRotationSeconds',
                'display.slideRevealIntervalSeconds',
                'display.slideVisibleSeconds',
            ]);

            scope.effect.display.showImageText = true;
            await colors('General');
            const pair = (left, right) => {
                const a = box(field('styles.' + left)),
                    b = box(field('styles.' + right));
                if (matchMedia('(min-width: 992px)').matches) {
                    if (Math.abs(a.top - b.top) > 1 || a.right > b.left + 1)
                        throw Error(name + ': related color controls are misaligned: ' + left + '/' + right);
                } else if (b.top < a.bottom - 1)
                    throw Error(name + ': color columns do not stack at a narrow viewport');
            };
            pair('backgroundColor', 'accentColor');
            pair('titleColor', 'textColor');
            pair('imageTextColor', 'imageTextPlaceholderColor');
            pair('prizeLabelColor', 'prizeColor');
            scope.effect.display.showImageText = false;
            await paint();
            absent('styles.imageTextColor');
            absent('styles.imageTextPlaceholderColor');
            pair('prizeLabelColor', 'prizeColor');
            await colors('Winners');
            pair('winnerColor', 'shadowColor');
            pair('claimTextColor', 'claimCommandColor');
            if (form.querySelectorAll('[model="effect.styles.oddsColor"]').length !== 1)
                throw Error(name + ': duplicate odds-color editors');
            scope.effect.display.widgetMode = 'ticker';
            scope.onDisplayModeChange();
            await paint();
            absent('styles.winnerColor');
            absent('styles.shadowColor');
            if (form.querySelectorAll('[model="effect.styles.oddsColor"]').length !== 1)
                throw Error(name + ': ticker has duplicate odds-color editors');
            for (const group of ['Entries', 'Timers', 'Status']) await colors(group);
            for (const model of ['statusPausedColor', 'statusClosedColor', 'statusEndedColor']) full('styles.' + model);
            await select('Basics');
            if (form.querySelector('color-picker-input'))
                throw Error(name + ': leaving Appearance retains color controls');
        }
        const manager = open(definitions[1], { mode: 'updatePolicy', giveawayTitle: 'giveaway_Alpha' });
        try {
            await paint();
            const input = manager.element[0].querySelector('[ng-model="effect.giveawayOptions.winLimit.maximum"]');
            if (!input || input.closest('[class*="col-"]'))
                throw Error('Manager policy remains narrowed into a grid cell');
        } finally {
            manager.close();
        }
        return {
            viewport: innerWidth,
            contexts: ['Create', 'Management'],
            checked: 'full-width fields, conditional spacing, grouped colors, lazy sections',
        };
    } finally {
        create.close();
        page.close();
    }
};

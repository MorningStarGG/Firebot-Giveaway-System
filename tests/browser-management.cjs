module.exports = async function management({ openPage, open, definitions, root, delay, baselineTemplate }) {
    const waitFor = async (check, label) => {
        for (let i = 0; i < 150; i++) {
            if (check()) return;
            await delay(20);
        }
        throw Error('Timed out: ' + label);
    };
    const begin = performance.now(),
        baseline = open({ ...definitions[0], template: baselineTemplate }, {}),
        baselineConstructionMs = performance.now() - begin,
        baselinePickers = baseline.element.find('color-picker-input').length;
    baseline.close();
    const page = openPage(),
        s = page.scope;
    const settle = async () => {
        await delay(75);
        await waitFor(() => window.__msggGiveawayEditor.pending.size === 0 && !s.busy, 'UI requests');
        root.$digest();
    };
    await settle();
    if (s.tab !== 'Entries & Winners' || page.element.querySelectorAll('firebot-input,color-picker-input').length)
        throw Error('Initial page built configuration controls');
    const startup = window.requests.filter((r) => ['snapshot', 'rows', 'configuration'].includes(r.action));
    if (startup.some((r) => r.action === 'snapshot')) throw Error('UI still fetches full snapshots');
    const clickTab = async (label) => {
        const button = Array.from(page.element.querySelectorAll('button')).find((b) => b.textContent.trim() === label);
        if (!button) throw Error('Missing tab ' + label);
        button.click();
        await settle();
        if (s.tab !== label) throw Error('Tab did not change: ' + label);
    };
    const input = (selector, value, event = 'input') => {
        const el = page.element.querySelector(selector);
        if (!el) throw Error('Missing input ' + selector);
        el.value = value;
        el.dispatchEvent(new Event(event, { bubbles: true }));
        root.$digest();
    };
    const clickAction = (expression) => {
        const button = Array.from(page.element.querySelectorAll('button')).find(
            (b) => b.getAttribute('ng-click') === expression,
        );
        if (!button) throw Error('Missing action ' + expression);
        button.click();
        root.$digest();
    };
    const choose = async (id) => {
        input('select[aria-label="Select giveaway"]', id, 'change');
        await settle();
    };
    await clickTab('History');
    if (!page.element.querySelector('main table tbody tr')) throw Error('Existing history missing');
    await choose('giveaway_Alpha');
    clickAction('toggleMore()');
    if (!s.more || !page.element.querySelector('button[ng-click="status(\'restart\')"]'))
        throw Error('More controls did not open');
    clickAction('toggleMore()');
    if (s.more) throw Error('More controls did not close');
    await clickTab('Configuration');
    for (const id of ['giveaway_Beta', 'giveaway_Alpha']) {
        await choose(id);
        const form = angular.element(page.element.querySelector('msgg-giveaway-configuration')).isolateScope();
        if (form.effect !== s.draft || form.effect.giveawayTitle !== s.selected.title)
            throw Error('Wrong configuration after selection');
    }
    const section = async (label) => {
        const b = Array.from(page.element.querySelectorAll('.msgg-config button')).find(
            (b) => b.textContent.trim() === label,
        );
        if (!b) throw Error('Missing section ' + label);
        b.click();
        root.$digest();
        await delay(10);
    };
    if (page.element.querySelectorAll('color-picker-input').length) throw Error('Basics mounted color pickers');
    await section('Appearance');
    const colorCount = page.element.querySelectorAll('color-picker-input').length;
    if (colorCount === 0 || colorCount >= 28) throw Error('Appearance did not lazily group pickers');
    await section('Basics');
    if (page.element.querySelectorAll('color-picker-input').length) throw Error('Hidden appearance retained controls');
    s.draft.prize = 'Saved while switching';
    window.replyDelay = (packet) => (packet.action === 'configure' ? 250 : 0);
    const savingAlpha = s.save(false);
    await delay(20);
    await choose('giveaway_Beta');
    await savingAlpha;
    if (s.selectedId !== 'giveaway_Beta' || s.draft.giveawayTitle !== 'Beta')
        throw Error('Late save switched selection or replaced another giveaway draft');
    window.replyDelay = 0;
    await choose('giveaway_Alpha');
    if (s.draft.prize !== 'Saved while switching') throw Error('Late save lost its original draft');
    window.formBenchmark = {
        initialControls: 0,
        basicsControls: page.element.querySelectorAll('firebot-input').length,
        appearanceGroupPickers: colorCount,
        previousDeclaredInputs: 32,
        previousDeclaredColorPickers: 28,
    };
    const basicsStart = performance.now();
    await s.newGiveaway();
    root.$digest();
    window.formBenchmark.basicsConstructionMs = performance.now() - basicsStart;
    window.formBenchmark.baselineConstructionMs = baselineConstructionMs;
    window.formBenchmark.baselineMountedPickers = baselinePickers;
    await settle();
    if (s.draft.styles.giveawayWidth !== '350px' || s.draft.giveawayOptions.claimDuration !== 60)
        throw Error('Shared defaults missing');
    s.draft.giveawayTitle = 'Browser UI';
    s.draft.prize = 'UI prize';
    s.draft.giveawayOptions.allowMultipleEntries = true;
    s.draft.giveawayOptions.maxEntriesPerUser = 3;
    s.draft.giveawayOptions.claimMode = 'enabled';
    s.newTemplate();
    root.$digest();
    clickAction('cancelSaveTemplate()');
    await settle();
    await s.newGiveaway();
    await settle();
    if (s.draft.giveawayTitle !== 'Browser UI' || s.draft.prize !== 'UI prize')
        throw Error('Cancelled library creation replaced a new giveaway draft');
    s.openSaveTemplate();
    root.$digest();
    clickAction('cancelSaveTemplate()');
    if (s.savingTemplate) throw Error('Save-template Cancel did not close');
    s.openSaveTemplate();
    s.templateDetails.name = 'Weekly Game Key';
    await s.saveTemplate();
    await settle();
    await s.save(true);
    await settle();
    if (s.selectedId !== 'giveaway_Browser_UI' || !s.selected) throw Error('Create failed: ' + s.giveawayError);
    const collision = JSON.stringify(s.giveaways);
    await s.newGiveaway();
    s.draft.giveawayTitle = 'Browser UI';
    await s.save(true);
    if (!s.giveawayError.includes('already exists') || JSON.stringify(s.giveaways) !== collision)
        throw Error('New giveaway collision was not rejected');
    await choose('giveaway_Browser_UI');
    await clickTab('Entries & Winners');
    const before = window.requests.length;
    s.entry.username = 'UIAlice';
    await s.addEntry();
    await settle();
    const loads = window.requests.slice(before).filter((r) => r.action === 'rows');
    if (loads.length !== 1 || loads[0].payload.area !== 'entries')
        throw Error('Entry caused redundant/unrelated page reads: ' + JSON.stringify(loads));
    s.panes.entries.pages = 2;
    s.panes.entries.page = 2;
    await s.changePage('entries', 0);
    if (s.panes.entries.page !== 1 || s.panes.entries.loading)
        throw Error('Clamped page left a loading indicator stuck');
    window.replyDelay = (packet) => (packet.action === 'dashboard' ? 250 : 0);
    const slowRefresh = s.refresh();
    await delay(20);
    s.entry.username = 'RaceUser';
    await s.addEntry();
    await slowRefresh;
    await delay(350);
    await settle();
    if (s.selected.entryCount !== 2) throw Error('Stale summary overwrote a newer entry notification');
    window.replyDelay = 0;
    await s.removeEntry('RaceUser');
    await settle();
    s.entry.username = 'UIAlice';
    await s.addEntry();
    s.entry.autoApprove = false;
    await s.pick();
    await settle();
    if (s.panes.entries.total !== 1 || s.panes.pending.total !== 1) throw Error('Draw did not update rows');
    await s.inspectUser();
    if (s.eligibility.eligibleEntries !== 0 || !s.eligibility.held) throw Error('Eligibility missing pending hold');
    const win = s.panes.pending.rows[0];
    await s.winnerAction('claim', win);
    await s.winnerAction('approve', win);
    await settle();
    if (s.panes.winners.total !== 1) throw Error('Approve failed');
    await clickTab('History');
    if (
        !Array.from(page.element.querySelectorAll('main table tbody tr')).some((r) => r.textContent.includes('uialice'))
    )
        throw Error('Approved history missing');
    input('select[aria-label="History management action"]', 'purgeUserOlderThan', 'change');
    input('input[aria-label="Username whose display history should be purged"]', 'UIAlice');
    input('input[aria-label="History period in days"]', '999');
    window.confirmResult = true;
    await s.historyAction('purgeUserOlderThan');
    await settle();
    const history = window.requests.filter((r) => r.action === 'manage' && r.payload.mode === 'winnerHistory').at(-1);
    if (history.payload.winnerHistoryUsername !== 'UIAlice' || history.payload.winnerHistoryValue !== 999)
        throw Error('History inputs lost');
    input('input[aria-label="Search history"]', 'UIAlice');
    await delay(230);
    await settle();
    if (s.panes.history.total !== 1) throw Error('Paged history search failed');
    await clickTab('Configuration');
    s.draft.prize = 'Unsaved';
    await s.refresh();
    if (s.draft.prize !== 'Unsaved') throw Error('Refresh clobbered draft');
    await clickTab('Templates');
    const template = s.panes.templates.rows.find((r) => r.name === 'Weekly Game Key');
    if (!template) throw Error('Saved template missing');
    await s.renameTemplate(template.id, template.name);
    root.$digest();
    clickAction('cancelRename()');
    if (s.rename) throw Error('Rename Cancel did not close');
    s.selectedTemplates[template.id] = true;
    clickAction('clearTemplateSelection()');
    if (Object.values(s.selectedTemplates).some(Boolean)) throw Error('Selection did not clear');
    await s.previewTemplate(template.id, 'existing');
    root.$digest();
    clickAction('cancelTemplatePreview()');
    if (s.templatePreview) throw Error('Template preview Cancel did not close');
    await s.previewTemplate(template.id, 'existing');
    await s.usePreview();
    await settle();
    window.confirmResult = false;
    const requests = window.requests.length;
    await s.save(false);
    if (window.requests.slice(requests).some((r) => r.action === 'configure'))
        throw Error('Cancelled template applied');
    window.confirmResult = new Promise((resolve) => {
        window.resolveConfirmation = resolve;
    });
    const awaitingConfirmation = s.save(false);
    await choose('giveaway_Beta');
    window.resolveConfirmation(true);
    await awaitingConfirmation;
    if (window.requests.slice(requests).some((r) => r.action === 'configure'))
        throw Error('Changing selection during confirmation saved the wrong target');
    await choose('giveaway_Browser_UI');
    window.confirmResult = true;
    await s.save(false);
    await settle();
    await clickTab('Entries & Winners');
    if (s.panes.entries.total !== 1 || s.panes.winners.total !== 1) throw Error('Template altered run data');
    // File import exercises the actual File input directive and image bundle parser.
    await clickTab('Templates');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLTsAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
        hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
            .map((x) => x.toString(16).padStart(2, '0'))
            .join('');
    const record = await (
        await fetch('/test/ipc', {
            method: 'POST',
            body: JSON.stringify({ requestId: 'test-template', action: 'template', payload: { id: template.id } }),
        })
    ).json();
    const cfg = record.result.configuration;
    cfg.styles.imageMode = 'local';
    cfg.styles.imageFile = '';
    const bundle = {
        format: 'msgg:giveaway-templates',
        version: 1,
        templates: [{ name: 'Image Template', description: 'Portable PNG', configuration: cfg, image: hash }],
        assets: { [hash]: { type: 'png', data: png } },
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(bundle)], 'template.json', { type: 'application/json' }));
    const fileInput = page.element.querySelector('input[type="file"]');
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    if (!s.importPreview?.[0].hasImage) throw Error('File/image import preview missing');
    window.confirmResult = false;
    await s.commitImport();
    if (s.panes.templates.total !== 1) throw Error('Cancel committed import');
    window.confirmResult = true;
    await s.commitImport();
    await settle();
    if (s.panes.templates.total !== 2) throw Error('Import did not commit');
    // Capture the browser Blob download rather than writing into the user's Downloads directory.
    window.exportedFiles = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
            void fetch(this.href)
                .then((r) => r.text())
                .then((text) => window.exportedFiles.push({ name: this.download, text }));
            return;
        }
        return originalClick.call(this);
    };
    await s.exportTemplates();
    await waitFor(() => window.exportedFiles.length === 1, 'export Blob');
    const exported = JSON.parse(window.exportedFiles[0].text);
    if (exported.templates.length !== 2 || !exported.assets[hash]) throw Error('Export omitted template or image');
    HTMLAnchorElement.prototype.click = originalClick;
    // Loading a template copies only configuration into a saved Firebot effect.
    const effect = open(definitions[0], {
        id: 'effect-123',
        type: 'msgg:giveaway-system',
        giveawayTitle: 'Command Target',
        overlayInstance: 'Elsewhere',
        styles: { accentColor: '#ffffff' },
    });
    await delay(30);
    window.confirmResult = false;
    await effect.scope.loadTemplateIntoEffect(template.id);
    if (effect.scope.effect.styles.accentColor !== '#ffffff') throw Error('Cancel overwrote effect');
    window.confirmResult = true;
    await effect.scope.loadTemplateIntoEffect(template.id);
    if (
        effect.scope.effect.id !== 'effect-123' ||
        effect.scope.effect.giveawayTitle !== 'Command Target' ||
        effect.scope.effect.overlayInstance !== 'Elsewhere' ||
        effect.scope.effect.prize !== 'UI prize'
    )
        throw Error('Effect template copy lost identity/settings');
    const copied = JSON.stringify(effect.scope.effect);
    await s.renameTemplate(template.id, 'unused');
    s.rename.name = 'Renamed Template';
    await s.commitRename();
    if (JSON.stringify(effect.scope.effect) !== copied) throw Error('Template edits altered saved effect copy');
    effect.close();
    await s.selectGiveaway('giveaway_Browser_UI');
    await settle();
    await clickTab('Entries & Winners');
    s.entry.username = 'UIAlice';
    await s.addEntry(); // Third admission: the last one allowed by this giveaway.
    await settle();
    const entryTotal = s.panes.entries.total,
        beforeRejection = window.requests.length;
    await s.addEntry();
    await settle();
    if (s.notice !== 'You have reached the entry limit for this run.' || s.panes.entries.total !== entryTotal)
        throw Error('Rejected entry did not show its explanation or changed the pool');
    if (window.requests.slice(beforeRejection).some((r) => ['rows', 'dashboard', 'configuration'].includes(r.action)))
        throw Error('Rejected entry refreshed unrelated stored state');
    page.close();
    const reopened = openPage();
    await delay(100);
    await waitFor(() => reopened.scope.selectedId === 'giveaway_Browser_UI', 'remembered giveaway');
    if (
        reopened.scope.tab !== 'Entries & Winners' ||
        reopened.element.querySelectorAll('firebot-input,color-picker-input').length
    )
        throw Error('Restored page eagerly created form');
    await delay(70);
    reopened.close();
    await delay(20);
    if (window.__msggGiveawayEditor.pending.size || window.__msggGiveawayEditor.subscriptions.size)
        throw Error('Renderer leaked requests/subscriptions');
    if (new Set(window.requests.map((r) => r.requestId)).size !== window.requests.length)
        throw Error('Request IDs reused');
};

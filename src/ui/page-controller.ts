import { withEditor } from '../utility/renderer-callback';
import { defaultConfiguration } from '../shared/configuration';

export const pageController = withEditor(
    ['$scope', 'backendCommunicator', 'utilityService'],
    (editor: any, $scope: any, client: any, utility: any, defaults: any) => {
        const copy = (value: any) => JSON.parse(JSON.stringify(value));
        $scope.effect = {};
        $scope.silentRequestErrors = true;
        $scope.giveaways = [];
        $scope.selectedId = '';
        $scope.tab = 'Entries & Winners';
        $scope.more = false;
        $scope.entry = { username: '', weight: 1, count: 1, autoApprove: false };
        $scope.historyOptions = { choice: 'setRetention', username: '', days: 30 };
        $scope.templateDetails = { name: '', description: '' };
        $scope.selectedTemplates = {};
        $scope.templateEditorId = '';
        $scope.panes = {};
        for (const area of ['entries', 'pending', 'winners', 'history', 'backups', 'templates'])
            $scope.panes[area] = { area, rows: [], search: '', page: 1, pages: 1, total: 0 };
        const drafts = new Map<string, any>(),
            bases = new Map<string, string>(),
            applied = new Map<string, number>(),
            dirty = new Map<string, number>(),
            desired = new Map<string, number>(),
            inflight = new Map<string, Promise<any>>(),
            templateApplied = new Map<string, string>();
        let generation = '',
            lastRevision = 0,
            refreshTimer: any,
            destroyed = false,
            pendingImport = '',
            fileSequence = 0;
        const searchTimers = new Map<string, any>();
        const request = (action: string, payload: any = {}) => client.fireEventAsync(action, payload);
        const once = (action: string, payload: any = {}) => {
            const key = JSON.stringify([action, payload]);
            if (inflight.has(key)) return inflight.get(key)!;
            const task = request(action, payload).finally(() => inflight.delete(key));
            inflight.set(key, task);
            return task;
        };
        const error = (e: any) => {
            if (!destroyed && e.name !== 'AbortError') {
                $scope.giveawayError = e.message;
                $scope.$evalAsync();
            }
        };
        const selected = () => {
            $scope.selected = $scope.giveaways.find((g: any) => g.id === $scope.selectedId);
        };
        const active = (area: string) =>
            area === 'summary' ||
            ($scope.tab === 'Entries & Winners' &&
                !!$scope.selectedId &&
                ['entries', 'pending', 'winners'].includes(area)) ||
            ($scope.tab === 'History' && area === 'history') ||
            ($scope.tab === 'Backups' && area === 'backups') ||
            ($scope.tab === 'Templates' && area === 'templates');
        const rowKey = (area: string) =>
            JSON.stringify([
                area,
                ['entries', 'pending', 'winners'].includes(area) ? $scope.selectedId : '',
                $scope.panes[area]?.page,
                $scope.panes[area]?.search,
            ]);
        const readDashboard = async () => {
            const data = await once('dashboard');
            if (destroyed) return data;
            if (data.revision < (desired.get('summary') || 0)) return data;
            const previous = $scope.selectedId;
            $scope.giveaways = data.giveaways;
            selected();
            if (previous && !$scope.selected) {
                $scope.selectedId = '';
                $scope.draft = undefined;
                $scope.templatePreview = null;
            }
            $scope.historyOptions.days ??= data.historyRetentionDays;
            if (!generation || generation !== data.generation) {
                generation = data.generation;
                applied.clear();
            }
            $scope.profileGeneration = generation;
            applied.set('summary', data.revision);
            $scope.$evalAsync();
            return data;
        };
        const loadRows = async (area: string) => {
            const pane = $scope.panes[area],
                key = rowKey(area),
                query = {
                    area,
                    id: ['entries', 'pending', 'winners'].includes(area) ? $scope.selectedId : undefined,
                    page: pane.page,
                    search: pane.search,
                    pageSize: 50,
                };
            pane.loading = true;
            pane.requestKey = key;
            try {
                const data = await once('rows', query);
                if (destroyed || rowKey(area) !== key) return false;
                if (data.revision < (desired.get(area) || 0)) return true;
                Object.assign(pane, data);
                applied.set(rowKey(area), data.revision);
                return true;
            } catch (e) {
                if (rowKey(area) === key) error(e);
                return false;
            } finally {
                if (pane.requestKey === key) pane.loading = false;
                $scope.$evalAsync();
            }
        };
        const flush = async () => {
            clearTimeout(refreshTimer);
            refreshTimer = undefined;
            const work: any[] = [];
            for (const [area, revision] of dirty) {
                if (!active(area)) continue;
                const key = area === 'summary' ? 'summary' : rowKey(area);
                if ((applied.get(key) ?? -1) >= revision) {
                    dirty.delete(area);
                    continue;
                }
                dirty.delete(area);
                work.push(
                    (async () => {
                        try {
                            const loaded = await (area === 'summary' ? readDashboard() : loadRows(area));
                            if (
                                loaded !== false &&
                                active(area) &&
                                (area === 'summary' || rowKey(area) === key) &&
                                (applied.get(key) ?? -1) < revision
                            ) {
                                dirty.set(area, Math.max(revision, dirty.get(area) || 0));
                                schedule();
                            }
                        } catch (e) {
                            error(e);
                        }
                    })(),
                );
            }
            await Promise.all(work);
        };
        const schedule = () => {
            if (!refreshTimer && !destroyed)
                refreshTimer = setTimeout(() => {
                    void flush();
                }, 40);
        };
        const changed = (change: any) => {
            if (destroyed) return;
            if (!change?.areas) {
                for (const area of ['summary', 'entries', 'pending', 'winners', 'history', 'backups', 'templates']) {
                    applied.delete(area === 'summary' ? 'summary' : rowKey(area));
                    dirty.set(area, lastRevision);
                }
                schedule();
                return;
            }
            if (generation && change.generation !== generation) {
                applied.clear();
                desired.clear();
                generation = change.generation;
            }
            lastRevision = Math.max(lastRevision, change.revision);
            for (const area of change.areas) {
                if (area === 'configuration') {
                    if (!drafts.has($scope.selectedId)) bases.delete($scope.selectedId);
                    continue;
                }
                if (
                    ['entries', 'pending', 'winners'].includes(area) &&
                    change.giveawayIds?.length &&
                    !change.giveawayIds.includes($scope.selectedId)
                )
                    continue;
                desired.set(area, Math.max(change.revision, desired.get(area) || 0));
                const key = area === 'summary' ? 'summary' : rowKey(area);
                if ((applied.get(key) ?? -1) < change.revision)
                    dirty.set(area, Math.max(change.revision, dirty.get(area) || 0));
            }
            schedule();
        };
        const loadConfiguration = async (id: string, reload = false) => {
            if (!reload && drafts.has(id)) return drafts.get(id);
            const result = await once('configuration', { id });
            const draft = copy(result.configuration);
            drafts.set(id, draft);
            bases.set(id, result.configRevision);
            return draft;
        };
        const ensureConfiguration = async () => {
            const id = $scope.selectedId;
            $scope.configurationLoading = true;
            try {
                const draft = id ? await loadConfiguration(id) : drafts.get('') || copy(defaults);
                drafts.set(id, draft);
                if (id === $scope.selectedId && !$scope.templateEditorId) $scope.draft = draft;
            } catch (e) {
                if (id === $scope.selectedId) error(e);
            } finally {
                $scope.configurationLoading = false;
                $scope.$evalAsync();
            }
        };
        $scope.refresh = async () => {
            for (const area of ['summary', 'entries', 'pending', 'winners', 'history', 'backups', 'templates'])
                if (active(area)) {
                    applied.delete(area === 'summary' ? 'summary' : rowKey(area));
                    dirty.set(area, lastRevision);
                }
            await flush();
        };
        $scope.selectTab = async (tab: string) => {
            $scope.tab = tab;
            $scope.more = false;
            if (tab === 'Configuration' && !$scope.templateEditorId) await ensureConfiguration();
            for (const area of ['entries', 'pending', 'winners', 'history', 'backups', 'templates'])
                if (active(area) && (!applied.has(rowKey(area)) || dirty.has(area))) dirty.set(area, lastRevision);
            await flush();
        };
        $scope.selectGiveaway = async (id: string) => {
            $scope.selectedId = id || '';
            $scope.templatePreview = null;
            $scope.templateEditorId = '';
            $scope.savingTemplate = false;
            $scope.creatingTemplate = false;
            $scope.eligibility = null;
            selected();
            for (const a of ['entries', 'pending', 'winners']) $scope.panes[a].page = 1;
            if (id) void request('rememberSelection', { id }).catch(error);
            if ($scope.tab === 'Configuration') await ensureConfiguration();
            for (const a of ['entries', 'pending', 'winners'])
                if (active(a)) {
                    applied.delete(rowKey(a));
                    dirty.set(a, lastRevision);
                }
            await flush();
        };
        $scope.newGiveaway = async () => {
            $scope.templateEditorId = '';
            $scope.savingTemplate = false;
            $scope.creatingTemplate = false;
            $scope.selectedId = '';
            $scope.selected = undefined;
            $scope.draft = copy(drafts.get('') || defaults);
            drafts.set('', $scope.draft);
            await $scope.selectTab('Configuration');
        };
        $scope.discardDraft = async () => {
            const id = $scope.selectedId;
            if (!id) return;
            try {
                $scope.draft = await loadConfiguration(id, true);
                templateApplied.delete(id);
            } catch (e) {
                error(e);
            }
            $scope.$evalAsync();
        };
        $scope.changePage = async (area: string, delta: number) => {
            const pane = $scope.panes[area];
            pane.page = Math.max(1, Math.min(pane.pages, pane.page + delta));
            await loadRows(area);
        };
        $scope.searchRows = (area: string) => {
            clearTimeout(searchTimers.get(area));
            searchTimers.set(
                area,
                setTimeout(() => {
                    $scope.panes[area].page = 1;
                    void loadRows(area);
                }, 200),
            );
        };
        const execute = async (action: string, payload: any) => {
            $scope.busy = true;
            $scope.giveawayError = '';
            $scope.notice = '';
            try {
                const result = await request(action, payload);
                if (result?.change) changed(result.change);
                return result;
            } catch (e) {
                error(e);
                return null;
            } finally {
                $scope.busy = false;
                $scope.$evalAsync();
            }
        };
        const confirm = async (title: string, question: string) => {
            const id = $scope.selectedId;
            const accepted = await utility.showConfirmationModal({
                title,
                question,
                confirmLabel: title,
                cancelLabel: 'Cancel',
            });
            return accepted && !destroyed && id === $scope.selectedId;
        };
        $scope.toggleMore = () => {
            $scope.more = !$scope.more;
        };
        const manage = (payload: any) =>
            execute('manage', { giveawayTitle: $scope.selectedId, giveawaySelectionMode: 'giveawayList', ...payload });
        $scope.save = async (start: boolean) => {
            const draft = $scope.draft,
                effect = copy(draft);
            if ($scope.templateEditorId) {
                await $scope.saveTemplate();
                return;
            }
            const id = $scope.selectedId;
            if (
                id &&
                templateApplied.has(id) &&
                !(await confirm(
                    'Apply Template',
                    'Save ' +
                    templateApplied.get(id) +
                    ' to ' +
                    $scope.selected.title +
                    '? Entries and winners stay, changed claim timers and win rules apply when saved.',
                ))
            )
                return;
            if (id !== $scope.selectedId || draft !== $scope.draft) return;
            const result = await execute('configure', {
                effect,
                id: id || undefined,
                start,
                createOnly: !id,
                expectedRevision: id ? bases.get(id) : undefined,
            });
            if (result) {
                if (!drafts.has(result.id) || drafts.get(result.id) === draft) {
                    bases.set(result.id, result.configRevision);
                    drafts.set(result.id, draft);
                }
                if (drafts.get(id) === draft) templateApplied.delete(id);
                const current = id === $scope.selectedId && draft === $scope.draft;
                if (current) {
                    $scope.selectedId = result.id;
                    void request('rememberSelection', { id: result.id }).catch(error);
                }
                await flush();
                selected();
                if (current && result.id === $scope.selectedId && draft === $scope.draft)
                    $scope.notice = start ? 'Giveaway created and started' : 'Configuration saved';
            }
        };
        $scope.status = async (action: string) => {
            if (
                ['reset', 'remove'].includes(action) &&
                !(await confirm(
                    action === 'reset' ? 'Reset Run' : 'Remove & Back Up',
                    action === 'reset'
                        ? 'Clear entries and winners and begin a new run? Approval history is retained.'
                        : 'Remove this giveaway and save a backup?',
                ))
            )
                return;
            await manage({ mode: 'giveawayStatusControl', statusAction: action });
            await flush();
            if (!$scope.selected) {
                $scope.selectedId = '';
                $scope.draft = undefined;
            }
        };
        $scope.visibility = (action: string) => manage({ mode: 'toggleVisibility', visibilityAction: action });
        $scope.addEntry = async () => {
            const id = $scope.selectedId;
            const result = await manage({
                mode: 'entryManagement',
                entryAction: 'add',
                username: $scope.entry.username,
                oddsMultiplier: $scope.entry.weight,
            });
            if (result && id === $scope.selectedId) {
                $scope.notice = result.outputs.entryReasonText;
                $scope.$evalAsync();
            }
        };
        $scope.removeEntry = (name: string) =>
            manage({ mode: 'entryManagement', entryAction: 'remove', username: name, removeAllEntries: false });
        $scope.pick = async () => {
            const r = await manage({
                mode: 'entryManagement',
                entryAction: 'pick',
                winnerCount: $scope.entry.count,
                autoApproveMulti: $scope.entry.autoApprove,
            });
            if (r) $scope.notice = 'Picked: ' + r.outputs.winner;
        };
        $scope.winnerAction = async (action: string, win: any) => {
            if (
                ['deny', 'reroll'].includes(action) &&
                !(await confirm(
                    action === 'deny' ? 'Deny Win' : 'Reroll Winner',
                    action === 'deny'
                        ? 'Deny this win, or revoke its approval?'
                        : 'Skip this win and attempt a replacement? The skip is retained when none is eligible.',
                ))
            )
                return;
            const r = await manage({ mode: 'entryManagement', entryAction: action, winId: win.winId });
            if (r && action === 'reroll')
                $scope.notice = r.outputs.winner
                    ? 'Replacement: ' + r.outputs.winner
                    : 'Win skipped, no eligible replacement';
        };
        $scope.inspectUser = async () => {
            $scope.eligibility = await execute('eligibility', {
                id: $scope.selectedId,
                username: $scope.entry.username,
            });
        };
        $scope.clearEntries = async () => {
            if (await confirm('Clear Pool', 'Remove pool entries? This does not refund admission allowances.'))
                await manage({ mode: 'clearEntries' });
        };
        $scope.resetCounts = async () => {
            if (
                await confirm(
                    'Reset Win Counts',
                    'Reset only this giveaway policy’s baseline? Other giveaways and history retain their counts.',
                )
            )
                await manage({ mode: 'resetWinCounts' });
        };
        $scope.historyAction = async (action: string) => {
            if (
                action !== 'setRetention' &&
                !(await confirm(
                    'Purge Display History',
                    'Remove the selected display history? Win-limit accounting is retained.',
                ))
            )
                return;
            await execute('manage', {
                mode: 'winnerHistory',
                winnerHistoryAction: action,
                winnerHistoryValue: $scope.historyOptions.days,
                winnerHistoryUsername: $scope.historyOptions.username,
                winnerHistoryUnit: 'days',
            });
        };
        $scope.restore = async (id: string, mode: string) => {
            if (
                !(await confirm(
                    mode === 'merge' ? 'Merge' : 'Replace',
                    mode === 'merge'
                        ? 'Merge eligible backup entries? Skipped records retain the backup.'
                        : 'Restore this backup and replace any current giveaway with this ID?',
                ))
            )
                return;
            const r = await execute('restoreGiveaway', { backupId: id, mode });
            if (r)
                $scope.notice = r.retained ? 'Backup retained: ' + r.skipped + ' records skipped' : 'Backup restored';
        };
        $scope.deleteBackup = async (id: string) => {
            if (await confirm('Delete Backup', 'Permanently delete this backup?')) {
                await execute('removeBackup', { giveawayId: id });
                applied.delete(rowKey('backups'));
                dirty.set('backups', lastRevision);
                await flush();
            }
        };

        $scope.openSaveTemplate = () => {
            $scope.savingTemplate = true;
            $scope.templateDetails = { name: $scope.draft?.giveawayTitle || '', description: '' };
        };
        $scope.cancelSaveTemplate = () => {
            $scope.savingTemplate = false;
            if ($scope.creatingTemplate) {
                $scope.creatingTemplate = false;
                void $scope.selectTab('Templates');
            }
        };
        $scope.saveTemplate = async () => {
            const draft = $scope.draft,
                id = $scope.templateEditorId,
                details = copy($scope.templateDetails),
                configuration = copy(draft);
            if (
                id &&
                !(await confirm(
                    'Update Template',
                    'Replace this library template’s saved configuration? Existing effects and giveaways keep their copies.',
                ))
            )
                return;
            if (draft !== $scope.draft || id !== $scope.templateEditorId) return;
            const r = await execute('saveTemplate', {
                id: id || undefined,
                name: details.name,
                description: details.description,
                configuration,
            });
            if (r && draft === $scope.draft && id === $scope.templateEditorId) {
                if ($scope.creatingTemplate) {
                    $scope.templateEditorId = r.id;
                    $scope.creatingTemplate = false;
                }
                $scope.savingTemplate = false;
                $scope.notice = 'Template saved';
            }
        };
        $scope.editTemplate = async (id: string) => {
            try {
                const t = await request('template', { id });
                $scope.templateEditorId = id;
                $scope.templateDetails = { name: t.name, description: t.description };
                $scope.draft = copy(t.configuration);
                $scope.tab = 'Configuration';
            } catch (e) {
                error(e);
            }
            $scope.$evalAsync();
        };
        $scope.newTemplate = () => {
            $scope.creatingTemplate = true;
            $scope.templateEditorId = '';
            $scope.savingTemplate = true;
            $scope.templateDetails = { name: '', description: '' };
            $scope.selectedId = '';
            $scope.selected = undefined;
            $scope.draft = copy(defaults);
            $scope.tab = 'Configuration';
        };
        $scope.duplicateTemplate = async (id: string) => {
            try {
                const t = await request('template', { id });
                $scope.templateEditorId = '';
                $scope.creatingTemplate = true;
                $scope.templateDetails = { name: t.name + ' Copy', description: t.description };
                $scope.draft = copy(t.configuration);
                $scope.savingTemplate = true;
                $scope.selectedId = '';
                $scope.selected = undefined;
                $scope.tab = 'Configuration';
            } catch (e) {
                error(e);
            }
            $scope.$evalAsync();
        };
        $scope.renameTemplate = async (id: string, name: string) => {
            const value = $scope.panes.templates.rows.find((t: any) => t.id === id);
            $scope.rename = { id, name: value?.name || name };
        };
        $scope.commitRename = async () => {
            const r = await execute('renameTemplate', $scope.rename);
            if (r) $scope.rename = null;
        };
        $scope.cancelRename = () => {
            $scope.rename = null;
        };
        $scope.deleteTemplate = async (id: string) => {
            if (
                await confirm(
                    'Delete Template',
                    'Delete this library template? Existing giveaways, effects, and shared images are retained.',
                )
            )
                if (await execute('deleteTemplate', { id })) delete $scope.selectedTemplates[id];
        };
        const diff = (a: any, b: any, prefix = '', rows: any[] = []): any[] => {
            for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
                const x = a?.[k],
                    y = b?.[k],
                    field = prefix ? prefix + '.' + k : k;
                if (x && y && typeof x === 'object' && typeof y === 'object') diff(x, y, field, rows);
                else if (JSON.stringify(x) !== JSON.stringify(y))
                    rows.push({ field, before: JSON.stringify(x) ?? '—', after: JSON.stringify(y) ?? '—' });
            }
            return rows;
        };
        $scope.cancelTemplatePreview = () => {
            $scope.templatePreview = null;
        };
        $scope.previewTemplate = async (id: string, target: string) => {
            const targetId = $scope.selectedId;
            try {
                const t = await request('template', { id });
                if (target === 'existing' && targetId !== $scope.selectedId) return;
                const configuration = copy(t.configuration);
                let current = copy(defaults);
                if (target === 'existing') {
                    if (!$scope.selectedId) throw Error('Select a giveaway first');
                    current = await loadConfiguration($scope.selectedId);
                    if (targetId !== $scope.selectedId) return;
                    configuration.giveawayTitle = current.giveawayTitle;
                    configuration.overlayInstance = current.overlayInstance;
                } else configuration.overlayInstance = '';
                $scope.templatePreview = {
                    id,
                    name: t.name,
                    target,
                    configuration,
                    changes: diff(current, configuration),
                };
            } catch (e) {
                error(e);
            }
            $scope.$evalAsync();
        };
        $scope.usePreview = async () => {
            const p = $scope.templatePreview;
            if (!p) return;
            const id = p.target === 'existing' ? $scope.selectedId : '';
            if (!id) {
                $scope.selectedId = '';
                $scope.selected = undefined;
            } else templateApplied.set(id, p.name);
            $scope.templateEditorId = '';
            $scope.draft = copy(p.configuration);
            drafts.set(id, $scope.draft);
            $scope.templatePreview = null;
            $scope.savingTemplate = false;
            await $scope.selectTab('Configuration');
        };
        const download = (text: string, filename: string) => {
            const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        $scope.exportSelected = () => {
            const ids = Object.keys($scope.selectedTemplates).filter((id) => $scope.selectedTemplates[id]);
            if (!ids.length) {
                $scope.giveawayError = 'Select one or more templates';
                return;
            }
            $scope.exportTemplates(ids);
        };
        $scope.clearTemplateSelection = () => {
            $scope.selectedTemplates = {};
        };
        $scope.exportTemplates = async (ids?: string[]) => {
            const r = await execute('exportTemplates', { ids });
            if (r) download(r.text, r.filename);
        };
        $scope.importFile = async (text: string, fileError?: string) => {
            const sequence = ++fileSequence;
            if (fileError) {
                $scope.giveawayError = fileError;
                return;
            }
            const preview = await execute('previewImport', { text });
            if (sequence !== fileSequence) return;
            if (preview) {
                pendingImport = text;
                $scope.importPreview = preview.map((row: any) => ({
                    ...row,
                    action: 'copy',
                    targetId: row.conflicts[0]?.id || '',
                }));
            }
        };
        $scope.cancelImport = () => {
            fileSequence++;
            pendingImport = '';
            $scope.importPreview = null;
        };
        $scope.commitImport = async () => {
            if (
                !(await confirm(
                    'Import Templates',
                    'Commit these library changes? Giveaways will not start or change.',
                ))
            )
                return;
            const r = await execute('importTemplates', {
                text: pendingImport,
                choices: $scope.importPreview.map((r: any) => ({
                    index: r.index,
                    action: r.action,
                    targetId: r.targetId,
                })),
            });
            if (r) {
                $scope.cancelImport();
                $scope.notice = r.count + ' templates imported';
            }
        };
        $scope.$on('$destroy', () => {
            destroyed = true;
            clearTimeout(refreshTimer);
            for (const timer of searchTimers.values()) clearTimeout(timer);
            pendingImport = '';
        });
        client.on('changed', changed);
        editor.captureDefaults();
        void (async () => {
            try {
                const data = await readDashboard();
                $scope.historyOptions.days = data.historyRetentionDays;
                if (data.giveaways.some((g: any) => g.id === data.selectedId))
                    await $scope.selectGiveaway(data.selectedId);
            } catch (e) {
                error(e);
            }
            $scope.$evalAsync();
        })();
    },
    defaultConfiguration,
);

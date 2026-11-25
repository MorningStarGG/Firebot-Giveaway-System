import type { EffectType } from '@crowbartools/firebot-types';
import { backup, runOperation } from '../plugin-runtime';
import type { BackupEffectModel } from '../types/types';
import template from '../templates/backup-template.html';
import { withEditor } from '../utility/renderer-callback';
export function giveawaySystemBackupEffectType(): EffectType<BackupEffectModel> {
    return {
        definition: {
            id: 'msgg:giveaway-system-backup',
            name: 'Advanced Giveaway Backup Manager',
            description: 'Restore or remove giveaway backups',
            icon: 'fad fa-archive',
            categories: ['overlay'],
        },
        optionsTemplate: template,
        optionsController: withEditor(
            ['$scope', 'backendCommunicator', 'utilityService'],
            (editor: any, $scope: any, backendCommunicator: any, utilityService: any) => {
                $scope.effect ||= {};
                $scope.effect.giveawaySelectionMode ??= 'giveawayList';
                $scope.effect.action ??= 'restore';
                $scope.restoreMode = 'overwrite';
                const refresh = () => {
                    $scope.loading = true;
                    backendCommunicator
                        .fireEventAsync('getBackupGiveaways')
                        .then((rows: any) => {
                            $scope.backupGiveaways = rows;
                        })
                        .catch((e: Error) => {
                            $scope.giveawayError = e.message;
                        })
                        .finally(() => {
                            $scope.loading = false;
                            $scope.$evalAsync();
                        });
                };
                $scope.restoreGiveaway = async (backupId: string) => {
                    const mode = $scope.restoreMode;
                    const yes = await utilityService.showConfirmationModal({
                        title: mode === 'merge' ? 'Merge Backup' : 'Replace Giveaway',
                        question:
                            mode === 'merge'
                                ? 'Merge entries into the current giveaway? Skipped entries keep this backup available.'
                                : 'Restore this backup, replacing the current giveaway if present?',
                        confirmLabel: mode === 'merge' ? 'Merge' : 'Replace',
                        cancelLabel: 'Cancel',
                    });
                    if (!yes) return;
                    try {
                        const result = await backendCommunicator.fireEventAsync('restoreGiveaway', { backupId, mode });
                        $scope.backupNotice = result.retained
                            ? 'Backup retained: ' + result.skipped + ' records could not be imported.'
                            : 'Backup restored';
                        refresh();
                    } catch (e: any) {
                        $scope.giveawayError = e.message;
                        $scope.$evalAsync();
                    }
                };
                $scope.deleteBackup = async (giveawayId: string) => {
                    if (
                        !(await utilityService.showConfirmationModal({
                            title: 'Delete Backup',
                            question: 'Permanently delete this backup?',
                            confirmLabel: 'Delete',
                            cancelLabel: 'Cancel',
                        }))
                    )
                        return;
                    try {
                        await backendCommunicator.fireEventAsync('removeBackup', { giveawayId });
                        refresh();
                    } catch (error: any) {
                        $scope.giveawayError = error.message;
                        $scope.$evalAsync();
                    }
                };
                backendCommunicator.on('changed', refresh);
                $scope.effectValueChanged = refresh;
                $scope.$watch('effect.giveawaySelectionMode', refresh);
                editor.captureDefaults();
                refresh();
            },
        ),
        optionsValidator: (effect) =>
            effect.giveawaySelectionMode === 'manual' && !effect.manualGiveawayTitle
                ? ['Provide a giveaway title or backup ID']
                : [],
        onTriggerEvent: (event) => runOperation(() => backup(event.effect)),
    };
}

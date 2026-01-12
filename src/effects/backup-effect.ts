import { Firebot } from "@crowbartools/firebot-custom-scripts-types";
import backupTemplate from "../templates/backup-template.html";
import { logger } from "../logger";
import { giveawayManager } from "../utility/giveaway-manager";
import { BackupEffectModel, BackupGiveaway } from "../types/types";

/**
 * Giveaway backup manager effect
 */
export function giveawaySystemBackupEffectType() {
    const backupEffectType: Firebot.EffectType<BackupEffectModel> = {
        definition: {
            id: "msgg:giveaway-system-backup",
            name: "Advanced Giveaway Backup Manager",
            description: "View and restore backed up giveaways",
            icon: "fad fa-archive",
            categories: ["overlay"]
        },
        optionsTemplate: backupTemplate,
        optionsController: ($scope: any, backendCommunicator: any, utilityService: any) => {
            $scope.backupGiveaways = [];
            $scope.loading = false;

            if (!$scope.effect) {
                $scope.effect = {
                    giveawaySelectionMode: 'giveawayList',
                    manualGiveawayTitle: '',
                    action: 'restore'
                };
            }

            $scope.restoreGiveaway = (backupId: string) => {
                const giveawayId = backupId.split('::backup::')[0];

                backendCommunicator.fireEventAsync("checkGiveawayExists", { giveawayId })
                    .then((exists: boolean) => {
                        if (exists) {
                            return utilityService.showConfirmationModal({
                                title: "Giveaway Already Exists",
                                question: "A giveaway with this name already exists. How would you like to proceed?",
                                confirmLabel: "Overwrite",
                                cancelLabel: "Merge",
                                closeLabel: "Cancel",
                                confirmBtnType: "btn-danger"
                            }).then((response: string | boolean) => {
                                if (response === true) {
                                    return backendCommunicator.fireEventAsync("restoreGiveaway", { backupId, mode: 'overwrite' });
                                } else if (response === false) {
                                    return backendCommunicator.fireEventAsync("restoreGiveaway", { backupId, mode: 'merge' });
                                }
                            }).then(() => {
                                loadBackups();
                            });
                        } else {
                            return backendCommunicator.fireEventAsync("restoreGiveaway", { backupId })
                                .then(() => loadBackups());
                        }
                    });
            };

            $scope.deleteBackup = (backupId: string) => {
                backendCommunicator.fireEventAsync("removeBackup", { giveawayId: backupId })
                    .then(() => loadBackups());
            };

            function loadBackups() {
                if ($scope.effect.giveawaySelectionMode !== 'giveawayList') return;

                $scope.loading = true;
                backendCommunicator.fireEventAsync("getBackupGiveaways", {})
                    .then((backups: BackupGiveaway[]) => {
                        $scope.backupGiveaways = backups;
                        $scope.loading = false;
                    })
                    .catch(() => {
                        $scope.backupGiveaways = [];
                        $scope.loading = false;
                    });
            }

            $scope.$watch('effect.giveawaySelectionMode', (newMode: string) => {
                if (newMode === 'giveawayList') {
                    loadBackups();
                }
            });

            $scope.effectValueChanged = () => {
                loadBackups();
            };

            loadBackups();
        },
        onTriggerEvent: async (event: { effect: BackupEffectModel }) => {
            if (event.effect.giveawaySelectionMode === 'manual') {
                const baseId = event.effect.manualGiveawayTitle.startsWith('giveaway_')
                    ? event.effect.manualGiveawayTitle
                    : `giveaway_${event.effect.manualGiveawayTitle.replace(/[^a-zA-Z0-9]/g, '_')}`;

                const backupGiveaways = await giveawayManager.getBackupGiveaways();

                if (event.effect.action === 'restore') {
                    let backupId = baseId;

                    if (!baseId.includes('::backup::')) {
                        const matchingBackup = backupGiveaways
                            .filter((backup: BackupGiveaway) => backup.id?.startsWith(baseId))
                            .sort((a: BackupGiveaway, b: BackupGiveaway) => new Date(b.removedAt).getTime() - new Date(a.removedAt).getTime())[0];

                        if (matchingBackup?.id) {
                            backupId = matchingBackup.id;
                        }
                    }

                    try {
                        await giveawayManager.restoreGiveaway(backupId);
                    } catch (error) {
                        logger.warn(`No backup found for giveaway: ${backupId}`);
                    }
                } else if (event.effect.action === 'remove') {
                    let backupId = baseId;
                    if (!baseId.includes('::backup::')) {
                        const matchingBackup = backupGiveaways
                            .filter((backup: BackupGiveaway) => backup.id?.startsWith(baseId))
                            .sort((a: BackupGiveaway, b: BackupGiveaway) => new Date(b.removedAt).getTime() - new Date(a.removedAt).getTime())[0];

                        if (matchingBackup?.id) {
                            backupId = matchingBackup.id;
                        }
                    }

                    await giveawayManager.removeBackup(backupId);
                }
            }

            return { success: true };
        }
    };

    return backupEffectType;
}

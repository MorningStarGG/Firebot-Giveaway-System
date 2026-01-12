import { Firebot, ScriptModules } from "@crowbartools/firebot-custom-scripts-types";
import { ReplaceVariableManager } from "@crowbartools/firebot-custom-scripts-types/types/modules/replace-variable-manager";
import { giveawaySystemEffectType } from "./effects/main-effect";
import { giveawaySystemUpdateEffectType } from "./effects/updater-effect";
import { giveawaySystemBackupEffectType } from "./effects/backup-effect";
import { GiveawaySystemEventSource } from "./events/giveaway-system-events";
import { HttpServerManager } from "@crowbartools/firebot-custom-scripts-types/types/modules/http-server-manager";
import { FrontendCommunicator } from "@crowbartools/firebot-custom-scripts-types/types/modules/frontend-communicator";
import { initLogger, logger } from "./logger";
import { Request, Response } from "express";
import giveawaySystemHtml from "./overlay/giveaway-system.html";
import { createGiveawayManager, giveawayManager } from "./utility/giveaway-manager";
import * as giveawayVariables from "./variables/giveaway-system-variables";
import { FirebotSettings } from '@crowbartools/firebot-custom-scripts-types/types/settings';

interface Params { }

// Export the modules with proper initialization
export let webServer: HttpServerManager;
export let frontendCommunicator: FrontendCommunicator;
export let modules: ScriptModules;
export let replaceVariableManager: ReplaceVariableManager;
export let settings: FirebotSettings;

const script: Firebot.CustomScript<Params> = {
    getScriptManifest: () => {
        return {
            name: "MSGG Giveaway System",
            description: "Powerful giveaway system with entry management, winner selection, and approval",
            author: "MorningStarGG",
            version: "1.0",
            firebotVersion: "5",
        };
    },
    getDefaultParameters: () => {
        return {};
    },
    run: (runRequest) => {
        // Store modules globally
        modules = runRequest.modules;
        webServer = runRequest.modules.httpServer;
        frontendCommunicator = runRequest.modules.frontendCommunicator;
        replaceVariableManager = runRequest.modules.replaceVariableManager;
        settings = runRequest.firebot.settings;

        // Initialize logging
        initLogger(runRequest.modules.logger);
        logger.info("MSGG Giveaway System is loading...");

        // Set up frontend communicator events
        runRequest.modules.frontendCommunicator.on(
            "add-custom-variable",
            (newVar: any) => {
                return runRequest.modules.customVariableManager.addCustomVariable(
                    newVar.name,
                    newVar.data,
                    newVar.ttl,
                    newVar.propertyPath
                );
            }
        );

        // Register HTTP route for serving the giveaway system overlay
        webServer.registerCustomRoute(
            "giveaway-system",
            "giveaway-system.html",
            "GET",
            (req: Request, res: Response) => {
                res.setHeader('content-type', 'text/html');
                res.end(giveawaySystemHtml);
            }
        );

        createGiveawayManager(modules.path.join(SCRIPTS_DIR, '..', 'db', 'giveawaySystem.db'), modules);

        // Clean up expired giveaways and backups
        setInterval(() => {
            giveawayManager.cleanupExpiredGiveaways();
        }, 24 * 60 * 60 * 1000); // Check once per day

        giveawayManager.cleanupExpiredGiveaways();
        giveawayManager.reconcileExpiredPendingWinnersForAll(modules.eventManager);

        // Check for and handle end of giveaways (auto-close)
        let isProcessingGiveaways = false;

        const checkEndingGiveaways = async () => {
            if (isProcessingGiveaways) return;

            try {
                isProcessingGiveaways = true;
                const activeGiveaways = await giveawayManager.getActiveGiveaways();

                for (const giveawayId of activeGiveaways) {
                    const giveaway = await giveawayManager.getGiveaway(giveawayId);
                    if (giveaway?.paused) {
                        continue;
                    }
                    if (!giveaway?.closeTime || giveaway.ended || new Date(giveaway.closeTime).getTime() > Date.now()) {
                        continue;
                    }

                    try {
                        // Auto-close behavior: close entries and pick a winner if available
                        const updatedGiveaway = await giveawayManager.closeEntries(giveawayId, { clearCloseTime: true }) || giveaway;

                        if (updatedGiveaway.entries.length > 0 && (!updatedGiveaway.pendingWinners || updatedGiveaway.pendingWinners.length === 0)) {
                            await giveawayManager.pickWinner(giveawayId, modules.eventManager);
                        } else {
                            // No entries to pick
                            await giveawayManager.stopGiveaway(giveawayId, 'automatic', modules.eventManager);
                            await giveawayManager.checkAndCloseGiveaway(giveawayId);
                        }
                    } catch (error) {
                        logger.error('Error in giveaway ending process:', error);
                        await giveawayManager.startGiveaway(giveawayId, modules.eventManager)
                    }
                }
            } catch (error) {
                logger.error('Error in checkEndingGiveaways:', error);
            } finally {
                isProcessingGiveaways = false;
            }
        };
        setInterval(checkEndingGiveaways, 1000);

        // Giveaway Event Handlers
        const giveawayEventHandlers = {
            getActiveGiveaways: async () => {
                return await giveawayManager.getActiveGiveaways();
            },
            getEndedGiveaways: async () => {
                return await giveawayManager.getEndedGiveaways();
            },
            getAllGiveawaysWithStatus: async () => {
                return await giveawayManager.getAllGiveawaysWithStatus();
            },
            getGiveawayData: async (giveawayId: string) => {
                return await giveawayManager.getGiveaway(giveawayId);
            },
            checkGiveawayExists: async ({ giveawayId }: { giveawayId: string }) => {
                return await giveawayManager.checkGiveawayExists(giveawayId);
            },
            getBackupGiveaways: async () => {
                return await giveawayManager.getBackupGiveaways();
            },
            restoreGiveaway: async ({ backupId, mode }: { backupId: string; mode?: 'merge' | 'overwrite' }) => {
                return await giveawayManager.restoreGiveaway(backupId, mode);
            },
            removeBackup: async ({ giveawayId }: { giveawayId: string }) => {
                return await giveawayManager.removeBackup(giveawayId);
            }
        };

        // Register all handlers
        Object.entries(giveawayEventHandlers).forEach(([event, handler]) => {
            frontendCommunicator.onAsync(event, async (...args: any[]) => {
                try {
                    const result = await handler(args[0]);
                    return result;
                } catch (error) {
                    logger.error(`${event} error:`, error);
                    return event === 'getActiveGiveaways' ? [] : null;
                }
            });
        });


        // Register giveaway system events
        modules.eventManager.registerEventSource(GiveawaySystemEventSource);

        // Register giveaway system effects
        modules.effectManager.registerEffect(giveawaySystemEffectType());
        modules.effectManager.registerEffect(giveawaySystemUpdateEffectType());
        modules.effectManager.registerEffect(giveawaySystemBackupEffectType());

        // Register giveaway system variables
        Object.values(giveawayVariables).forEach(variable => {
            replaceVariableManager.registerReplaceVariable(variable);
        });

        logger.info("MSGG Giveaway System loaded successfully!");
    },
};

export default script;

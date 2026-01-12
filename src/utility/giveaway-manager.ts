import { ScriptModules } from '@crowbartools/firebot-custom-scripts-types';
import { emitGiveawayStop, emitGiveawayStart, emitWinnerPicked, emitWinnerClaimed, emitWinnerApproved, emitWinnerDenied, emitWinnerExpired, emitGiveawayEmpty } from '../events/giveaway-system-events';
import { JsonDB } from 'node-json-db';
import { GiveawayState, BackupGiveaway, GiveawayEntry, GiveawayWinner, GiveawayAction, WinnerHistoryRecord, WinnerHistorySettings, WinnerHistorySource } from '../types/types';
import { webServer } from "../main";
import { logger } from "../logger";
import { randomUUID } from 'crypto';

class GiveawayManager {
    private _db: JsonDB;
    private _claimTimers: Map<string, NodeJS.Timeout> = new Map();
    private _removeTimers: Map<string, NodeJS.Timeout> = new Map();

    private readonly _winnerHistoryPath = '/winnerHistory';
    private readonly _winnerHistorySettingsPath = '/winnerHistorySettings';
    private readonly _defaultWinnerHistoryRetentionMs = 30 * 24 * 60 * 60 * 1000;

    constructor(path: string, modules: ScriptModules) {
        // @ts-ignore
        this._db = new modules.JsonDb(path, true, true);
    }

    // ============================================================================
    // Winner History (archived winners for retention/search)
    // ============================================================================

    private async getWinnerHistorySettings(): Promise<WinnerHistorySettings> {
        try {
            const settings = await this._db.getData(this._winnerHistorySettingsPath) as WinnerHistorySettings;
            if (settings && typeof settings.retentionMs === 'number' && settings.retentionMs > 0) {
                return settings;
            }
        } catch {
        }

        const created: WinnerHistorySettings = {
            retentionMs: this._defaultWinnerHistoryRetentionMs,
            updatedAt: new Date().toISOString()
        };
        await this._db.push(this._winnerHistorySettingsPath, created, true);
        return created;
    }

    private winnerHistoryRecordKey(winner: GiveawayWinner): string {
        const winKey = this.ensureWinId(winner);
        return (winKey || '').replace(/\//g, '_');
    }

    async getWinnerHistoryRetentionMs(): Promise<number> {
        const settings = await this.getWinnerHistorySettings();
        return settings.retentionMs;
    }

    async setWinnerHistoryRetentionMs(retentionMs: number): Promise<void> {
        const safe = Number.isFinite(retentionMs) ? Math.max(60 * 1000, Math.floor(retentionMs)) : this._defaultWinnerHistoryRetentionMs;
        const updated: WinnerHistorySettings = { retentionMs: safe, updatedAt: new Date().toISOString() };
        await this._db.push(this._winnerHistorySettingsPath, updated, true);
    }

    async getWinnerHistory(): Promise<WinnerHistoryRecord[]> {
        try {
            const stored = await this._db.getData(this._winnerHistoryPath) as Record<string, WinnerHistoryRecord>;
            return Object.entries(stored).map(([id, record]) => ({ ...(record as WinnerHistoryRecord), id }));
        } catch {
            return [];
        }
    }

    async archiveApprovedWinner(giveawayId: string, giveaway: GiveawayState, winner: GiveawayWinner, source: WinnerHistorySource = 'approved'): Promise<boolean> {
        if (!giveawayId || !giveaway || !winner?.username) return false;
        if ((winner.status || '').toLowerCase() !== 'approved') return false;

        const recordId = this.winnerHistoryRecordKey(winner);
        try {
            await this._db.getData(`${this._winnerHistoryPath}/${recordId}`);
            return false; // already archived
        } catch {
        }

        const category = giveaway?.giveawayData?.category || 'uncategorized';
        const giveawayTitle = giveaway?.giveawayData?.title || giveawayId;
        const prize = giveaway?.giveawayData?.prize || '';

        const record: WinnerHistoryRecord = {
            giveawayId,
            giveawayUuid: giveaway.uuid,
            giveawayTitle,
            prize,
            category,
            storedAt: new Date().toISOString(),
            source,
            winner: { ...winner, winId: undefined }
        };

        await this._db.push(`${this._winnerHistoryPath}/${recordId}`, record, true);
        return true;
    }

    async removeWinnerHistoryForWin(giveawayId: string, winner: GiveawayWinner): Promise<boolean> {
        const recordId = this.winnerHistoryRecordKey(winner);
        try {
            await this._db.delete(`${this._winnerHistoryPath}/${recordId}`);
            return true;
        } catch {
            return false;
        }
    }

    private async archiveWinnersFromState(giveawayId: string, giveaway: GiveawayState, source: WinnerHistorySource): Promise<number> {
        const winners: GiveawayWinner[] = [];
        if (Array.isArray(giveaway.winners)) winners.push(...giveaway.winners);
        if (winners.length === 0) return 0;

        const category = giveaway?.giveawayData?.category || 'uncategorized';
        const giveawayTitle = giveaway?.giveawayData?.title || giveawayId;
        const prize = giveaway?.giveawayData?.prize || '';
        const storedAt = new Date().toISOString();

        let added = 0;
        for (const winner of winners) {
            if (!winner?.username) continue;
            if ((winner.status || '').toLowerCase() !== 'approved') continue;
            const recordId = this.winnerHistoryRecordKey(winner);
            try {
                await this._db.getData(`${this._winnerHistoryPath}/${recordId}`);
                continue; // already archived
            } catch {
            }
            const record: WinnerHistoryRecord = {
                giveawayId,
                giveawayUuid: giveaway.uuid,
                giveawayTitle,
                prize,
                category,
                storedAt,
                source,
                winner: { ...winner, winId: undefined }
            };
            await this._db.push(`${this._winnerHistoryPath}/${recordId}`, record, true);
            added += 1;
        }
        return added;
    }

    async archiveGiveawayWinners(giveawayId: string, giveaway: GiveawayState, source: WinnerHistorySource): Promise<number> {
        if (!giveaway) return 0;
        return await this.archiveWinnersFromState(giveawayId, giveaway, source);
    }

    async purgeWinnerHistory(options: { olderThanMs?: number; username?: string } = {}): Promise<number> {
        const all = await this.getWinnerHistory();
        if (all.length === 0) return 0;

        const usernameLower = options.username ? options.username.toLowerCase() : undefined;
        const cutoff = typeof options.olderThanMs === 'number' && Number.isFinite(options.olderThanMs)
            ? Date.now() - Math.max(0, options.olderThanMs)
            : undefined;

        const shouldRemove = (record: WinnerHistoryRecord): boolean => {
            if (usernameLower && (record?.winner?.username || '').toLowerCase() !== usernameLower) {
                return false;
            }

            if (cutoff == null) {
                return true;
            }

            const ts = new Date(record?.winner?.wonAt || record?.storedAt || 0).getTime();
            if (!Number.isFinite(ts)) {
                return false;
            }
            return ts < cutoff;
        };

        let removed = 0;
        for (const record of all) {
            if (!record.id) continue;
            if (!shouldRemove(record)) continue;
            try {
                await this._db.delete(`${this._winnerHistoryPath}/${record.id}`);
                removed += 1;
            } catch {
            }
        }
        return removed;
    }

    async clearWinnerHistory(): Promise<number> {
        const existing = await this.getWinnerHistory();
        try {
            await this._db.delete(this._winnerHistoryPath);
        } catch {
        }
        return existing.length;
    }

    async cleanupWinnerHistory(): Promise<number> {
        const retentionMs = await this.getWinnerHistoryRetentionMs();
        return await this.purgeWinnerHistory({ olderThanMs: retentionMs });
    }

    // ============================================================================
    // Core Operations
    // ============================================================================

    async getGiveaway(giveawayId: string): Promise<GiveawayState | undefined> {
        try {
            const data = await this._db.getData(`/giveaways/${giveawayId}`) as GiveawayState;
            if (data && typeof data.entriesClosed === 'undefined') {
                data.entriesClosed = false;
            }
            if (data && typeof data.autoRemoveAfterClose === 'undefined') {
                data.autoRemoveAfterClose = true;
            }
            return data;
        } catch {
            return undefined;
        }
    }

    async createGiveaway(giveawayId: string, giveawayState: GiveawayState): Promise<void> {
        await this.updateGiveaway(giveawayId, giveawayState);
    }

    async updateGiveaway(giveawayId: string, giveawayState: GiveawayState): Promise<void> {
        giveawayState.updatedAt = new Date().toISOString();
        if (!giveawayState.overlayInstance) {
            giveawayState.overlayInstance = '';
        }
        await this._db.push(`/giveaways/${giveawayId}`, giveawayState, true);
    }

    private computeRemainingSeconds(timestamp?: string | null): number | null {
        if (!timestamp) return null;
        const ms = new Date(timestamp).getTime();
        if (!Number.isFinite(ms)) return null;
        const remaining = Math.max(0, Math.floor((ms - Date.now()) / 1000));
        return remaining > 0 ? remaining : null;
    }

    private ensureWinId(winner: GiveawayWinner): string {
        if (!winner.winId) {
            winner.winId = randomUUID();
        }
        return winner.winId;
    }

    // ============================================================================
    // Giveaway Lifecycle
    // ============================================================================

    async startGiveaway(giveawayId: string, eventManager: any): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        this.cancelRemoveOverlay(giveawayId);
        giveaway.ended = false;
        giveaway.entriesClosed = false;
        giveaway.entriesClosedAt = undefined;
        giveaway.paused = false;
        giveaway.pausedCloseRemainingSeconds = undefined;
        giveaway.pausedClaimRemaining = undefined;

        // If the stored closeTime is in the past (e.g., after a manual stop), clear it to avoid immediate auto-stop.
        if (giveaway.closeTime && new Date(giveaway.closeTime).getTime() <= Date.now()) {
            giveaway.closeTime = undefined;
        }

        // If auto-close is enabled but no close time is set, recreate it from the stored duration
        const storedDurationSeconds = Number(giveaway.duration) || 0;
        if (!giveaway.closeTime && giveaway.autoClose && storedDurationSeconds > 0) {
            giveaway.closeTime = new Date(Date.now() + storedDurationSeconds * 1000).toISOString();
        }

        giveaway.updatedAt = new Date().toISOString();
        await this.updateGiveaway(giveawayId, giveaway);

        // Calculate remaining duration in seconds from closeTime if set
        const duration = giveaway.closeTime
            ? Math.max(0, Math.floor((new Date(giveaway.closeTime).getTime() - Date.now()) / 1000))
            : 0;

        emitGiveawayStart(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            duration: duration
        });
    }

    async stopGiveaway(giveawayId: string, stopType: 'manual' | 'automatic' = 'manual', eventManager: any): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        giveaway.ended = true;
        giveaway.entriesClosed = true;
        giveaway.entriesClosedAt = new Date().toISOString();
        giveaway.updatedAt = new Date().toISOString();
        giveaway.closeTime = new Date().toISOString();
        await this.updateGiveaway(giveawayId, giveaway);
        if (giveaway.autoRemoveAfterClose) {
            this.scheduleRemoveOverlay(giveawayId, giveaway);
        }

        emitGiveawayStop(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            totalEntries: giveaway.totalEntries,
            stopType: stopType,
            startTime: giveaway.createdAt
        }).catch(error => {
            console.error('Error emitting giveaway stop event:', error);
        });
    }

    async pauseGiveaway(giveawayId: string): Promise<GiveawayState | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (giveaway) {
            if (giveaway.paused) return giveaway;
            giveaway.paused = true;
            giveaway.pausedCloseRemainingSeconds = this.computeRemainingSeconds(giveaway.closeTime);
            giveaway.closeTime = undefined;

            const pausedClaims: Record<string, number> = {};
            if (giveaway.pendingWinners && giveaway.pendingWinners.length > 0) {
                for (const winner of giveaway.pendingWinners) {
                    if (winner.status !== 'pending') continue;
                    const winId = this.ensureWinId(winner);
                    const remaining = this.computeRemainingSeconds(winner.claimDeadline);
                    if (remaining != null) {
                        pausedClaims[winId] = remaining;
                    }
                    this.clearClaimTimer(winId);
                    winner.claimDeadline = undefined;
                }
            }
            giveaway.pausedClaimRemaining = pausedClaims;
            await this.updateGiveaway(giveawayId, giveaway);
            return giveaway;
        }
        return null;
    }

    async unpauseGiveaway(giveawayId: string, eventManager?: any): Promise<GiveawayState | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (giveaway) {
            if (!giveaway.paused) return giveaway;
            giveaway.paused = false;
            const now = Date.now();
            if (giveaway.pausedCloseRemainingSeconds && giveaway.pausedCloseRemainingSeconds > 0) {
                giveaway.closeTime = new Date(now + giveaway.pausedCloseRemainingSeconds * 1000).toISOString();
            }
            giveaway.pausedCloseRemainingSeconds = null;

            if (giveaway.pendingWinners && giveaway.pendingWinners.length > 0) {
                const pausedClaims = giveaway.pausedClaimRemaining || {};
                for (const winner of giveaway.pendingWinners) {
                    if (winner.status !== 'pending') continue;
                    const winId = this.ensureWinId(winner);
                    const remaining = pausedClaims[winId];
                    if (remaining && remaining > 0) {
                        winner.claimDeadline = new Date(now + remaining * 1000).toISOString();
                        this.startClaimTimer(giveawayId, remaining, eventManager, winId);
                    }
                }
            }
            giveaway.pausedClaimRemaining = {};
            await this.updateGiveaway(giveawayId, giveaway);
            return giveaway;
        }
        return null;
    }

    async closeEntries(giveawayId: string, options?: { clearCloseTime?: boolean }): Promise<GiveawayState | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return null;

        // Capture remaining close timer if we're intentionally closing entries (similar to pause)
        const shouldSaveCloseTimer = options?.clearCloseTime !== true;
        const remainingCloseSeconds = shouldSaveCloseTimer
            ? this.computeRemainingSeconds(giveaway.closeTime)
            : null;

        giveaway.entriesClosed = true;
        giveaway.entriesClosedAt = new Date().toISOString();
        if (options?.clearCloseTime) {
            giveaway.closeTime = undefined;
            giveaway.pausedCloseRemainingSeconds = null;
        } else if (remainingCloseSeconds != null) {
            giveaway.pausedCloseRemainingSeconds = remainingCloseSeconds;
            giveaway.closeTime = undefined;
        }

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);
        return giveaway;
    }

    async openEntries(giveawayId: string): Promise<GiveawayState | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return null;

        const savedCloseSeconds = giveaway.pausedCloseRemainingSeconds;

        giveaway.entriesClosed = false;
        giveaway.entriesClosedAt = undefined;

        // Restore the saved auto-close timer (if any) when reopening entries
        if (giveaway.autoClose && savedCloseSeconds && savedCloseSeconds > 0) {
            giveaway.closeTime = new Date(Date.now() + savedCloseSeconds * 1000).toISOString();
        }

        if (giveaway.closeTime) {
            const closeMs = new Date(giveaway.closeTime).getTime();
            if (Number.isNaN(closeMs) || closeMs <= Date.now()) {
                giveaway.closeTime = undefined;
            }
        }

        giveaway.pausedCloseRemainingSeconds = null;

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);
        return giveaway;
    }

    private scheduleRemoveOverlay(giveawayId: string, giveaway: GiveawayState) {
        // Clear existing timer
        const existing = this._removeTimers.get(giveawayId);
        if (existing) {
            clearTimeout(existing);
            this._removeTimers.delete(giveawayId);
        }

        if (!giveaway.autoRemoveAfterClose) return;
        const durationSeconds = giveaway.displayDuration || 30;
        if (durationSeconds <= 0) return;

        const timer = setTimeout(async () => {
            try {
                await webServer.sendToOverlay("giveaway-updater", {
                    type: 'remove',
                    config: {
                        giveawayTitle: giveawayId.replace('giveaway_', '')
                    }
                });
            } catch (error) {
                console.error('Error removing giveaway from overlay:', error);
            } finally {
                this._removeTimers.delete(giveawayId);
            }
        }, durationSeconds * 1000);

        this._removeTimers.set(giveawayId, timer);
    }

    cancelRemoveOverlay(giveawayId: string) {
        const existing = this._removeTimers.get(giveawayId);
        if (existing) {
            clearTimeout(existing);
            this._removeTimers.delete(giveawayId);
        }
    }

    async reconcileExpiredPendingWinnersForAll(eventManager: any): Promise<void> {
        try {
            const giveaways = await this._db.getData('/giveaways') as Record<string, GiveawayState>;
            const now = Date.now();

            for (const [giveawayId, giveaway] of Object.entries(giveaways)) {
                if (giveaway.paused) continue;
                if (!giveaway.pendingWinners || giveaway.pendingWinners.length === 0) continue;

                let updated = false;
                for (const targetWinner of giveaway.pendingWinners) {
                    if (targetWinner.status !== 'pending') continue;
                    if (!targetWinner.claimDeadline) continue;

                    const deadlineMs = new Date(targetWinner.claimDeadline).getTime();
                    if (Number.isNaN(deadlineMs)) continue;

                    const winId = this.ensureWinId(targetWinner);
                    this.clearClaimTimer(winId);

                    if (deadlineMs <= now) {
                        const durationSeconds = Math.max(1, giveaway.claimDuration || 60);
                        targetWinner.claimDeadline = new Date(Date.now() + durationSeconds * 1000).toISOString();
                        this.startClaimTimer(giveawayId, durationSeconds, eventManager, winId);
                        updated = true;
                    } else {
                        const remainingSeconds = Math.max(1, Math.floor((deadlineMs - now) / 1000));
                        this.startClaimTimer(giveawayId, remainingSeconds, eventManager, winId);
                    }
                }

                if (updated) {
                    await this.updateGiveaway(giveawayId, giveaway);
                    await this.sendOverlayUpdate(giveawayId, giveaway);
                }
            }
        } catch (error) {
            logger.error('Error reconciling expired pending winners during startup:', error);
        }
    }

    // ============================================================================
    // Entry Management
    // ============================================================================

    async addEntry(giveawayId: string, username: string, oddsMultiplier: number = 1, userId?: string): Promise<boolean> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || giveaway.paused || giveaway.ended || giveaway.entriesClosed) return false;

        // Check if user already has entries
        const userEntries = giveaway.entries.filter(e => e.username.toLowerCase() === username.toLowerCase());

        if (!giveaway.allowMultipleEntries && userEntries.length > 0) {
            return false; // User already entered and multiple entries not allowed
        }

        if (giveaway.allowMultipleEntries && userEntries.length >= giveaway.maxEntriesPerUser) {
            return false; // User has reached max entries
        }

        const entry: GiveawayEntry = {
            username: username,
            oddsMultiplier: oddsMultiplier,
            enteredAt: new Date().toISOString(),
            userId: userId
        };

        giveaway.entries.push(entry);
        giveaway.totalEntries++;
        await this.updateGiveaway(giveawayId, giveaway);

        await this.sendOverlayUpdate(giveawayId, giveaway, { entriesOnly: true });

        return true;
    }

    async removeEntry(giveawayId: string, username: string, removeAll: boolean = true): Promise<boolean> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return false;

        const initialLength = giveaway.entries.length;

        if (removeAll) {
            giveaway.entries = giveaway.entries.filter(
                e => e.username.toLowerCase() !== username.toLowerCase()
            );
        } else {
            // Remove only one entry
            const index = giveaway.entries.findIndex(
                e => e.username.toLowerCase() === username.toLowerCase()
            );
            if (index !== -1) {
                giveaway.entries.splice(index, 1);
            }
        }

        const removedCount = initialLength - giveaway.entries.length;
        giveaway.totalEntries -= removedCount;

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway, { entriesOnly: true });

        return removedCount > 0;
    }

    async clearEntries(giveawayId: string): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        giveaway.entries = [];
        giveaway.totalEntries = 0;
        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway, { entriesOnly: true });
    }

    async resetEntriesAndWinners(giveawayId: string): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        // Cancel any pending auto-remove for this giveaway
        this.cancelRemoveOverlay(giveawayId);

        giveaway.entries = [];
        giveaway.totalEntries = 0;
        if (giveaway.pendingWinners && giveaway.pendingWinners.length > 0) {
            for (const winner of giveaway.pendingWinners) {
                if (winner.winId) {
                    this.clearClaimTimer(winner.winId);
                }
            }
        }
        giveaway.pendingWinners = [];
        giveaway.winners = [];
        giveaway.pausedClaimRemaining = {};
        giveaway.ended = false;
        giveaway.entriesClosed = false;
        giveaway.entriesClosedAt = undefined;
        giveaway.paused = false;
        giveaway.pausedCloseRemainingSeconds = undefined;
        giveaway.closeTime = undefined;
        const resetDurationSeconds = Number(giveaway.duration) || 0;
        if (giveaway.autoClose && resetDurationSeconds > 0) {
            giveaway.closeTime = new Date(Date.now() + resetDurationSeconds * 1000).toISOString();
        }
        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);
    }

    async getEntryCount(giveawayId: string, username?: string): Promise<number> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return 0;

        if (username) {
            return giveaway.entries.filter(
                e => e.username.toLowerCase() === username.toLowerCase()
            ).length;
        }
        return giveaway.totalEntries;
    }

    // ============================================================================
    // Winner Selection & Management
    // ============================================================================

    async pickWinner(giveawayId: string, eventManager: any): Promise<GiveawayWinner | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || giveaway.entries.length === 0) return null;

        // Do not re-pick users who already have an active/approved win.
        // Allow denied/expired back in when requeue flags are enabled.
        const excluded = new Set<string>();
        const requeueDenied = !!giveaway.requeueDenied;
        const requeueExpired = !!giveaway.requeueExpired;
        const shouldExcludeStatus = (status: string) => {
            const s = (status || '').toLowerCase();
            if (s === 'approved' || s === 'claimed' || s === 'pending') return true;
            if (s === 'denied') return !requeueDenied;
            if (s === 'expired') return !requeueExpired;
            return true;
        };

        if (Array.isArray(giveaway.pendingWinners)) {
            giveaway.pendingWinners.forEach(w => {
                if (shouldExcludeStatus(w.status)) {
                    excluded.add((w.username || '').toLowerCase());
                }
            });
        }
        if (Array.isArray(giveaway.winners)) {
            giveaway.winners.forEach(w => {
                if (shouldExcludeStatus(w.status)) {
                    excluded.add((w.username || '').toLowerCase());
                }
            });
        }

        const availableEntries = giveaway.entries.filter(
            e => !excluded.has(e.username.toLowerCase())
        );

        if (availableEntries.length === 0) {
            return null;
        }

        // Calculate total weight for odds
        let totalWeight = 0;
        const weightedEntries: { entry: GiveawayEntry; weight: number; cumulativeWeight: number }[] = [];

        for (const entry of availableEntries) {
            const weight = entry.oddsMultiplier;
            totalWeight += weight;
            weightedEntries.push({
                entry,
                weight,
                cumulativeWeight: totalWeight
            });
        }

        // Pick random winner based on weights
        const randomValue = Math.random() * totalWeight;
        let selectedEntry: GiveawayEntry | null = null;

        for (const we of weightedEntries) {
            if (randomValue <= we.cumulativeWeight) {
                selectedEntry = we.entry;
                break;
            }
        }

        if (!selectedEntry) {
            selectedEntry = giveaway.entries[giveaway.entries.length - 1];
        }

        // Calculate odds for display
        const userWeight = selectedEntry.oddsMultiplier;
        const oddsPercentage = ((userWeight / totalWeight) * 100).toFixed(2);
        const oddsString = `${userWeight}/${totalWeight}`;

        const winner: GiveawayWinner = {
            winId: randomUUID(),
            username: selectedEntry.username,
            oddsMultiplier: selectedEntry.oddsMultiplier,
            oddsPercentage: oddsPercentage,
            oddsString: oddsString,
            wonAt: new Date().toISOString(),
            status: 'pending'
        };

        // Emit winner picked event
        emitWinnerPicked(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            winner: winner.username,
            totalEntries: giveaway.totalEntries,
            oddsPercentage: oddsPercentage,
            oddsString: oddsString
        });

        // If claim is not required, auto-approve immediately
        if (giveaway.requireClaim === false) {
            winner.status = 'approved';
            winner.approvedAt = new Date().toISOString();
            giveaway.winners.push({ ...winner });
            await this.archiveApprovedWinner(giveawayId, giveaway, winner, 'approved');
            // Remove winner from entry pool
            giveaway.entries = giveaway.entries.filter(
                e => e.username.toLowerCase() !== winner.username.toLowerCase()
            );
            giveaway.totalEntries = giveaway.entries.length;

            await this.updateGiveaway(giveawayId, giveaway);
            await this.sendOverlayUpdate(giveawayId, giveaway);

            emitWinnerApproved(eventManager, {
                giveawayId: giveawayId,
                giveawayTitle: giveaway.giveawayData.title,
                category: giveaway.giveawayData.category || '',
                prize: giveaway.giveawayData.prize,
                winner: winner.username,
                approved: true
            });

            if (giveaway.entries.length === 0) {
                emitGiveawayEmpty(eventManager, {
                    giveawayId: giveawayId,
                    giveawayTitle: giveaway.giveawayData.title,
                    category: giveaway.giveawayData.category || '',
                    prize: giveaway.giveawayData.prize,
                    reason: 'approved'
                });
            }
            this.scheduleRemoveOverlay(giveawayId, giveaway);

            return winner;
        }

        if (!giveaway.pendingWinners) giveaway.pendingWinners = [];
        giveaway.pendingWinners.push(winner);

        // Set per-winner claim deadline only if timer is enabled
        if (giveaway.enableClaimTimer !== false && giveaway.claimDuration > 0) {
            winner.claimDeadline = new Date(Date.now() + (giveaway.claimDuration * 1000)).toISOString();
        } else {
            winner.claimDeadline = undefined;
        }

        // Remove winner's entries from the pool while pending to avoid repeat picks
        giveaway.entries = giveaway.entries.filter(
            e => e.username.toLowerCase() !== winner.username.toLowerCase()
        );
        giveaway.totalEntries = giveaway.entries.length;

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);

        // Start claim timer for this winner if enabled
        if (giveaway.enableClaimTimer !== false && giveaway.claimDuration > 0) {
            this.startClaimTimer(giveawayId, giveaway.claimDuration, eventManager, winner.winId!);
        }

        return winner;
    }

    async claimWin(giveawayId: string, username: string, eventManager: any): Promise<boolean> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || !giveaway.pendingWinners || giveaway.pendingWinners.length === 0) return false;

        const target = giveaway.pendingWinners.find(w => w.username.toLowerCase() === username.toLowerCase());
        if (!target) return false;
        if (target.status !== 'pending') return false;

        // Check if claim deadline has passed when timer is enabled
        if (giveaway.enableClaimTimer !== false && target.claimDeadline && new Date(target.claimDeadline) < new Date()) {
            return false;
        }

        target.status = 'claimed';
        target.claimedAt = new Date().toISOString();

        // Clear claim timer for this winner
        if (target.winId) this.clearClaimTimer(target.winId);

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);

        // Emit claim event
        emitWinnerClaimed(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            winner: username
        });

        return true;
    }

    async approveWin(giveawayId: string, eventManager: any, username?: string): Promise<boolean> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || !giveaway.pendingWinners || giveaway.pendingWinners.length === 0) return false;

        const target = username
            ? giveaway.pendingWinners.find(w => w.username.toLowerCase() === username.toLowerCase())
            : giveaway.pendingWinners[0];
        if (!target) return false;
        if (target.status !== 'claimed' && target.status !== 'pending') {
            return false;
        }

        target.status = 'approved';
        target.approvedAt = new Date().toISOString();

        // Add to winners list
        giveaway.winners.push({ ...target });
        await this.archiveApprovedWinner(giveawayId, giveaway, target, 'approved');

        // Remove winner from entries pool
        giveaway.entries = giveaway.entries.filter(
            e => e.username.toLowerCase() !== target.username.toLowerCase()
        );
        giveaway.totalEntries = giveaway.entries.length;

        // Remove from pending
        giveaway.pendingWinners = giveaway.pendingWinners.filter(w => w !== target);
        if (target.winId) this.clearClaimTimer(target.winId);

        // Emit approval event
        emitWinnerApproved(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            winner: target.username,
            approved: true
        });

        // Emit empty event if no entries remain and no pending
        if (giveaway.entries.length === 0 && (!giveaway.pendingWinners || giveaway.pendingWinners.length === 0)) {
            emitGiveawayEmpty(eventManager, {
                giveawayId: giveawayId,
                giveawayTitle: giveaway.giveawayData.title,
                category: giveaway.giveawayData.category || '',
                prize: giveaway.giveawayData.prize,
                reason: 'approved'
            });
        }

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);
        if (!giveaway.pendingWinners || giveaway.pendingWinners.length === 0) {
            this.scheduleRemoveOverlay(giveawayId, giveaway);
        }

        return true;
    }

    async denyWin(giveawayId: string, eventManager: any, username?: string): Promise<boolean> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return false;

        const usernameLower = username ? username.toLowerCase() : undefined;
        const hasPending = Array.isArray(giveaway.pendingWinners) && giveaway.pendingWinners.length > 0;

        let target: GiveawayWinner | undefined;
        let fromPending = false;

        if (hasPending) {
            target = usernameLower
                ? giveaway.pendingWinners?.find(w => w.username.toLowerCase() === usernameLower)
                : giveaway.pendingWinners?.[0];
            fromPending = !!target;
        }

        // If no pending match, allow undoing an approved winner when a username is provided
        let winnerIndex = -1;
        if (!target && usernameLower && Array.isArray(giveaway.winners)) {
            // Choose the newest win for that user by timestamps
            let newestTs = -1;
            for (let i = 0; i < giveaway.winners.length; i++) {
                const w = giveaway.winners[i];
                if ((w?.username || "").toLowerCase() !== usernameLower) continue;

                const approvedAtMs = w?.approvedAt ? new Date(w.approvedAt).getTime() : NaN;
                const wonAtMs = w?.wonAt ? new Date(w.wonAt).getTime() : NaN;
                const ts = Number.isFinite(approvedAtMs) ? approvedAtMs : (Number.isFinite(wonAtMs) ? wonAtMs : -1);

                if (ts > newestTs || (ts === newestTs && i > winnerIndex)) {
                    newestTs = ts;
                    winnerIndex = i;
                }
            }
            if (winnerIndex !== -1) {
                target = giveaway.winners[winnerIndex];
                fromPending = false;
            }
        }

        if (!target) return false;

        const deniedWinner = target.username;
        const requeue = giveaway.requeueDenied;

        target.status = 'denied';
        target.deniedAt = new Date().toISOString();

        if (fromPending) {
            // Move resolved winner into winners history for filtering/stats
            if (!Array.isArray(giveaway.winners)) giveaway.winners = [];
            giveaway.winners.push({ ...target });

            if (requeue) {
                const exists = giveaway.entries.some(
                    e => e.username.toLowerCase() === deniedWinner.toLowerCase()
                );
                if (!exists) {
                    giveaway.entries.push({
                        username: deniedWinner,
                        oddsMultiplier: target.oddsMultiplier || 1,
                        enteredAt: new Date().toISOString()
                    });
                }
            }
            giveaway.totalEntries = giveaway.entries.length;

            if (target.winId) this.clearClaimTimer(target.winId);

            giveaway.pendingWinners = giveaway.pendingWinners?.filter(w => w !== target) || [];
        } else {
            // Update the existing winner record instead of removing it
            await this.removeWinnerHistoryForWin(giveawayId, target);

            if (requeue) {
                const exists = giveaway.entries?.some(e => e.username.toLowerCase() === deniedWinner.toLowerCase());
                if (!exists) {
                    giveaway.entries = giveaway.entries || [];
                    giveaway.entries.push({
                        username: deniedWinner,
                        oddsMultiplier: target.oddsMultiplier || 1,
                        enteredAt: new Date().toISOString()
                    });
                }
            } else {
                giveaway.entries = giveaway.entries?.filter(
                    e => e.username.toLowerCase() !== deniedWinner.toLowerCase()
                ) || [];
            }
            giveaway.totalEntries = giveaway.entries.length;
        }

        await this.updateGiveaway(giveawayId, giveaway);
        await this.sendOverlayUpdate(giveawayId, giveaway);

        emitWinnerDenied(eventManager, {
            giveawayId: giveawayId,
            giveawayTitle: giveaway.giveawayData.title,
            category: giveaway.giveawayData.category || '',
            prize: giveaway.giveawayData.prize,
            winner: deniedWinner,
            approved: false
        });

        if (!requeue && giveaway.entries.length === 0 && (!giveaway.pendingWinners || giveaway.pendingWinners.length === 0)) {
            emitGiveawayEmpty(eventManager, {
                giveawayId: giveawayId,
                giveawayTitle: giveaway.giveawayData.title,
                category: giveaway.giveawayData.category || '',
                prize: giveaway.giveawayData.prize,
                reason: 'denied'
            });
        }

        return true;
    }

    async rerollWinner(giveawayId: string, eventManager: any, removeCurrentWinner: boolean = true): Promise<GiveawayWinner | null> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return null;

        // Remove current pending winner from pool if specified
        if (removeCurrentWinner && giveaway.pendingWinners && giveaway.pendingWinners.length > 0) {
            const target = giveaway.pendingWinners[0];
            giveaway.entries = giveaway.entries.filter(
                e => e.username.toLowerCase() !== target.username.toLowerCase()
            );
            giveaway.totalEntries = giveaway.entries.length;
            if (target.winId) this.clearClaimTimer(target.winId);
            giveaway.pendingWinners.shift();
        }

        await this.updateGiveaway(giveawayId, giveaway);

        // Check if there are remaining entries
        if (giveaway.entries.length === 0) {
            await this.sendOverlayUpdate(giveawayId, giveaway);
            await emitGiveawayEmpty(eventManager, {
                giveawayId,
                giveawayTitle: giveaway.giveawayData.title,
                category: giveaway.giveawayData.category || '',
                prize: giveaway.giveawayData.prize,
                reason: 'reroll'
            });
            return null;
        }

        // Pick new winner
        return await this.pickWinner(giveawayId, eventManager);
    }

    private startClaimTimer(giveawayId: string, durationSeconds: number, eventManager: any, winId: string): void {
        this.clearClaimTimer(winId);

        const timer = setTimeout(async () => {
            const giveaway = await this.getGiveaway(giveawayId);
            if (!giveaway || !giveaway.pendingWinners || giveaway.pendingWinners.length === 0) return;

            const targetIndex = giveaway.pendingWinners.findIndex(w => w.winId === winId);
            if (targetIndex === -1) return;

            const targetWinner = giveaway.pendingWinners[targetIndex];

            if (targetWinner.status === 'pending') {
                // Winner didn't claim in time
                targetWinner.status = 'expired';
                targetWinner.expiredAt = new Date().toISOString();
                if (!Array.isArray(giveaway.winners)) giveaway.winners = [];
                giveaway.winners.push({ ...targetWinner });

                const expiredWinner = targetWinner.username;
                const requeue = giveaway.requeueExpired;

                if (requeue) {
                    const exists = giveaway.entries.some(
                        e => e.username.toLowerCase() === expiredWinner.toLowerCase()
                    );
                    if (!exists) {
                        giveaway.entries.push({
                            username: expiredWinner,
                            oddsMultiplier: targetWinner.oddsMultiplier || 1,
                            enteredAt: new Date().toISOString()
                        });
                        giveaway.totalEntries = giveaway.entries.length;
                    }
                }

                giveaway.pendingWinners.splice(targetIndex, 1);

                await this.updateGiveaway(giveawayId, giveaway);
                await this.sendOverlayUpdate(giveawayId, giveaway);

                // Emit expired event
                emitWinnerExpired(eventManager, {
                    giveawayId: giveawayId,
                    giveawayTitle: giveaway.giveawayData.title,
                    category: giveaway.giveawayData.category || '',
                    prize: giveaway.giveawayData.prize,
                    winner: expiredWinner
                });

                // Auto reroll if enabled and the giveaway is still active
                if (giveaway.autoRerollOnExpire && !giveaway.ended && !giveaway.paused && giveaway.entries.length > 0) {
                    try {
                        await this.pickWinner(giveawayId, eventManager);
                    } catch (error) {
                        logger.error('Error auto-rerolling after claim expiry:', error);
                    }
                }

                // Emit empty event if no entries remain, no pending winners, and not requeued
                if (
                    !requeue &&
                    giveaway.entries.length === 0 &&
                    (!giveaway.pendingWinners || giveaway.pendingWinners.length === 0)
                ) {
                    emitGiveawayEmpty(eventManager, {
                        giveawayId: giveawayId,
                        giveawayTitle: giveaway.giveawayData.title,
                        category: giveaway.giveawayData.category || '',
                        prize: giveaway.giveawayData.prize,
                        reason: 'expired'
                    });
                }
            }
        }, durationSeconds * 1000);

        this._claimTimers.set(winId, timer);
    }

    private clearClaimTimer(timerId: string): void {
        const timer = this._claimTimers.get(timerId);
        if (timer) {
            clearTimeout(timer);
            this._claimTimers.delete(timerId);
        }
    }

    // ============================================================================
    // Query Methods
    // ============================================================================

    async getActiveGiveaways(): Promise<string[]> {
        try {
            const data = await this._db.getData('/giveaways');
            return Object.entries(data)
                .filter(([_, giveaway]) => {
                    const state = giveaway as GiveawayState;
                    return !state.ended;
                })
                .map(([giveawayId]) => giveawayId);
        } catch {
            return [];
        }
    }

    async getEndedGiveaways(): Promise<string[]> {
        try {
            const data = await this._db.getData('/giveaways');
            return Object.entries(data)
                .filter(([_, giveaway]) => {
                    const state = giveaway as GiveawayState;
                    return state.ended;
                })
                .map(([giveawayId]) => giveawayId);
        } catch {
            return [];
        }
    }

    async getAllGiveawaysWithStatus(): Promise<Array<{ giveawayId: string, displayTitle: string, status: 'active' | 'stopped' }>> {
        try {
            const data = await this._db.getData('/giveaways');
            return Object.entries(data).map(([giveawayId, giveaway]) => ({
                giveawayId: giveawayId,
                displayTitle: (giveaway as GiveawayState).giveawayData.title,
                status: (giveaway as GiveawayState).ended ? 'stopped' : 'active'
            }));
        } catch {
            return [];
        }
    }

    async checkGiveawayExists(giveawayId: string): Promise<boolean> {
        try {
            await this._db.getData(`/giveaways/${giveawayId}`);
            return true;
        } catch {
            return false;
        }
    }

    // ============================================================================
    // Backup & Restore
    // ============================================================================

    async backupGiveaway(giveawayId: string): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        // Archive winners before removing from active DB
        await this.archiveGiveawayWinners(giveawayId, giveaway, 'backupRemove');

        const backupId = `${giveawayId}::backup::${Date.now()}`;
        const backup: BackupGiveaway = {
            ...giveaway,
            removedAt: new Date().toISOString()
        };

        await this._db.push(`/backups/${backupId}`, backup);
        await this._db.delete(`/giveaways/${giveawayId}`);
    }

    async getBackupGiveaways(): Promise<BackupGiveaway[]> {
        try {
            const backups = await this._db.getData('/backups');
            return Object.entries(backups).map(([giveawayId, backup]) => ({
                ...backup as BackupGiveaway,
                id: giveawayId
            }));
        } catch {
            return [];
        }
    }

    async restoreGiveaway(backupId: string, mode?: 'merge' | 'overwrite'): Promise<void> {
        const backup = await this._db.getData(`/backups/${backupId}`);
        if (!backup) return;

        const { removedAt, ...backupState } = backup;
        const giveawayId = backupId.split('::backup::')[0];
        if (typeof (backupState as GiveawayState).entriesClosed === 'undefined') {
            (backupState as GiveawayState).entriesClosed = false;
        }

        if (mode === 'merge') {
            const existingGiveaway = await this.getGiveaway(giveawayId);
            if (existingGiveaway) {
                // Merge entries
                const existingUsernames = new Set(existingGiveaway.entries.map(e => e.username.toLowerCase()));
                for (const entry of backupState.entries) {
                    if (!existingUsernames.has(entry.username.toLowerCase())) {
                        existingGiveaway.entries.push(entry);
                    }
                }
                existingGiveaway.totalEntries = existingGiveaway.entries.length;
                await this.updateGiveaway(giveawayId, existingGiveaway);
                await this.sendOverlayUpdate(giveawayId, existingGiveaway);
            }
        } else {
            await this._db.push(`/giveaways/${giveawayId}`, backupState);
            await this.sendOverlayUpdate(giveawayId, backupState);
        }

        await this._db.delete(`/backups/${backupId}`);
    }

    async removeBackup(giveawayId: string): Promise<void> {
        try {
            await this._db.delete(`/backups/${giveawayId}`);
        } catch (error) {
            console.error(`Failed to remove backup giveaway ${giveawayId}:`, error);
            throw error;
        }
    }

    // ============================================================================
    // Cleanup
    // ============================================================================

    async cleanupExpiredGiveaways(): Promise<void> {
        try {
            const backups = await this._db.getData('/backups') as Record<string, BackupGiveaway>;
            const now = Date.now();
            const backupCutoff = now - (7 * 24 * 60 * 60 * 1000); // backups always 7 days

            for (const [giveawayId, backup] of Object.entries(backups)) {
                if (new Date(backup.removedAt).getTime() < backupCutoff) {
                    // Archive winners from backups before pruning
                    const originalId = giveawayId.includes('::backup::') ? giveawayId.split('::backup::')[0] : giveawayId;
                    await this.archiveGiveawayWinners(originalId, backup as unknown as GiveawayState, 'backupCleanup');
                    await this._db.delete(`/backups/${giveawayId}`);
                }
            }

            // Clean ended giveaways
            const giveaways = await this._db.getData('/giveaways') as Record<string, GiveawayState>;
            for (const [giveawayId, giveaway] of Object.entries(giveaways)) {
                const retentionDays = giveaway.retentionDays ?? 7;
                const cutoff = now - (retentionDays * 24 * 60 * 60 * 1000);
                if (giveaway.ended && giveaway.closeTime && new Date(giveaway.closeTime).getTime() < cutoff) {
                    await this.archiveGiveawayWinners(giveawayId, giveaway, 'giveawayCleanup');
                    await this._db.delete(`/giveaways/${giveawayId}`);
                }
            }

            // Prune winner history based on its own retention window.
            await this.cleanupWinnerHistory();
        } catch (error) {
            console.log('No data to clean or error occurred:', error);
        }
    }

    // ============================================================================
    // Overlay Communication
    // ============================================================================

    private async sendOverlayUpdate(giveawayId: string, giveaway: GiveawayState, options: { entriesOnly?: boolean } = {}): Promise<void> {
        try {
            // Compute remaining seconds for each pending winner at send time, this ensures the frontend can display accurate countdown from the moment it receives the update
            const serverTimestamp = Date.now();
            const pendingWinnersWithTiming = giveaway.pendingWinners?.map(winner => ({
                ...winner,
                // Include remaining seconds computed at this exact moment
                claimRemainingSeconds: winner.claimDeadline
                    ? Math.max(0, Math.floor((new Date(winner.claimDeadline).getTime() - serverTimestamp) / 1000))
                    : null
            })) || [];

            // Compute close timer remaining seconds at send time
            const closeRemainingSeconds = giveaway.closeTime
                ? Math.max(0, Math.floor((new Date(giveaway.closeTime).getTime() - serverTimestamp) / 1000))
                : null;

            const winnersForOverlay = (giveaway.winners || []).filter(w => {
                const status = (w?.status || '').toLowerCase();
                return status === 'approved' || status === 'claimed';
            });

            await webServer.sendToOverlay("giveaway-updater", {
                type: 'update',
                overlayInstance: giveaway.overlayInstance,
                config: {
                    giveawayTitle: giveawayId.replace('giveaway_', ''),
                    giveawayData: giveaway.giveawayData,
                    entries: giveaway.entries,
                    totalEntries: giveaway.totalEntries,
                    pendingWinners: pendingWinnersWithTiming,
                    winners: winnersForOverlay,
                    styles: giveaway.giveawayData.styles,
                    display: giveaway.giveawayData.display,
                    position: giveaway.position,
                    customCoords: giveaway.customCoords,
                    ended: giveaway.ended,
                    paused: giveaway.paused,
                    pausedCloseRemainingSeconds: giveaway.pausedCloseRemainingSeconds,
                    pausedClaimRemaining: giveaway.pausedClaimRemaining,
                    entriesClosed: giveaway.entriesClosed,
                    closeTime: giveaway.closeTime,
                    closeRemainingSeconds: closeRemainingSeconds,
                    enableClaimTimer: giveaway.enableClaimTimer,
                    claimDuration: giveaway.claimDuration,
                    serverTimestamp: serverTimestamp,
                    entriesOnly: options.entriesOnly === true
                }
            });
        } catch (error) {
            console.error('Error sending overlay update:', error);
        }
    }

    async checkAndCloseGiveaway(giveawayId: string): Promise<void> {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        try {
            // Compute timing at send time for consistency
            const serverTimestamp = Date.now();
            const pendingWinnersWithTiming = giveaway.pendingWinners?.map(winner => ({
                ...winner,
                claimRemainingSeconds: winner.claimDeadline
                    ? Math.max(0, Math.floor((new Date(winner.claimDeadline).getTime() - serverTimestamp) / 1000))
                    : null
            })) || [];

            await webServer.sendToOverlay("giveaway-updater", {
                type: 'update',
                overlayInstance: giveaway.overlayInstance,
                config: {
                    giveawayTitle: giveawayId.replace('giveaway_', ''),
                    giveawayData: giveaway.giveawayData,
                    entries: giveaway.entries,
                    totalEntries: giveaway.totalEntries,
                    pendingWinners: pendingWinnersWithTiming,
                    winners: giveaway.winners,
                    styles: giveaway.giveawayData.styles,
                    display: giveaway.giveawayData.display,
                    position: giveaway.position,
                    customCoords: giveaway.customCoords,
                    ended: true,
                    paused: giveaway.paused,
                    pausedCloseRemainingSeconds: giveaway.pausedCloseRemainingSeconds,
                    pausedClaimRemaining: giveaway.pausedClaimRemaining,
                    entriesClosed: giveaway.entriesClosed,
                    closeTime: giveaway.closeTime,
                    closeRemainingSeconds: null,
                    enableClaimTimer: giveaway.enableClaimTimer,
                    claimDuration: giveaway.claimDuration,
                    serverTimestamp: serverTimestamp
                }
            });

            // Schedule removal after display duration if enabled
            if (giveaway.autoRemoveAfterClose) {
                this.scheduleRemoveOverlay(giveawayId, giveaway);
            }
        } catch (error) {
            console.error('Error in checkAndCloseGiveaway:', error);
            throw error;
        }
    }
}

export let giveawayManager: GiveawayManager;

export function createGiveawayManager(path: string, modules: ScriptModules): GiveawayManager {
    if (!giveawayManager) {
        giveawayManager = new GiveawayManager(path, modules);
    }
    return giveawayManager;
}

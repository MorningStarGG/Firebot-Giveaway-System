import type { ReplaceVariable } from '@crowbartools/firebot-types';
import { giveawayManager } from '../utility/giveaway-manager';
import { key, username as normalizeUsername } from '../shared/giveaway-rules';
const normalizeGiveawayId = (giveawayId?: string): string => {
    if (!giveawayId) return '';
    const trimmed = String(giveawayId).trim();
    if (!trimmed) return '';
    return trimmed.startsWith('giveaway_') ? trimmed : `giveaway_${trimmed.replace(/[^a-zA-Z0-9]/g, '_')}`;
};
const createOptionSet = (params: string[], aliasMap: Record<string, string | string[]> = {}): Set<string> => {
    const result = new Set<string>();
    for (const paramRaw of params) {
        const key = (paramRaw ?? '').toLowerCase().trim();
        if (!key) continue;
        const mapped = aliasMap[key];
        if (!mapped) {
            result.add(key);
        } else if (Array.isArray(mapped)) {
            for (const value of mapped) {
                result.add(value);
            }
        } else {
            result.add(mapped);
        }
    }
    return result;
};
const ensureDefaults = (options: Set<string>, defaults: string[]): void => {
    if (options.size === 0) {
        defaults.forEach((value) => options.add(value));
    }
};
const toBooleanString = (value: boolean): 'true' | 'false' => (value ? 'true' : 'false');
const formatDurationShort = (seconds?: number): string => {
    if (seconds == null || !Number.isFinite(seconds)) return '';
    const s = Math.max(0, Math.floor(seconds));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
};
export const giveawaySearchVariable: ReplaceVariable = {
    definition: {
        handle: 'giveawaySearch',
        description:
            'Search/list giveaways (active, ended, backups) and return selected fields defaults to title-only search unless a find* flag expands it',
        usage: 'giveawaySearch[scope?, query?, fields?]',
        examples: [
            {
                usage: 'giveawaySearch[active]',
                description:
                    "Returns comma-separated IDs of active giveaways (default, e.g., 'giveaway_summer_games, giveaway_grand_prize')",
            },
            {
                usage: 'giveawaySearch[current, id, title, status]',
                description: 'Lists active/ended giveaways with ID, title, and status',
            },
            {
                usage: 'giveawaySearch[active, title]',
                description:
                    "Returns comma-separated titles of active giveaways (e.g., 'Summer Games Pack, Grand Prize Draw')",
            },
            {
                usage: 'giveawaySearch[active, id, title]',
                description:
                    "Shows IDs and titles (e.g., 'giveaway_summer_games - Summer Games Pack, giveaway_grand_prize - Grand Prize Draw')",
            },
            {
                usage: 'giveawaySearch[ended, id, title, status]',
                description:
                    "Shows ended giveaways with IDs, titles, and status (e.g., 'giveaway_holiday - Holiday Special - completed')",
            },
            {
                usage: 'giveawaySearch[steam deck, active, findPrize, id, title]',
                description: "Searches only prize field for 'steam deck' within active giveaways",
            },
            {
                usage: 'giveawaySearch[games, findCategory, all, id, title, category]',
                description:
                    "Searches only category field for 'games' (e.g., 'giveaway_fps_bundle - FPS Bundle - games')",
            },
            {
                usage: 'giveawaySearch[key, findAll, all, id, title, prize]',
                description: 'Searches title+prize+category across all giveaways',
            },
            {
                usage: 'giveawaySearch[active, id, title, category, prize]',
                description: "Shows full details (e.g., 'giveaway_epic - Epic Prize - gaming - RTX 4090 GPU')",
            },
            {
                usage: 'giveawaySearch[backups, id, title, source]',
                description: 'Lists backed up giveaways with ID/title/source',
            },
            {
                usage: 'giveawaySearch[active, count]',
                description: 'Returns number of active giveaways (e.g., 5)',
            },
            {
                usage: 'giveawaySearch[active, id, title, timeLeft, timeLeftHuman]',
                description: "Shows time remaining (e.g., 'giveaway_ID_here - Weekly Draw - 43200 - 12h 0m 0s')",
            },
            {
                usage: 'giveawaySearch[ended, id, title, closeTimeHuman]',
                description:
                    "Shows ended giveaways with close time (e.g., 'giveaway_holiday - Holiday Special - 12/25/2024, 11:59:59 PM')",
            },
            {
                usage: 'giveawaySearch[all, id, title, closeTime, closeTimeHuman]',
                description: 'Returns both raw close time and readable close time',
            },
            {
                usage: 'giveawaySearch[all, id, title, timeLeftSeconds, timeLeftHuman]',
                description: 'Returns numeric and readable time remaining',
            },
            {
                usage: 'giveawaySearch[all, detailed]',
                description:
                    'Shows ID, title, category, prize, and status for all giveaways (shorthand for common fields)',
            },
            {
                usage: 'giveawaySearch[all, gaming, raw]',
                description: "Returns raw array of giveaway objects matching 'gaming' for advanced processing",
            },
            {
                usage: 'giveawaySearch[all, gaming, json]',
                description: 'Returns matching giveaways as JSON text',
            },
        ],
        possibleDataOutput: ['text', 'array', 'object', 'number'],
    },
    evaluator: async (_trigger, scopeOrQuery?: string, queryOrField?: string, ...fields: string[]) => {
        const validScopes = ['active', 'ended', 'current', 'backups', 'all'];
        const args: string[] = [scopeOrQuery, queryOrField, ...fields].filter(
            (v): v is string => typeof v === 'string',
        );
        let scopeMode = 'all';
        let query = args.shift() || '';
        let fieldParams: string[] = args;
        // Allow scope flag anywhere after the query (first arg must be the search term)
        const scopeIndex = fieldParams.findIndex((a) => validScopes.includes(a.toLowerCase()));
        if (scopeIndex >= 0) {
            scopeMode = fieldParams[scopeIndex].toLowerCase();
            fieldParams = [...fieldParams.slice(0, scopeIndex), ...fieldParams.slice(scopeIndex + 1)];
        }
        // Split remaining args into field flags (ignore extra non-flags, first arg is the query)
        const optionAliasMap = {
            id: 'id',
            ids: 'id',
            title: 'title',
            titles: 'title',
            name: 'title',
            names: 'title',
            category: 'category',
            cat: 'category',
            prize: 'prize',
            status: 'status',
            source: 'source',
            close: 'closeTime',
            closetime: 'closeTime',
            closereadable: 'closeTimeHuman',
            closelocal: 'closeTimeHuman',
            timeleft: 'timeLeftSeconds',
            timeleftseconds: 'timeLeftSeconds',
            timelefthuman: 'timeLeftHuman',
            created: 'createdAt',
            count: 'count',
            total: 'count',
            raw: 'raw',
            json: 'json',
            rawjson: 'json',
            findtitle: 'findTitle',
            findprize: 'findPrize',
            findcategory: 'findCategory',
            findall: 'findAll',
            detailed: ['id', 'title', 'category', 'prize', 'status'],
        };
        const optionAliases = new Set(Object.keys(optionAliasMap).map((k) => k.toLowerCase()));
        fieldParams = fieldParams.filter((arg) => optionAliases.has(arg.toLowerCase()));
        if (!validScopes.includes(scopeMode)) return 'invalid_scope';
        const tokens = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const options = createOptionSet(fieldParams, optionAliasMap);
        ensureDefaults(options, ['id']);
        const showIds = options.has('id');
        const showTitles = options.has('title');
        const showCategory = options.has('category');
        const showPrize = options.has('prize');
        const showStatus = options.has('status');
        const showSource = options.has('source');
        const showClose = options.has('closeTime');
        const showCloseHuman = options.has('closeTimeHuman');
        const showTimeLeft = options.has('timeLeftSeconds');
        const showTimeLeftHuman = options.has('timeLeftHuman');
        const showCreated = options.has('createdAt');
        const raw = options.has('raw');
        const json = options.has('json');
        const searchAllFields = options.has('findAll');
        const searchPrizeOnly = options.has('findPrize');
        const searchCategoryOnly = options.has('findCategory');
        const searchTitleOnly =
            options.has('findTitle') || (!searchPrizeOnly && !searchCategoryOnly && !searchAllFields);
        const results: Array<{
            id: string;
            title: string;
            category: string;
            prize: string;
            status: string;
            source: string;
            closeTime?: string;
            closeTimeHuman?: string;
            timeLeftSeconds?: number;
            timeLeftHuman?: string;
            createdAt?: string;
        }> = [];
        const formatDuration = formatDurationShort;
        const matchesTokens = (haystack: string) => tokens.every((t) => haystack.includes(t));
        const collect = (giveaway: any, source: string, status: string, idHint?: string) => {
            const title: string = giveaway.giveawayData?.title || giveaway.giveawayTitle || '';
            const fallbackId = title ? `giveaway_${title.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
            const id: string = idHint || giveaway.id || giveaway.giveawayId || fallbackId;
            const category: string = giveaway.giveawayData?.category || 'uncategorized';
            const prize: string = giveaway.giveawayData?.prize || '';
            const closeTime: string | undefined = giveaway.closeTime;
            const timeLeftSeconds: number | undefined = closeTime
                ? Math.max(0, Math.floor((new Date(closeTime).getTime() - Date.now()) / 1000))
                : undefined;
            const closeTimeHuman = closeTime ? new Date(closeTime).toLocaleString() : undefined;
            const timeLeftHuman = timeLeftSeconds != null ? formatDuration(timeLeftSeconds) : undefined;
            const createdAt: string | undefined = giveaway.createdAt;
            const titleSearchable = [id, title].join(' ').toLowerCase();
            const prizeSearchable = prize.toLowerCase();
            const categorySearchable = category.toLowerCase();
            if (tokens.length > 0) {
                let matched = false;
                if (searchPrizeOnly) {
                    matched = matchesTokens(prizeSearchable);
                } else if (searchCategoryOnly) {
                    matched = matchesTokens(categorySearchable);
                } else if (searchAllFields) {
                    matched = matchesTokens(`${titleSearchable} ${prizeSearchable} ${categorySearchable}`);
                } else {
                    // default: title only
                    matched = matchesTokens(titleSearchable);
                }
                if (!matched) return;
            }
            results.push({
                id: id,
                title,
                category,
                prize,
                status,
                source,
                closeTime,
                closeTimeHuman,
                timeLeftSeconds,
                timeLeftHuman,
                createdAt,
            });
        };
        if (scopeMode === 'active' || scopeMode === 'current' || scopeMode === 'all') {
            const activeIds = await giveawayManager.getActiveGiveaways();
            for (const gid of activeIds) {
                const g = await giveawayManager.getGiveaway(gid);
                if (g) collect(g, 'active', 'active', gid);
            }
        }
        if (scopeMode === 'ended' || scopeMode === 'current' || scopeMode === 'all') {
            const endedIds = await giveawayManager.getEndedGiveaways();
            for (const gid of endedIds) {
                const g = await giveawayManager.getGiveaway(gid);
                if (g) collect(g, 'ended', 'ended', gid);
            }
        }
        if (scopeMode === 'backups' || scopeMode === 'all') {
            const backups = await giveawayManager.getBackupGiveaways();
            for (const backup of backups) {
                collect(backup, 'backup', 'backup', backup.id);
            }
        }
        if (results.length === 0) {
            if (options.has('count') && options.size === 1) return 0;
            return '';
        }
        if (options.has('count') && options.size === 1) return results.length;
        if (raw) return results;
        if (json) return JSON.stringify(results);
        return results
            .map((r) => {
                const parts: string[] = [];
                if (showIds) parts.push(r.id);
                if (showTitles) parts.push(r.title);
                if (showCategory) parts.push(`cat: ${r.category}`);
                if (showPrize) parts.push(`prize: ${r.prize}`);
                if (showStatus) parts.push(`status: ${r.status}`);
                if (showSource) parts.push(`source: ${r.source}`);
                if (showClose && r.closeTime) parts.push(`closed: ${r.closeTime}`);
                if (showCloseHuman && r.closeTimeHuman) parts.push(`closed-local: ${r.closeTimeHuman}`);
                if (showTimeLeft && r.timeLeftSeconds != null) parts.push(`timeleft: ${r.timeLeftSeconds}s`);
                if (showTimeLeftHuman && r.timeLeftHuman) parts.push(`timeleft: ${r.timeLeftHuman}`);
                if (showCreated && r.createdAt) parts.push(`created: ${r.createdAt}`);
                return parts.join(' - ');
            })
            .join(' | ');
    },
};
export const giveawayUserInfoVariable: ReplaceVariable = {
    definition: {
        handle: 'giveawayUserInfo',
        description: 'Returns configurable info about a specific user in a giveaway (entries/entered/winner/etc.)',
        usage: 'giveawayUserInfo[giveawayId, username, fields?]',
        examples: [
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName]',
                description: "Returns entries and entered status (default, e.g., '3 entries, entered')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, entries]',
                description: 'Returns entry count as a number (e.g., 3)',
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, entered, isWinner]',
                description: "Returns whether user entered and is a winner (e.g., 'true | false')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, entered]',
                description: "Returns whether user entered (e.g., 'true')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, isWinner]',
                description: "Returns whether user is a winner (e.g., 'true' or 'false')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, winnerStatus]',
                description: "Returns winner status (e.g., 'approved', 'claimed', or 'not_winner')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, multiplier]',
                description: "Returns user's odds multiplier (e.g., 2.5 for subscribers, defaults to 1)",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, entries, multiplier]',
                description: "Shows multiple fields (e.g., '3 - 2.5x')",
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, lastEnteredAt]',
                description: 'Returns the timestamp when the user last entered',
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, raw]',
                description: 'Returns raw object with all computed fields and matching entry data',
            },
            {
                usage: 'giveawayUserInfo[giveawayId, contestantName, detailed]',
                description: 'Returns a detailed string (entries, entered, isWinner)',
            },
        ],
        possibleDataOutput: ['text', 'number', 'bool', 'object'],
    },
    evaluator: async (_trigger, giveawayId: string, username: string, ...params: string[]) => {
        const options = createOptionSet(params, {
            eligibleentries: 'eligibleEntries',
            eligibleusers: 'eligibleUsers',
            eligibleweight: 'eligibleWeight',
            oddspercentage: 'oddsPercentage',
            approvedwins: 'approvedWins',
            admissions: 'admissions',
            held: 'held',
            winlimit: 'winLimit',
            rawentries: 'rawEntries',
            entries: 'entries',
            entrycount: 'entries',
            entered: 'entered',
            hasentered: 'entered',
            iswinner: 'isWinner',
            winner: 'isWinner',
            winnerstatus: 'winnerStatus',
            status: 'winnerStatus',
            multiplier: 'multiplier',
            oddsmultiplier: 'multiplier',
            odds: 'multiplier',
            lastentered: 'lastEnteredAt',
            enteredat: 'lastEnteredAt',
            raw: 'raw',
            detailed: ['entries', 'entered', 'isWinner'],
        });
        ensureDefaults(options, ['entries', 'entered']);
        if (!giveawayId || !username) {
            if (options.size === 1) {
                if (options.has('entries')) return 0;
                if (options.has('entered') || options.has('isWinner')) return 'false';
                if (options.has('winnerStatus')) return 'no_giveaway';
                if (options.has('multiplier')) return 1;
                if (options.has('raw')) return null;
            }
            return '';
        }
        const normalizedId = normalizeGiveawayId(giveawayId);
        const giveaway = await giveawayManager.getGiveaway(normalizedId);
        if (!giveaway) {
            if (options.size === 1) {
                if (options.has('entries')) return 0;
                if (options.has('entered') || options.has('isWinner')) return 'false';
                if (options.has('winnerStatus')) return 'no_giveaway';
                if (options.has('multiplier')) return 1;
                if (options.has('raw')) return null;
            }
            return '';
        }
        username = normalizeUsername(username);
        const userLower = username;
        const entry = Array.isArray(giveaway.entries)
            ? giveaway.entries.find((e) => key(e?.username || '') === userLower)
            : undefined;
        const entries = await giveawayManager.getEntryCount(normalizedId, username);
        const entered = entries > 0;
        const pendingMatch = Array.isArray(giveaway.pendingWinners)
            ? giveaway.pendingWinners.find((w) => key(w?.username || '') === userLower)
            : undefined;
        const winnerMatches = Array.isArray(giveaway.winners)
            ? giveaway.winners.filter((w) => key(w?.username || '') === userLower)
            : [];
        const lastWinnerMatch = winnerMatches.length > 0 ? winnerMatches[winnerMatches.length - 1] : undefined;
        const isWinner = !!pendingMatch || !!lastWinnerMatch;
        const winnerStatus = pendingMatch
            ? (pendingMatch.status ? String(pendingMatch.status) : 'pending').toLowerCase()
            : lastWinnerMatch?.status
                ? String(lastWinnerMatch.status).toLowerCase()
                : 'not_winner';
        const multiplier = typeof entry?.oddsMultiplier === 'number' ? entry.oddsMultiplier : 1;
        const lastEnteredAt = entry?.enteredAt || '';
        const eligibility = await giveawayManager.eligibility(normalizedId, username);
        const extraNames = [
            'eligibleEntries',
            'eligibleUsers',
            'eligibleWeight',
            'oddsPercentage',
            'approvedWins',
            'admissions',
            'held',
            'winLimit',
            'rawEntries',
        ] as const;
        if (options.size === 1) {
            for (const name of extraNames) if (options.has(name)) return eligibility[name];
        }
        const computed = {
            ...eligibility,
            giveawayId: normalizedId,
            username,
            entries,
            entered,
            isWinner,
            winnerStatus,
            multiplier,
            lastEnteredAt,
            entry: entry ?? null,
        };
        if (options.has('raw')) return computed;
        if (options.size === 1) {
            if (options.has('entries')) return entries;
            if (options.has('entered')) return toBooleanString(entered);
            if (options.has('isWinner')) return toBooleanString(isWinner);
            if (options.has('winnerStatus')) return winnerStatus;
            if (options.has('multiplier')) return multiplier;
            if (options.has('lastEnteredAt')) return lastEnteredAt;
        }
        const parts: string[] = extraNames
            .filter((name) => options.has(name))
            .map((name) => name + ': ' + JSON.stringify(eligibility[name]));
        if (options.has('entries')) parts.push(`entries: ${entries}`);
        if (options.has('entered')) parts.push(entered ? 'entered' : 'not entered');
        if (options.has('isWinner')) parts.push(isWinner ? 'winner' : 'not winner');
        if (options.has('winnerStatus')) parts.push(`winnerStatus: ${winnerStatus}`);
        if (options.has('multiplier')) parts.push(`x${multiplier}`);
        if (options.has('lastEnteredAt') && lastEnteredAt) parts.push(`enteredAt: ${lastEnteredAt}`);
        return parts.join(' | ');
    },
};
export const giveawayInfoVariable: ReplaceVariable = {
    definition: {
        handle: 'giveawayInfo',
        description: "Returns configurable details for a giveaway (supports 'raw' and 'exists')",
        usage: 'giveawayInfo[giveawayId, fields?]',
        examples: [
            {
                usage: 'giveawayInfo[giveawayId]',
                description: "Returns title and prize (default, e.g., 'Weekly Stream Giveaway | PS5 Console')",
            },
            {
                usage: 'giveawayInfo[giveawayId, title]',
                description: "Returns just the giveaway title (e.g., 'Weekly Stream Giveaway')",
            },
            {
                usage: 'giveawayInfo[giveawayId, prize]',
                description: "Returns just the prize (e.g., 'Steam Deck')",
            },
            {
                usage: 'giveawayInfo[giveawayId, category]',
                description: "Returns the category (e.g., 'hardware' or 'uncategorized')",
            },
            {
                usage: 'giveawayInfo[giveawayId, status]',
                description: "Returns giveaway status (e.g., 'active', 'paused', 'closed', or 'ended')",
            },
            {
                usage: 'giveawayInfo[giveawayId, totalEntries]',
                description: 'Returns total entry count as a number (e.g., 247)',
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesCount]',
                description: 'Returns unique entrant count as a number (e.g., 189)',
            },
            {
                usage: 'giveawayInfo[giveawayId, entryCommand, claimCommand]',
                description: "Returns entry and claim commands (e.g., '!enter | !claim')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winner]',
                description: "Returns current winner username, pending status first (e.g., 'contestantName')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winnerOddsPercent, winnerOddsFraction]',
                description: "Returns current winner odds as percent and fraction (e.g., '2.00% | 1/50')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winners]',
                description: "Returns all approved winners (e.g., 'Player1, Player2, Player3')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winnerStatusCount, approved]',
                description: 'Returns count of winners with specific status (e.g., 3)',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, allWinners]',
                description:
                    "Shows winners with status and timestamp (e.g., 'Player1 (approved, 2024-12-18T10:30:00Z), Player2 (claimed, 2024-12-18T11:00:00Z)')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, allWinners, winnersSeparator | ]',
                description:
                    "Same as above with custom separator (e.g., 'Player1 (approved, 2024-12-18T10:30:00Z) | Player2 (claimed, 2024-12-18T11:00:00Z)')",
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, filterPendingWinners]',
                description: 'Shows only pending winners with status/timestamps',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, filterDeniedWinners]',
                description: 'Shows denied winners with status/timestamps',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, filterExpiredWinners]',
                description: 'Shows expired winners with status/timestamps',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, filterClaimedWinners]',
                description: 'Shows claimed winners with status/timestamps',
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesList]',
                description: "Returns all entrant usernames (e.g., 'User1, User2, User3, User4...')",
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesDetailed]',
                description:
                    "Shows entrants with multiplier and timestamp (e.g., 'User1 (2.5x, 2024-12-18T09:15:00Z), User2 (1x, 2024-12-18T09:20:00Z)')",
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesDetailed, entriesSeparator | ]',
                description: 'Same as above with custom separator',
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesDetailed, entriesSeparator \\n]',
                description: 'Shows entrants one per line with multiplier/timestamp',
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesCount]',
                description: 'Returns the count of unique entrants (e.g., 189)',
            },
            {
                usage: 'giveawayInfo[giveawayId, entriesRaw]',
                description: 'Returns raw entries array (objects with username, multiplier, enteredAt)',
            },
            {
                usage: 'giveawayInfo[giveawayId, closeRemainingHuman]',
                description: "Returns time until close in readable format (e.g., '2d 5h 30m 15s')",
            },
            {
                usage: 'giveawayInfo[giveawayId, closeRemainingSeconds]',
                description: 'Returns seconds until close as number (e.g., 186615)',
            },
            {
                usage: 'giveawayInfo[giveawayId, claimRemainingSeconds]',
                description: 'Returns claim window seconds remaining (e.g., 3600 or 0 if none)',
            },
            {
                usage: 'giveawayInfo[giveawayId, closeTimeHuman, createdAtHuman, updatedAtHuman]',
                description: 'Returns readable timestamps for close, created, and last updated',
            },
            {
                usage: 'giveawayInfo[giveawayId, closeTime, claimRemainingHuman]',
                description: 'Returns close time ISO string and remaining claim time in readable format',
            },
            {
                usage: 'giveawayInfo[giveawayId, duration, displayDuration, claimDuration]',
                description: 'Returns configured durations (in seconds) for close, display, and claim timer',
            },
            {
                usage: 'giveawayInfo[giveawayId, claimMode, enableClaimTimer, requireClaim]',
                description: "Returns claim-related flags (e.g., 'enabled', 'true', 'true')",
            },
            {
                usage: 'giveawayInfo[giveawayId, exists]',
                description: "Returns whether giveaway exists (e.g., 'true' or 'false')",
            },
            {
                usage: 'giveawayInfo[giveawayId, id]',
                description: 'Returns the normalized giveaway ID',
            },
            {
                usage: 'giveawayInfo[giveawayId, raw]',
                description: 'Returns the raw giveaway object for advanced processing',
            },
            {
                usage: 'giveawayInfo[giveawayId, json]',
                description: 'Returns the raw giveaway object as JSON text',
            },
            {
                usage: 'giveawayInfo[giveawayId, autoRerollOnExpire, requeueExpired, requeueDenied]',
                description: "Returns key behavior flags (e.g., 'false | true | false')",
            },
            {
                usage: 'giveawayInfo[giveawayId, allowMultipleEntries, maxEntriesPerUser]',
                description: "Returns entry allowance flags (e.g., 'true | 3')",
            },
            {
                usage: 'giveawayInfo[giveawayId, position, overlayInstance]',
                description: 'Returns overlay positioning and instance values',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersCount, winnersRaw]',
                description: 'Returns count and raw array of winners',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersDetailed, filterApprovedWinners]',
                description: 'Returns approved winners with status/timestamps',
            },
            {
                usage: 'giveawayInfo[giveawayId, winnersStatus, filterAllWinners]',
                description: 'Returns winner statuses across pending/approved',
            },
            {
                usage: 'giveawayInfo[giveawayId, claimRemainingHuman, ended, paused, entriesClosed]',
                description: 'Returns claim time remaining plus key state flags',
            },
        ],
        possibleDataOutput: ['text', 'number', 'bool', 'object'],
    },
    evaluator: async (_trigger, giveawayId: string, ...params: string[]) => {
        const rawParams = params.map((p) => (p ?? '').toString().trim()).filter(Boolean);
        let winnerStatusCountStatus: string | undefined;
        let winnersSeparator = ', ';
        let entriesSeparator = ', ';
        // Support status count params
        for (let i = 0; i < rawParams.length; i++) {
            const token = rawParams[i];
            const lower = token.toLowerCase();
            if (lower === 'winnerstatuscount' || lower === 'statuscount') {
                // Prefer the next token as the status when provided
                const candidate = rawParams[i + 1];
                const valid = new Set(['approved', 'denied', 'expired', 'pending', 'claimed']);
                if (candidate && valid.has(candidate.toLowerCase())) {
                    winnerStatusCountStatus = candidate;
                    rawParams.splice(i + 1, 1);
                } else {
                    // Otherwise, look for any valid status token anywhere in params and use it
                    const otherIndex = rawParams.findIndex((p, idx) => idx !== i && valid.has(p.toLowerCase()));
                    if (otherIndex >= 0) {
                        winnerStatusCountStatus = rawParams[otherIndex];
                        rawParams.splice(otherIndex, 1);
                    }
                }
                continue;
            }
        }
        // Extract winners separator
        const tokenIndex = rawParams.findIndex((p) => {
            const lower = p.toLowerCase();
            return lower === 'winnersseparator' || lower === 'wsep';
        });
        if (tokenIndex >= 0) {
            winnersSeparator = rawParams[tokenIndex + 1] ?? ', ';
            rawParams.splice(tokenIndex, 2);
        }
        // Extract entries separator
        const entriesTokenIndex = rawParams.findIndex((p) => p.toLowerCase() === 'entriesseparator');
        if (entriesTokenIndex >= 0) {
            entriesSeparator = rawParams[entriesTokenIndex + 1] ?? ', ';
            rawParams.splice(entriesTokenIndex, 2);
        }
        const options = createOptionSet(rawParams, {
            eligibleentries: 'eligibleEntries',
            eligibleusers: 'eligibleUsers',
            eligibleweight: 'eligibleWeight',
            oddspercentage: 'oddsPercentage',
            approvedwins: 'approvedWins',
            admissions: 'admissions',
            held: 'held',
            winlimit: 'winLimit',
            rawentries: 'rawEntries',
            id: 'id',
            title: 'title',
            prize: 'prize',
            category: 'category',
            status: 'status',
            entries: 'totalEntries',
            entrycount: 'totalEntries',
            totalentries: 'totalEntries',
            entrycommand: 'entryCommand',
            claimcommand: 'claimCommand',
            winnercount: 'winnerCount',
            pending: 'pendingCount',
            pendingcount: 'pendingCount',
            winner: 'winner',
            winnerstatus: 'winnerStatus',
            winneroddspercent: 'winnerOddsPercent',
            winneroddsfraction: 'winnerOddsFraction',
            winneroddsratio: 'winnerOddsFraction',
            closetime: 'closeTime',
            closetimehuman: 'closeTimeHuman',
            closereadable: 'closeTimeHuman',
            closeremainingseconds: 'closeRemainingSeconds',
            closeleftseconds: 'closeRemainingSeconds',
            closeremaininghuman: 'closeRemainingHuman',
            closelefthuman: 'closeRemainingHuman',
            created: 'createdAt',
            createdlocal: 'createdAtHuman',
            updated: 'updatedAt',
            updatedlocal: 'updatedAtHuman',
            ended: 'ended',
            paused: 'paused',
            closed: 'entriesClosed',
            entriesclosed: 'entriesClosed',
            autoclose: 'autoClose',
            duration: 'duration',
            displayduration: 'displayDuration',
            claimduration: 'claimDuration',
            claimmode: 'claimMode',
            enableclaimtimer: 'enableClaimTimer',
            requireclaim: 'requireClaim',
            autorerollonexpire: 'autoRerollOnExpire',
            retentiondays: 'retentionDays',
            requeueexpired: 'requeueExpired',
            requeuedenied: 'requeueDenied',
            allowmultipleentries: 'allowMultipleEntries',
            maxentriesperuser: 'maxEntriesPerUser',
            position: 'position',
            overlayinstance: 'overlayInstance',
            claimremainingseconds: 'claimRemainingSeconds',
            claimremaininghuman: 'claimRemainingHuman',
            winnerstatuscount: 'winnerStatusCount',
            statuscount: 'winnerStatusCount',
            winners: 'winners',
            winnerslist: 'winners',
            winnersnames: 'winners',
            winnersdetailed: 'winnersDetailed',
            winnersraw: 'winnersRaw',
            winnerscount: 'winnersCount',
            winnersstatus: 'winnersStatus',
            winnerswonat: 'winnersWonAt',
            winnersoddspercent: 'winnersOddsPercent',
            winnersoddsfraction: 'winnersOddsFraction',
            pendingwinners: 'filterPendingWinners',
            approvedwinners: 'filterApprovedWinners',
            deniedwinners: 'filterDeniedWinners',
            expiredwinners: 'filterExpiredWinners',
            claimedwinners: 'filterClaimedWinners',
            allwinners: 'filterAllWinners',
            entrieslist: 'entriesList',
            entriesnames: 'entriesList',
            entriesdetailed: 'entriesDetailed',
            entriesraw: 'entriesRaw',
            entriescount: 'entriesCount',
            entriesseparator: 'entriesSeparator',
            exists: 'exists',
            raw: 'raw',
            json: 'json',
            detailed: [
                'id',
                'title',
                'prize',
                'category',
                'status',
                'totalEntries',
                'winner',
                'winnerStatus',
                'closeTime',
                'closeRemainingHuman',
            ],
        });
        ensureDefaults(options, ['title', 'prize']);
        if (!giveawayId) {
            if (options.size === 1) {
                if (
                    options.has('totalEntries') ||
                    options.has('winnerCount') ||
                    options.has('pendingCount') ||
                    options.has('closeRemainingSeconds') ||
                    options.has('claimRemainingSeconds')
                )
                    return 0;
                if (
                    options.has('exists') ||
                    options.has('ended') ||
                    options.has('paused') ||
                    options.has('entriesClosed') ||
                    options.has('autoClose') ||
                    options.has('enableClaimTimer') ||
                    options.has('requireClaim') ||
                    options.has('allowMultipleEntries')
                )
                    return 'false';
                if (options.has('raw')) return null;
                if (options.has('json')) return 'null';
            }
            return '';
        }
        const normalizedId = normalizeGiveawayId(giveawayId);
        const giveaway = await giveawayManager.getGiveaway(normalizedId);
        const exists = !!giveaway;
        if (options.has('exists') && options.size === 1) {
            return toBooleanString(exists);
        }
        const eligibility = giveaway ? await giveawayManager.eligibility(normalizedId) : null;
        const extraNames = [
            'eligibleEntries',
            'eligibleUsers',
            'eligibleWeight',
            'admissions',
            'winLimit',
            'rawEntries',
        ] as const;
        if (options.size === 1) {
            for (const name of extraNames) if (options.has(name)) return eligibility?.[name] ?? 0;
        }
        if (options.has('raw')) {
            return giveaway ? { ...giveaway, ...eligibility } : null;
        }
        if (options.has('json')) {
            return JSON.stringify(giveaway ? { ...giveaway, ...eligibility } : null);
        }
        if (!giveaway) {
            if (options.size === 1) {
                if (
                    options.has('totalEntries') ||
                    options.has('winnerCount') ||
                    options.has('pendingCount') ||
                    options.has('closeRemainingSeconds') ||
                    options.has('claimRemainingSeconds')
                )
                    return 0;
                if (
                    options.has('ended') ||
                    options.has('paused') ||
                    options.has('entriesClosed') ||
                    options.has('autoClose') ||
                    options.has('enableClaimTimer') ||
                    options.has('requireClaim') ||
                    options.has('allowMultipleEntries')
                )
                    return 'false';
                if (options.has('exists')) return 'false';
            }
            return '';
        }
        const status = giveaway.ended
            ? 'ended'
            : giveaway.paused
                ? 'paused'
                : giveaway.entriesClosed
                    ? 'closed'
                    : 'active';
        const pending = Array.isArray(giveaway.pendingWinners) ? giveaway.pendingWinners : [];
        const winners = Array.isArray(giveaway.winners) ? giveaway.winners : [];
        const approvedOrClaimedWinners = winners.filter((w) => {
            const s = (w?.status || '').toLowerCase();
            return s === 'approved' || s === 'claimed';
        });
        const lastApprovedOrClaimed =
            approvedOrClaimedWinners.length > 0 ? approvedOrClaimedWinners[approvedOrClaimedWinners.length - 1] : null;
        const winnerObj =
            pending[0] || lastApprovedOrClaimed || (winners.length > 0 ? winners[winners.length - 1] : null);
        const entries = Array.isArray(giveaway.entries) ? giveaway.entries : [];
        const winnerStatusCounts: Record<'approved' | 'denied' | 'expired' | 'pending' | 'claimed', number> = {
            approved: 0,
            denied: 0,
            expired: 0,
            pending: 0,
            claimed: 0,
        };
        for (const w of winners) {
            const s = (w?.status || '').toLowerCase() as keyof typeof winnerStatusCounts;
            if (s in winnerStatusCounts) winnerStatusCounts[s] += 1;
        }
        for (const w of pending) {
            const s = (w?.status || '').toLowerCase() as keyof typeof winnerStatusCounts;
            if (s in winnerStatusCounts) winnerStatusCounts[s] += 1;
        }
        const requestedStatus = (winnerStatusCountStatus || 'approved').toLowerCase();
        const winnerStatusCount =
            requestedStatus in winnerStatusCounts
                ? winnerStatusCounts[requestedStatus as keyof typeof winnerStatusCounts]
                : 0;
        const closeTime = giveaway.closeTime || '';
        const closeTimeMs = closeTime ? new Date(closeTime).getTime() : NaN;
        const closeRemainingSeconds = Number.isFinite(closeTimeMs)
            ? Math.max(0, Math.floor((closeTimeMs - Date.now()) / 1000))
            : 0;
        const claimDeadline = winnerObj?.claimDeadline || '';
        const claimDeadlineMs = claimDeadline ? new Date(claimDeadline).getTime() : NaN;
        const claimRemainingSeconds = Number.isFinite(claimDeadlineMs)
            ? Math.max(0, Math.floor((claimDeadlineMs - Date.now()) / 1000))
            : 0;
        // Winners filtering
        const filterAllWinners = options.has('filterAllWinners');
        const filterPendingWinners = options.has('filterPendingWinners');
        const filterApprovedWinners = options.has('filterApprovedWinners');
        const filterDeniedWinners = options.has('filterDeniedWinners');
        const filterExpiredWinners = options.has('filterExpiredWinners');
        const filterClaimedWinners = options.has('filterClaimedWinners');
        const anyWinnerFilter =
            filterAllWinners ||
            filterPendingWinners ||
            filterApprovedWinners ||
            filterDeniedWinners ||
            filterExpiredWinners ||
            filterClaimedWinners;
        const normalizedStatus = (w: any) => (w?.status || '').toLowerCase();
        let filteredWinners: any[] = [];
        if (filterAllWinners) {
            filteredWinners = [...pending, ...winners];
        } else {
            if (!anyWinnerFilter || filterApprovedWinners) {
                filteredWinners.push(...winners.filter((w) => normalizedStatus(w) === 'approved'));
            }
            if (filterDeniedWinners) filteredWinners.push(...winners.filter((w) => normalizedStatus(w) === 'denied'));
            if (filterExpiredWinners) filteredWinners.push(...winners.filter((w) => normalizedStatus(w) === 'expired'));
            if (filterClaimedWinners) filteredWinners.push(...winners.filter((w) => normalizedStatus(w) === 'claimed'));
            if (filterPendingWinners) filteredWinners.push(...pending.filter((w) => normalizedStatus(w) === 'pending'));
        }
        const winnerCountValue = anyWinnerFilter
            ? filteredWinners.length
            : winners.filter((w) => {
                const s = normalizedStatus(w);
                return s === 'approved' || s === 'claimed';
            }).length + pending.length;
        const formatWinners = () => {
            const showStatus = options.has('winnersStatus') || options.has('winnersDetailed');
            const showWonAt = options.has('winnersWonAt') || options.has('winnersDetailed');
            const showOddsPercent = options.has('winnersOddsPercent');
            const showOddsFraction = options.has('winnersOddsFraction');
            const detailed =
                options.has('winnersDetailed') || showStatus || showWonAt || showOddsPercent || showOddsFraction;
            return filteredWinners
                .map((w) => {
                    const parts: string[] = [];
                    parts.push(w.username || '');
                    if (detailed) {
                        if (showStatus && w.status) parts.push(`status:${w.status}`);
                        if (showWonAt && w.wonAt) parts.push(`wonAt:${w.wonAt}`);
                        if (showOddsPercent && w.oddsPercentage != null) parts.push(`odds:${w.oddsPercentage}%`);
                        if (showOddsFraction && w.oddsString) parts.push(`odds:${w.oddsString}`);
                    }
                    return parts.filter(Boolean).join(' - ');
                })
                .join(winnersSeparator);
        };
        const formatEntries = () => {
            const showNames = options.has('entriesList') || options.has('entriesDetailed');
            const showMultipliers = options.has('entriesDetailed');
            const showEnteredAt = options.has('entriesDetailed');
            return entries
                .map((e: any) => {
                    const parts: string[] = [];
                    if (showNames) parts.push(e.username);
                    if (showMultipliers) parts.push(`x${typeof e.oddsMultiplier === 'number' ? e.oddsMultiplier : 1}`);
                    if (showEnteredAt && e.enteredAt) parts.push(e.enteredAt);
                    return parts.join(' - ');
                })
                .join(entriesSeparator);
        };
        const values = {
            id: normalizedId,
            title: giveaway.giveawayData?.title || '',
            prize: giveaway.giveawayData?.prize || '',
            category: giveaway.giveawayData?.category || 'uncategorized',
            status,
            totalEntries: Number(giveaway.totalEntries) || 0,
            winnerCount: winnerCountValue,
            pendingCount: pending.length,
            winner: winnerObj?.username || '',
            winnerStatus: winnerObj?.status || '',
            winnerOddsPercent: winnerObj?.oddsPercentage != null ? `${winnerObj.oddsPercentage}%` : '',
            winnerOddsFraction: winnerObj?.oddsString || '',
            entryCommand: giveaway.giveawayData?.entryCommand || '',
            claimCommand: giveaway.giveawayData?.claimCommand || '',
            closeTime,
            closeTimeHuman: closeTime ? new Date(closeTime).toLocaleString() : '',
            closeRemainingSeconds,
            closeRemainingHuman: closeTime ? formatDurationShort(closeRemainingSeconds) : '',
            claimRemainingSeconds,
            claimRemainingHuman: claimDeadline ? formatDurationShort(claimRemainingSeconds) : '',
            createdAt: giveaway.createdAt || '',
            createdAtHuman: giveaway.createdAt ? new Date(giveaway.createdAt).toLocaleString() : '',
            updatedAt: giveaway.updatedAt || '',
            updatedAtHuman: giveaway.updatedAt ? new Date(giveaway.updatedAt).toLocaleString() : '',
            ended: toBooleanString(!!giveaway.ended),
            paused: toBooleanString(!!giveaway.paused),
            entriesClosed: toBooleanString(!!giveaway.entriesClosed),
            autoClose: toBooleanString(!!giveaway.autoClose),
            duration: Number(giveaway.duration) || 0,
            displayDuration: Number(giveaway.displayDuration) || 0,
            claimDuration: Number(giveaway.claimDuration) || 0,
            claimMode: (giveaway.claimMode || '') as string,
            enableClaimTimer: toBooleanString(giveaway.enableClaimTimer !== false),
            requireClaim: toBooleanString(giveaway.requireClaim !== false),
            autoRerollOnExpire: toBooleanString(!!giveaway.autoRerollOnExpire),
            retentionDays: Number(giveaway.retentionDays) || 0,
            requeueExpired: toBooleanString(!!giveaway.requeueExpired),
            requeueDenied: toBooleanString(!!giveaway.requeueDenied),
            allowMultipleEntries: toBooleanString(!!giveaway.allowMultipleEntries),
            maxEntriesPerUser: Number(giveaway.maxEntriesPerUser) || 0,
            position: (giveaway.position || '') as string,
            overlayInstance: (giveaway.overlayInstance || '') as string,
        };
        if (options.size === 1) {
            if (options.has('totalEntries')) return values.totalEntries;
            if (options.has('winnerCount')) return values.winnerCount;
            if (options.has('pendingCount')) return values.pendingCount;
            if (options.has('ended')) return values.ended;
            if (options.has('paused')) return values.paused;
            if (options.has('entriesClosed')) return values.entriesClosed;
            if (options.has('autoClose')) return values.autoClose;
            if (options.has('enableClaimTimer')) return values.enableClaimTimer;
            if (options.has('requireClaim')) return values.requireClaim;
            if (options.has('autoRerollOnExpire')) return values.autoRerollOnExpire;
            if (options.has('requeueExpired')) return values.requeueExpired;
            if (options.has('requeueDenied')) return values.requeueDenied;
            if (options.has('allowMultipleEntries')) return values.allowMultipleEntries;
            if (options.has('id')) return values.id;
            if (options.has('title')) return values.title;
            if (options.has('prize')) return values.prize;
            if (options.has('category')) return values.category;
            if (options.has('status')) return values.status;
            if (options.has('winner')) return values.winner;
            if (options.has('winnerStatus')) return values.winnerStatus;
            if (options.has('winnerOddsPercent')) return values.winnerOddsPercent;
            if (options.has('winnerOddsFraction')) return values.winnerOddsFraction;
            if (options.has('entryCommand')) return values.entryCommand;
            if (options.has('claimCommand')) return values.claimCommand;
            if (options.has('closeTime')) return values.closeTime;
            if (options.has('closeTimeHuman')) return values.closeTimeHuman;
            if (options.has('closeRemainingSeconds')) return values.closeRemainingSeconds;
            if (options.has('closeRemainingHuman')) return values.closeRemainingHuman;
            if (options.has('claimRemainingSeconds')) return values.claimRemainingSeconds;
            if (options.has('claimRemainingHuman')) return values.claimRemainingHuman;
            if (options.has('createdAt')) return values.createdAt;
            if (options.has('createdAtHuman')) return values.createdAtHuman;
            if (options.has('updatedAt')) return values.updatedAt;
            if (options.has('updatedAtHuman')) return values.updatedAtHuman;
            if (options.has('duration')) return values.duration;
            if (options.has('displayDuration')) return values.displayDuration;
            if (options.has('claimDuration')) return values.claimDuration;
            if (options.has('claimMode')) return values.claimMode;
            if (options.has('retentionDays')) return values.retentionDays;
            if (options.has('maxEntriesPerUser')) return values.maxEntriesPerUser;
            if (options.has('position')) return values.position;
            if (options.has('overlayInstance')) return values.overlayInstance;
            if (options.has('winnerStatusCount')) return winnerStatusCount;
            if (options.has('winnersRaw')) return filteredWinners;
            if (options.has('winnersCount')) return winnerCountValue;
            if (options.has('winners'))
                return filteredWinners.length
                    ? filteredWinners.map((w) => w.username).join(winnersSeparator)
                    : 'No winners yet';
            if (
                options.has('winnersDetailed') ||
                options.has('winnersStatus') ||
                options.has('winnersWonAt') ||
                options.has('winnersOddsPercent') ||
                options.has('winnersOddsFraction')
            ) {
                return filteredWinners.length ? formatWinners() : 'No winners yet';
            }
            if (options.has('entriesRaw')) return entries;
            if (options.has('entriesCount')) return entries.length;
            if (options.has('entriesList'))
                return entries.length ? entries.map((e) => e.username).join(entriesSeparator) : '';
            if (options.has('entriesDetailed')) return entries.length ? formatEntries() : '';
        }
        const parts: string[] = extraNames
            .filter((name) => options.has(name))
            .map((name) => name + ': ' + JSON.stringify(eligibility?.[name]));
        if (options.has('id')) parts.push(values.id);
        if (options.has('title')) parts.push(values.title);
        if (options.has('prize')) parts.push(`prize: ${values.prize}`);
        if (options.has('category')) parts.push(`cat: ${values.category}`);
        if (options.has('status')) parts.push(`status: ${values.status}`);
        if (options.has('totalEntries')) parts.push(`entries: ${values.totalEntries}`);
        if (options.has('winner')) parts.push(values.winner ? `winner: ${values.winner}` : `winner: none`);
        if (options.has('winnerStatus') && values.winnerStatus) parts.push(`winnerStatus: ${values.winnerStatus}`);
        if (options.has('winnerOddsPercent') && values.winnerOddsPercent)
            parts.push(`odds: ${values.winnerOddsPercent}`);
        if (options.has('winnerOddsFraction') && values.winnerOddsFraction)
            parts.push(`odds: ${values.winnerOddsFraction}`);
        if (options.has('winnerCount')) parts.push(`winners: ${values.winnerCount}`);
        if (options.has('pendingCount')) parts.push(`pending: ${values.pendingCount}`);
        if (options.has('closeTime') && values.closeTime) parts.push(`close: ${values.closeTime}`);
        if (options.has('closeTimeHuman') && values.closeTimeHuman) parts.push(`closeLocal: ${values.closeTimeHuman}`);
        if (options.has('closeRemainingHuman') && values.closeRemainingHuman)
            parts.push(`closeLeft: ${values.closeRemainingHuman}`);
        if (options.has('claimRemainingHuman') && values.claimRemainingHuman)
            parts.push(`claimLeft: ${values.claimRemainingHuman}`);
        if (options.has('entryCommand') && values.entryCommand) parts.push(`enter: ${values.entryCommand}`);
        if (options.has('claimCommand') && values.claimCommand) parts.push(`claim: ${values.claimCommand}`);
        if (options.has('createdAt') && values.createdAt) parts.push(`created: ${values.createdAt}`);
        if (options.has('updatedAt') && values.updatedAt) parts.push(`updated: ${values.updatedAt}`);
        if (options.has('position') && values.position) parts.push(`pos: ${values.position}`);
        if (options.has('overlayInstance') && values.overlayInstance) parts.push(`overlay: ${values.overlayInstance}`);
        if (options.has('winnerStatusCount')) {
            parts.push(`wins(${requestedStatus}): ${winnerStatusCount}`);
        }
        const wantsWinnersList =
            options.has('winners') ||
            options.has('winnersDetailed') ||
            options.has('winnersStatus') ||
            options.has('winnersWonAt') ||
            options.has('winnersOddsPercent') ||
            options.has('winnersOddsFraction');
        if (wantsWinnersList) {
            if (filteredWinners.length > 0) {
                parts.push(`winners: ${formatWinners()}`);
            } else {
                parts.push('winners: none');
            }
        }
        if (options.has('entriesList') || options.has('entriesDetailed')) {
            if (entries.length > 0) {
                const label = options.has('entriesDetailed') ? 'entriesDetailed' : 'entries';
                const formatted = options.has('entriesDetailed')
                    ? formatEntries()
                    : entries.map((e) => e.username).join(entriesSeparator);
                parts.push(`${label}: ${formatted}`);
            } else {
                parts.push('entries: none');
            }
        }
        return parts.join(' | ');
    },
};
export const giveawayWinSearchVariable: ReplaceVariable = {
    definition: {
        handle: 'giveawayWinSearch',
        description:
            "Find a user's approved wins from the history archive, optionally filtered by category and time window. Modes: full|category|time|formattedTime, supports calendar-day windows via the 'calendar' flag and raw ISO timestamps via 'rawtime'",
        usage: 'giveawayWinSearch[username, categoryOrMode?, modeOrUnitOrWindow?, unitOrWindow?] (ex: giveawayWinSearch[user, category, gc])',
        examples: [
            {
                usage: 'giveawayWinSearch[contestantName]',
                description:
                    "Returns full details with timestamps per category (e.g., 'gaming: 2024-12-18T10:30:00.000Z (2 days ago), tech: 2024-12-15T14:20:00.000Z (5 days ago)')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, full]',
                description: 'Explicitly return full details (same as default) with category and time',
            },
            {
                usage: 'giveawayWinSearch[contestantName, category]',
                description: "Returns comma-separated list of categories user won in (e.g., 'gaming, tech, books')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, category, gaming]',
                description: "Returns whether user has won in specific category (e.g., 'true' or 'false')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, time]',
                description: "Returns time in days since last win per category (e.g., 'gaming: 2, tech: 5, books: 12')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, time, gaming]',
                description: 'Returns time in days since last win in specific category (e.g., 2)',
            },
            {
                usage: 'giveawayWinSearch[contestantName, time, gaming, hours]',
                description: 'Returns time in hours since last win (e.g., 48)',
            },
            {
                usage: 'giveawayWinSearch[contestantName, formattedTime]',
                description:
                    "Returns formatted time since last win (e.g., 'gaming: 2 days, tech: 5 days, books: 12 days')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, formattedTime, gaming, hours]',
                description: "Returns formatted time in specific unit (e.g., 'gaming: 48 hours')",
            },
            {
                usage: 'giveawayWinSearch[contestantName, category, gaming, 30 days]',
                description: "Returns 'true' if user won in 'gaming' within last 30 days, else 'false'",
            },
            {
                usage: 'giveawayWinSearch[contestantName, time, gaming, 7 days]',
                description: "Returns days since last 'gaming' win if within 7 days, else 'no_wins_in_category'",
            },
            {
                usage: 'giveawayWinSearch[contestantName, category, tech, 90 days]',
                description: "Checks if user has a win in 'tech' within 90 days (true/false)",
            },
            {
                usage: 'giveawayWinSearch[contestantName, formattedTime, books]',
                description: "Shows formatted time since last 'books' win (e.g., '12 days')",
            },
            {
                usage: 'giveawayWinSearch[user, category, gaming, 7 days, calendar]',
                description:
                    "Checks if user has a win in 'gaming' within the last 7 calendar days (ignores hours-of-day)",
            },
            {
                usage: 'giveawayWinSearch[user, formattedTime, gaming, calendar]',
                description: "Shows calendar-day diff for last gaming win (e.g., 'gaming: 1 days')",
            },
            {
                usage: 'giveawayWinSearch[user, category, gaming, rawtime]',
                description:
                    "Returns the raw ISO timestamp for the last win in 'gaming' (e.g., 'gaming: 2025-12-23T20:03:44.864Z')",
            },
        ],
        possibleDataOutput: ['text', 'number', 'bool'],
    },
    evaluator: async (_trigger, username: string, arg1?: string, arg2?: string, arg3?: string, arg4?: string) => {
        if (!username) return 'no_user';
        const validModes = ['full', 'category', 'time', 'formattedtime'] as const;
        const isMode = (value?: string): value is (typeof validModes)[number] =>
            !!value && (validModes as readonly string[]).includes(value.toLowerCase());
        const restRaw: Array<string | undefined> = [arg1, arg2, arg3, arg4].map((v) =>
            typeof v === 'string' ? v.trim() : v,
        );
        const calendarFlagSet = new Set(['calendar', 'calendarday', 'calendardays', 'calendar-day', 'calendar-days']);
        const rawTimeFlagSet = new Set(['rawtime', 'rawts', 'rawtimestamp', 'timestamp']);
        const flagSet = new Set<string>([...calendarFlagSet, ...rawTimeFlagSet]);
        const calendarMode = restRaw.some((v) => v && calendarFlagSet.has(v.toLowerCase()));
        const includeRawTime = restRaw.some((v) => v && rawTimeFlagSet.has(v.toLowerCase()));
        const rest: Array<string | undefined> = restRaw.filter((v) => !(v && flagSet.has(v.toLowerCase())));
        let categoryFilter: string | undefined;
        let outputMode: (typeof validModes)[number] = 'full';
        let unitInput: string | undefined;
        if (isMode(rest[0])) {
            outputMode = rest[0].toLowerCase() as (typeof validModes)[number];
            unitInput = rest[1];
        } else if (rest[0]) {
            categoryFilter = rest[0];
            if (isMode(rest[1])) {
                outputMode = rest[1].toLowerCase() as (typeof validModes)[number];
                unitInput = rest[2];
            } else {
                // default for category-filtered calls
                outputMode = 'time';
                unitInput = rest[1];
            }
        } else {
            outputMode = 'full';
        }
        // Normalize unit and optional window
        const unitMs: Record<
            string,
            {
                label: string;
                ms: number;
            }
        > = {
            second: { label: 'seconds', ms: 1000 },
            seconds: { label: 'seconds', ms: 1000 },
            sec: { label: 'seconds', ms: 1000 },
            s: { label: 'seconds', ms: 1000 },
            minute: { label: 'minutes', ms: 60 * 1000 },
            minutes: { label: 'minutes', ms: 60 * 1000 },
            min: { label: 'minutes', ms: 60 * 1000 },
            m: { label: 'minutes', ms: 60 * 1000 },
            hour: { label: 'hours', ms: 60 * 60 * 1000 },
            hours: { label: 'hours', ms: 60 * 60 * 1000 },
            hr: { label: 'hours', ms: 60 * 60 * 1000 },
            h: { label: 'hours', ms: 60 * 60 * 1000 },
            day: { label: 'days', ms: 24 * 60 * 60 * 1000 },
            days: { label: 'days', ms: 24 * 60 * 60 * 1000 },
            d: { label: 'days', ms: 24 * 60 * 60 * 1000 },
            week: { label: 'weeks', ms: 7 * 24 * 60 * 60 * 1000 },
            weeks: { label: 'weeks', ms: 7 * 24 * 60 * 60 * 1000 },
            w: { label: 'weeks', ms: 7 * 24 * 60 * 60 * 1000 },
            month: { label: 'months', ms: 30 * 24 * 60 * 60 * 1000 },
            months: { label: 'months', ms: 30 * 24 * 60 * 60 * 1000 },
            mo: { label: 'months', ms: 30 * 24 * 60 * 60 * 1000 },
            year: { label: 'years', ms: 365 * 24 * 60 * 60 * 1000 },
            years: { label: 'years', ms: 365 * 24 * 60 * 60 * 1000 },
            y: { label: 'years', ms: 365 * 24 * 60 * 60 * 1000 },
        };
        const dayMs = unitMs.day.ms;
        const parseUnitAndWindow = (input?: string) => {
            const defaultUnit = 'days';
            if (!input) return { unitKey: defaultUnit, windowMs: undefined };
            const trimmed = input.trim();
            const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(\w+)$/);
            if (match) {
                const value = parseFloat(match[1]);
                const unitKey = (match[2] || defaultUnit).toLowerCase();
                const unit = unitMs[unitKey] || unitMs[defaultUnit];
                return { unitKey, windowMs: value * unit.ms };
            }
            const unitKey = trimmed.toLowerCase();
            return { unitKey, windowMs: undefined };
        };
        const unitKeyParsed = parseUnitAndWindow(unitInput).unitKey;
        // If mode-first parsing was used and the "unit" isn't a recognized unit, interpret it as a category filter and fall back to default unit.
        if (!categoryFilter && isMode(rest[0]) && unitInput && !unitMs[unitKeyParsed]) {
            categoryFilter = unitInput;
            unitInput = rest[2];
        }
        // Re-parse after potential category reassignment
        const parsed = parseUnitAndWindow(unitInput);
        const unitKeyResolved = unitMs[parsed.unitKey] ? parsed.unitKey : 'days';
        const unitResolved = unitMs[unitKeyResolved] || unitMs.days;
        const unitLabel = unitResolved.label;
        const divisor = unitResolved.ms;
        const windowMs = parsed.windowMs;
        const windowDays = calendarMode && windowMs != null ? windowMs / dayMs : null;
        const isoString = (ts: number) => new Date(ts).toISOString();
        const diffCalendarDays = (ts: number) => {
            const toStartOfDay = (timeMs: number) => {
                const d = new Date(timeMs);
                return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            };
            const todayStart = toStartOfDay(now);
            const targetStart = toStartOfDay(ts);
            return Math.max(0, Math.floor((todayStart - targetStart) / dayMs));
        };
        const winsByCategoryKey = new Map<
            string,
            {
                category: string;
                ts: number;
            }
        >();
        const now = Date.now();
        const userLower = normalizeUsername(username);
        const collectWin = (category: string, win: any) => {
            if (!win?.username) return;
            if (key(win.username) !== userLower) return;
            if (win.status && win.status !== 'approved') return;
            // Use approval time when present since history is recorded at approval, fall back to wonAt/storedAt.
            const ts = new Date(win.approvedAt ?? win.wonAt ?? win.storedAt).getTime();
            if (Number.isNaN(ts)) return;
            if (calendarMode && windowDays != null && diffCalendarDays(ts) > windowDays) return;
            if (!calendarMode && windowMs != null && now - ts > windowMs) return;
            const categoryKey = String(category || 'uncategorized').toLowerCase();
            const existing = winsByCategoryKey.get(categoryKey);
            if (existing == null || ts > existing.ts) {
                winsByCategoryKey.set(categoryKey, { category: category || 'uncategorized', ts });
            }
        };
        const collectHistoryWins = (record: { category?: string; winner?: any }) => {
            const category = record?.category || 'uncategorized';
            const win = record?.winner;
            collectWin(category, win);
        };
        const history = await giveawayManager.getWinnerHistory();
        for (const record of history) {
            collectHistoryWins(record);
        }
        if (winsByCategoryKey.size === 0) {
            if (outputMode === 'category' && categoryFilter) return 'false';
            return 'no_wins';
        }
        const toDiff = (ts: number) => {
            if (calendarMode && unitLabel === 'days') {
                return diffCalendarDays(ts);
            }
            return Math.max(0, Math.floor((now - ts) / divisor));
        };
        // Category-filtered result (single category output)
        if (categoryFilter) {
            const key = categoryFilter.toLowerCase();
            const match = winsByCategoryKey.get(key);
            if (includeRawTime && match) {
                return `${match.category}: ${isoString(match.ts)}`;
            }
            if (outputMode === 'category') return match ? 'true' : 'false';
            if (!match) return 'no_wins_in_category';
            if (outputMode === 'time') return toDiff(match.ts);
            if (outputMode === 'formattedtime') return `${match.category}: ${toDiff(match.ts)} ${unitLabel}`;
            return `${match.category}: ${new Date(match.ts).toISOString()} (${toDiff(match.ts)} ${unitLabel} ago)`;
        }
        // All categories output
        const sorted = Array.from(winsByCategoryKey.values()).sort((a, b) => b.ts - a.ts);
        if (includeRawTime) {
            return sorted.map((w) => `${w.category}: ${isoString(w.ts)}`).join(', ');
        }
        if (outputMode === 'category') {
            return sorted.map((w) => w.category).join(', ');
        }
        if (outputMode === 'time') {
            return sorted.map((w) => `${w.category}: ${toDiff(w.ts)}`).join(', ');
        }
        if (outputMode === 'formattedtime') {
            return sorted.map((w) => `${w.category}: ${toDiff(w.ts)} ${unitLabel}`).join(', ');
        }
        return sorted
            .map((w) => `${w.category}: ${new Date(w.ts).toISOString()} (${toDiff(w.ts)} ${unitLabel} ago)`)
            .join(', ');
    },
};

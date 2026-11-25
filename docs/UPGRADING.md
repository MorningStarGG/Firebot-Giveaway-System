# Upgrading and using Giveaway System v2.0

## Entry and win rules

Account usernames are trimmed and lowercased centrally, whether supplied by `$user`, `$target`, or typed manually. Entries, winners, event metadata, effect outputs, and variable results use that same lowercase identity. Username lookups also accept mixed case. Giveaway titles, categories, and IDs retain their existing casing rules. The overlay resolves preferred display names through Firebot's viewer database for the winner view, winner rotation, and ticker. The plugin does not store a separate display-name field in its database.

Display-name lookups run outside giveaway transactions and do not delay a draw or claim. The overlay initially uses the lowercase username when necessary and updates once a display name is available. Results are cached for five minutes, with up to 512 account names per plugin session, missing/blank names, lookup errors, or an unavailable viewer database fall back to the username. Late results cannot overwrite a newer overlay update or re-show a hidden/removed giveaway. Display names are sent as literal text, and never replace the lowercase usernames used by conditions, variables, events, or saved history.

Each entry is an independent ticket. A draw consumes exactly the selected ticket, other tickets belonging to that person stay in the pool. Denied/expired requeue returns that same ticket, with its original identity and weight.

A person can have one unresolved win (pending or claimed) per giveaway. Their remaining tickets are held until it is resolved. Once approved, other tickets may win again unless a configured win limit blocks them. An auto-approved multi-pick can therefore select the same person more than once. Turning auto-approval off holds that person after the first pending win.

**Max Entries Per User** counts admissions for the whole run, rather than remaining tickets. Winning, removal, denial, clearing the pool, and Restart do not refill the allowance. **Reset Run** starts a new run and allowance. Requeue does not spend another admission.

**Approved Wins per Person** is unlimited when blank. Each giveaway chooses its own maximum, scope (**This Giveaway Run**, **Same Category**, or **All Giveaways**), and period (**Until Counts Are Reset** or a **Rolling Window**). Rolling windows use approval time. Pending wins reserve capacity during draws. Approval rechecks the current cap, if it has been reached, the win stays unresolved and the action reports the reason.

Add Entry also checks this approved-win policy before admitting a ticket. A pending or claimed win is not an approved win and does not by itself block admission. Existing tickets remain stored when someone reaches the cap, the draw eligibility rules still apply to them.

Policies use shared history without sharing their settings: a category cap of two on giveaway A does not force giveaway B to use that cap. Counts cover this plugin’s records in the current Firebot profile. External roles, metadata, conditionals and commands are not imported or changed.

**Reset This Giveaway’s Win Counts** resets that policy’s counting baseline without removing history or resetting another giveaway. Display-history purges and retention do not bypass win limits. Revoking an approval removes it from the counted total. Starting a new run resets the current-run scope, category/all scopes continue using recorded approvals until their policy window or baseline excludes them.

**Reroll Winner** defaults to **Require Different Person**, with **Allow Previous Person** available. This applies to manual and automatic rerolls. The previous person is excluded only from the immediate replacement, and the usual pending-win and win-limit rules still apply. A manual skip succeeds even when no replacement is eligible, its `winner` output is empty and the skipped win stays recorded. Rerolls target the selected username or Win ID.

Weights affect each draw. Alice’s two weight-2 entries and Bob’s one weight-2 entry give Alice 66.67% and Bob 33.33%. Displayed draw odds combine all eligible entries belonging to that person, the selected ticket’s weight is recorded separately. Invalid/nonpositive weights and invalid winner counts fail without consuming an entry. Random selection uses Node’s cryptographic random source.

## Optional entry-event controls

Every **Add Entry**, including the management page, follows this sequence:

1. **Giveaway Entry Attempted** runs before a ticket is saved. Its metadata describes the entering person and the current built-in rules.
2. Inline event effects may use **Advanced Giveaway Manager → Entry Management → Cancel Entry Attempt** or **Set Entry Attempt Odds**.
3. The plugin checks the latest giveaway status, run, approved-win limit, and admission allowance, then saves one ticket if allowed.
4. **Giveaway Entry Accepted** fires after that save, or **Giveaway Entry Rejected** fires with an explanation when cancelled or disallowed by a built-in rule.

There is no mode switch and no Accept action. If you have no Entry Attempted effects, or none of your conditional branches changes the attempt, normal admission rules apply. Custom controls can veto admission or change that ticket's positive odds multiplierm they do not bypass built-in limits. Metadata is a snapshot: changing user metadata does not directly change an attempt.

Leave **Entry Attempt ID** blank in either control to use the current Entry Attempted event automatically. It also accepts `$eventMeta[entryAttemptId]`. An explicit ID in that event must match its current attempt. Each simultaneous entry has a separate ID. No giveaway selection or username is needed for these two actions. **Reason** on cancellation is optional and appears in the rejected event and Add Entry outputs. The last valid odds change wins, cancellation cannot be reversed, and later odds changes are ignored. Cancellation does not stop the rest of the Firebot effect list or remove existing tickets.

For example, to prevent a person with an unapproved claim from submitting another entry, add an Entry Attempted event, check `$eventMeta[claimedWins]` greater than zero in a Firebot conditional, and run **Cancel Entry Attempt** with a reason such as `Your previous prize is awaiting approval.` Leave the other branch empty. In a separate **Entry Rejected** event, send `@$eventMeta[username]: $eventMeta[reasonText]`. Use **Entry Accepted** for the success message. Move unconditional entry-confirmation chat out of your command so it does not report rejected attempts as successful.

Controls must finish inline before Entry Attempted completes. Firebot queues and background effect lists can return before their contents run, a control executed later reports that the attempt is no longer open and cannot undo a saved ticket. Use ordinary inline conditionals for admission decisions. Do not call Add Entry again from Entry Attempted, recursive Add Entry is rejected. Normal Firebot queues remain under the user's control.

### Entry-event metadata

Use `$eventMeta[field]` in Firebot effects and conditionals. `username` always identifies the person being entered, including when someone else submits their entry.

| Fields | Meaning |
| --- | --- |
| `entryAttemptId`, `giveawayId`, `giveawayTitle`, `category`, `prize`, `runId` | Attempt and giveaway context. The attempt ID is transient, separate from a saved ticket's ID. |
| `username`, `oddsMultiplier`, `totalEntries` | Entering person, current/final ticket weight, and pool size. Accepted includes the saved ticket. |
| `admissions`, `entryLimit` | Admissions already used by that person in this run and the effective maximum. Accepted includes the new admission. |
| `approvedWins` | Durable approved count using this giveaway's current scope, period, and reset baseline. |
| `pendingWins`, `claimedWins` | Unresolved wins in that scope, separated by status. These are current unresolved records, not approval-window counts. |
| `winLimitMaximum`, `winLimitScope`, `winLimitPeriod`, `winLimitDays` | Current policy. Maximum is null for unlimited, scope is `giveaway`, `category`, or `all` period is `untilReset` or `rolling`. Days applies to rolling windows. |
| `canEnter`, `reason`, `reasonText` | Preliminary built-in decision on Attempted, actual outcome on Accepted/Rejected. Final rules are rechecked after the hook. |
| `entryAccepted`, `entryId` | Final events include the acceptance boolean. Only Accepted includes the new ticket's `entryId`. |

Rejection reason codes are `cancelled`, `stopped`, `paused`, `closed`, `win_limit`, `entry_limit`, and `giveaway_changed`. A removed, replaced, or reset giveaway cannot inherit an earlier attempt. When several built-in rules block admission, status is checked first, then the approved-win cap, then the admission limit. Explicit cancellation reports its cancellation reason.

Add Entry retains `winner` and `entryCount` outputs and adds `entryAccepted`, `entryReason`, `entryReasonText`, `entryAttemptId`, and `entryOddsMultiplier`. Expected rejection is a handled result (`success: true`, `entryAccepted: false`), so subsequent Firebot effects continue. Invalid settings, dispatch failures, and failed storage writes remain errors. Invalid inline control settings also fail the original attempt rather than silently admitting it with unchanged defaults. Rejections and attempt controls do not write giveaway data, spend an admission, or refresh the overlay. Source cancellation or plugin unload closes pending attempts, late controls cannot change tickets.

Existing `$giveawayWinSearch` calendar-day/history behavior is unchanged. For a custom calendar rule, use the same query in Entry Attempted, targeting `$eventMeta[username]` in place of `$user`, then conditionally cancel. This variable searches retained display history, the built-in approved-win cap uses the separate durable ledger. No new calendar-policy setting or database migration is introduced by entry events.

Firebot's manual event test supplies example metadata, including a dummy attempt ID. It can preview messages and conditionals, but there is no live attempt for Manager controls to change. Test the complete admission flow with Add Entry on a disposable giveaway.

## Management page and effects

Open **Extensions → Giveaways** to create and start a giveaway, save configuration without restarting, manage entries and winners, inspect eligibility, change visibility/status, reset counts, and manage history/backups. The configuration form is shared with the Create effect.

Refreshing updates stored state without replacing unsaved configuration drafts. UI edits affect the stored giveaway. A saved Create effect remains a reusable configured action: running it reapplies its saved configuration and starts/reopens that giveaway. Saved Manager actions keep their configured values when reopened. Existing Firebot effect-list queues remain under your control.

Giveaway IDs retain case and use the existing `giveaway_` prefix, with title punctuation/spaces converted to underscores. For example, `Monthly Games` becomes `giveaway_Monthly_Games`. Changing the ID creates a separate giveaway. The management page keeps an existing giveaway’s ID stable.

Running Create shows its giveaway. Show can explicitly display stored state again. Overlay connection does not replay every stored giveaway. Each displayed giveaway has its own document, preventing styles, timers and animations from affecting another giveaway.

The entry and claim command fields remain **display text only**. Create chat commands in Firebot and use Manager effects to submit entries/claims. Role and metadata conditions can still be used for other eligibility requirements.

## Configuration and template library

The top toolbar selects the giveaway. Its status and common actions sit above the main tabs, **More** contains restart, stop, reset, and removal controls. Selection is remembered per profile in `giveaway-ui.json`, separately from giveaway state. Reopening the page restores **Entries & Winners**, a missing selection leaves a lightweight selection screen.

Both the page and Create effect use **Basics**, **Rules**, **Claims & Timing**, **Display**, and **Appearance**. Defaults initialize even when a section has not been opened. Switching sections preserves the draft while destroying hidden controls. Display settings and color pickers load in smaller groups. Tables return 50 rows per page with search, the backend caps individual requests at 100 rows.

The **Templates** library is stored in the profile's plugin database. Save any configuration draft as a template, or create one directly in the library. Templates can be edited, duplicated, renamed, deleted, and previewed. Preview compares configuration fields before filling a draft:

- **For a New Giveaway** fills the new configuration form. Choose its title and run **Create & Start** when ready.
- **For the Selected Giveaway** keeps the existing title, ID, and overlay instance. **Save Configuration** asks for confirmation and updates configuration without restarting or clearing entries, winners, admissions, or policy reset baselines. Changed claim timers and win policies follow the normal configuration rules described below.
- **Load Template** in the Create effect editor copies configuration once, preserving the effect's existing title, overlay instance, and Firebot action metadata. Saving that effect keeps the copy, even if the library template is later changed or deleted. Running the effect retains its normal start/reopen behavior.

Templates contain configuration only. They do not capture entries, winners, history, admissions, run/entry/win IDs, deadlines, approval ledgers, or reset baselines. Overlay instances and image resource tokens are not shared through templates.

Use **Export Selected** for one or more library entries, or **Export Library** for all entries. Selection can span pages, **Clear Selection** clears it. The downloaded JSON uses the versioned `msgg:giveaway-templates` format. **Import Files** previews names, images, and conflicts, choose **Keep Both** (the default), **Replace** an explicit library entry, or **Skip** for each record, then confirm the import. Importing affects the library only and does not create or start giveaways.

Local images are captured into plugin-managed `template-assets` storage when a template is saved. Export embeds the bytes and deduplicates identical images by SHA256, import checks their format and hash before storing them. Original local paths are excluded from files and imported paths are never read. URL images keep their URLs. Supported local formats are PNG, JPEG, GIF, WebP, BMP, AVIF, and SVG. Limits are 20 MiB per image, 50 MiB per JSON file, and 500 templates per file, split larger libraries with Export Selected. Missing or invalid images fail with an error instead of silently producing a broken export.

Deleting a library entry retains managed images because saved effects and existing giveaways may still use their copied paths. Include the whole scoped plugin data directory when backing up the library and its local assets.

The service caches its committed database state. UI refresh reads that state and preserves drafts, **Reload Stored Configuration** deliberately discards the selected draft. Saves detect configuration changes made elsewhere without treating ordinary entry/winner changes as conflicts. Stop/reload the plugin around manual database file edits. UI Refresh does not reload external file changes.

## Claims and lifecycle

Manual draws remain available while paused/stopped. Automatic draws respect pause/stop state. Paused claim clocks stay frozen, including newly drawn claims, and pause/resume preserves fractions of a second.

Changing claim mode or duration updates pending clocks only when that setting changes. Enabling a timer or changing its duration starts the configured full duration, disabling it clears pending deadlines. Paused claims remain paused, and changing settings never automatically approves existing pending wins. Claimed wins continue waiting for approval without a claim deadline.

On plugin load, expired pending timed claims receive a fresh full window. Unexpired deadlines stay unchanged, ordinary scheduler checks do not renew expired claims. Auto-close closes entries once and preserves unresolved claims. An empty eligible pool can still contain held tickets, so it does not falsely emit Giveaway Empty.

## Data migration and backups

Disable the old startup script before enabling the plugin. The plugin imports the current profile’s legacy `db/giveawaySystem.db` only when its scoped plugin database is absent. It preserves the source and saves a byte-for-byte backup before import/migration. An existing scoped database always wins. Invalid data stops loading with an error instead of being overwritten.

Existing schema-v2 databases also receive username normalization on load, including current entries, unresolved/resolved winners, embedded winning tickets, history, approval records, and backups. A changed database is saved atomically after creating a byte-for-byte `pre-username-normalization-giveaway-*.db.backup` in the plugin's storage directory. Already normalized data is not rewritten. Tickets and win/run IDs, weights, statuses, timestamps, approval sequences, and reset baselines are retained, differently cased admission-counter keys for the same account are combined while preserving their total. Existing mixed-case pending winners can therefore be claimed without redrawing or resetting the giveaway.

Migration preserves available giveaways, backups, settings, approved history and unknown root fields, assigns stable entry/run/win IDs, and seeds known admission and approval records. Old code discarded other tickets when someone won, deleted tickets, previously purged history, and unknown earlier admissions cannot be reconstructed. Reliable identity information is used to deduplicate archival/current copies of the same win.

Approved win accounting has its own durable ledger, separate from display-history retention. Mutations use serialized, atomic database commits. Entry Attempted runs before admission, successful outcome events run after commit. All event effects execute outside the state lock, so they can safely call the plugin again. A failed write emits no successful draw or entry event.

Backup restore offers explicit **Replace**, **Merge**, and cancellation. Merge without a current target restores the snapshot. Merge into an existing target deduplicates tickets and enforces its admission cap. Unresolved backup claims stay in the backup when they cannot safely join the current run. Skipped records retain the backup for a later full restore. Manual backup selection matches the exact base giveaway ID, so `Cup` cannot select `Cup2`. Manual restore uses replacement behavior. Failures are reported rather than logged as success.

Reload Firebot’s main window after adding/updating UI extensions, then refresh the overlay in OBS. Firebot’s released UI-extension loader requires a main-window reload to replace Angular components/routes.

## Existing contracts and added fields

The three effect IDs, four variable handles, existing eight event IDs, case-sensitive giveaway IDs, and `winner` / `entryCount` outputs remain available. Three entry events are added under `msgg:giveaway-system`: `entryAttempted`, `entryAccepted`, and `entryRejected`. Event metadata adds win, entry and run IDs, selected-ticket weight, and draw eligibility details.

| Variable | Added fields |
| --- | --- |
| `$giveawayInfo[id, field]` | `rawEntries`, `eligibleEntries`, `eligibleUsers`, `eligibleWeight`, `admissions`, `winLimit` |
| `$giveawayUserInfo[id, username, field]` | Those fields plus `approvedWins`, `oddsPercentage`, `held` |

Raw results include additive data. Pool entries and admissions are separate counts. Eligibility excludes held/limited tickets, use it when deciding whether a draw can proceed. User odds are a current eligibility calculation, while winner odds are the snapshot taken at the draw.

The production artifact remains `MSGG-GiveawaySystem.js`, now a native Firebot 5.67+ plugin. It is not compatible with the legacy startup-script loader. Build and acceptance instructions are in [README.md](../README.md).

Implementation references: Firebot’s [released plugin data-directory resolution](https://github.com/crowbartools/Firebot/blob/v5.67.0/src/backend/plugins/plugin-api/internal/plugin-data-dir.ts) and [legacy module adapter](https://github.com/crowbartools/Firebot/blob/v5.67.0/src/backend/plugins/legacy-helpers/custom-script-helpers.js) establish the current-profile migration path. The legacy [JsonDB filename configuration](https://github.com/Belphemur/node-json-db/blob/v1.4.1/src/lib/JsonDBConfig.ts) preserves the explicit `.db` extension. Native UI registration follows Firebot’s [released UI-extension interface](https://github.com/crowbartools/Firebot/blob/v5.67.0/src/types/ui-extensions.ts).

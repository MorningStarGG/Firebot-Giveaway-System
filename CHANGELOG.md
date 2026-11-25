# Changelog

## 2.0.0

### Highlights

- **Now a Firebot plugin:** Install through Settings > Plugins on Firebot 5.67.0 or newer.
- **A dedicated management page:** Create and manage giveaways, entries, winners, history, and backups in **Giveaways** in the firebot sidebar.
- **Reusable templates and file sharing:** Save giveaway setups, reuse them, and import or export templates with their local images.
- **More control over entries and wins:** Set approved-win limits and use new entry events for custom eligibility checks and chat responses.

### Plugin and management UI

- Added the Giveaways page with the giveaway selector at the top, quick actions, and separate **Entries & Winners**, **Configuration**, **History**, and **Backups** tabs.
- Organized configuration into **Basics**, **Rules**, **Claims & Timing**, **Display**, and **Appearance**. The management page and Create effect use the same form.
- Improved field grouping and spacing, with full-width text fields, grouped checkboxes, and paired color controls.
- Improved loading and search performance by loading controls as needed and paging large tables. The page remembers your last selected giveaway in each Firebot profile.
- Refreshing preserves unsaved configuration. Saves detect conflicting edits, and reopening a saved Manager effect keeps its configured action values.

### Templates and import/export

- Added a profile template library with options to create, edit, duplicate, rename, preview, and delete saved setups.
- Apply templates to a new giveaway or an existing giveaway's draft. Saving to an existing giveaway asks for confirmation and keeps its title, ID, overlay instance, entries, winners, and win counts.
- Added **Load Template** to the Create effect. It copies settings once, later library changes do not alter saved effects.
- Added **Export Selected**, **Export Library**, and **Import Files** for sharing JSON template files. Imports include a preview with **Keep Both**, **Replace**, or **Skip** choices.
- Local images travel with exported templates, image URLs remain URLs. Files contain configuration only, and importing or loading a template does not start a giveaway.

### Entries, odds, and win limits

- **Each entry is now a separate ticket.** Drawing a winner uses one ticket instead of removing all of that person's entries. Their remaining tickets wait while a win is unresolved, then can win again if the configured limits allow it.
- **Max Entries Per User now counts entries added during the entire run.** Winning, removing entries, clearing the pool, and Restart do not restore the allowance. Use **Reset Run** to start a new allowance, requeuing a ticket does not spend another entry.
- Added optional **Approved Wins per Person** limits, unlimited by default. Count wins for the current run, the same category, or all giveaways, using a rolling time window or counting until reset.
- Win limits apply when entering, drawing, and approving winners. Pending and claimed wins are reported separately, they are not approved wins and do not by themselves prevent entry.
- Win counts stay accurate when display history is cleared or expires. Counts can be reset for a giveaway without deleting history, and revoked approvals stop counting.
- Improved weighted winner selection and corrected displayed odds to combine all of a person's eligible tickets. Invalid weights and winner counts are rejected without consuming entries.
- Added reroll choices: **Require Different Person** (default) or **Allow Previous Person**. Use a Win ID to target a specific win, skipping a winner still works when no eligible replacement remains.
- Variables can now report eligible entries, a user's draw odds, entries used in the current run, and win limits. Event data includes entry and win IDs for targeting specific records. Existing variable fields remain supported.

### Optional entry-event controls

- Added **Giveaway Entry Attempted**, **Giveaway Entry Accepted**, and **Giveaway Entry Rejected** events. No mode switch is needed, normal entry rules apply when no custom controls are used.
- Added Manager actions to **Cancel Entry Attempt** with an optional explanation or **Set Entry Attempt Odds**. Run these within the Entry Attempted event before it finishes, each viewer's attempt is handled separately.
- Entry events provide approved, pending, and claimed win counts, entry allowances, and eligibility details for Firebot conditionals. Custom controls cannot bypass the giveaway's built-in limits.
- Rejected entries include a reason and readable explanation for chat responses. The management page also shows why an entry was rejected. See the [entry-event guide](docs/UPGRADING.md#optional-entry-event-controls) for setup examples.

### Fixes and reliability

- Fixed manually entered usernames with different capitalization failing to match claims or user checks. Account names are handled consistently in lowercase, the overlay uses the viewer's preferred display name when available.
- Restored compatibility with existing Manager effects and commands after conversion. Existing effect IDs, variable handles, events, and outputs remain available.
- Fixed lost updates when several actions run together. Successful entry and winner events now fire only after their changes are saved.
- Fixed pause/resume and claim-timer inconsistencies, including manual draws while paused and changes to claim settings. Claims that expired while Firebot was offline receive a fresh window on plugin load.
- Fixed repeated auto-close attempts and incorrect empty-pool notifications when entries were temporarily ineligible to win.
- Fixed backup restores that could lose or duplicate entries, exceed entry limits, select the wrong backup, or report success after failing. Backups are retained when some records cannot safely be merged.
- Improved overlay cleanup and routing so giveaways display on the selected overlay instance.

### Upgrading to v2.0

- Requires **Firebot 5.67.0 or newer**. Disable the old startup script before enabling the plugin, the download remains **MSGG-GiveawaySystem.js**.
- Existing giveaways, history, and backups are imported from the current profile when no plugin database exists. The original data is backed up before changes, and an existing plugin database takes priority.
- Reload Firebot's main window after adding or updating the plugin UI, then refresh the overlay in OBS.
- Read [Upgrading and using v2.0](docs/UPGRADING.md) for migration details, entry and repeat-win changes, claims, and command compatibility. See [README.md](README.md) for installation and features.

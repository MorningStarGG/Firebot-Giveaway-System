# Advanced Giveaway System for Firebot

A comprehensive and feature-rich giveaway system for Firebot, designed to be HIGHLY customizable with entry management, winner selection, and approval options.

## Features

### Giveaway Creation & Management
- Create giveaways with customizable entry tracking
- Two input modes for giveaway configuration:
  - Manual entry setup
  - Variable-based configuration
- Automatic or manual giveaway closing
- Entry management:
  - Single entry per user (default)
  - Multiple entries per user allowed (configurable)
  - Maximum admissions per user per run
  - Weighted entries with odds multipliers
- Entry command customization
- Pause/Resume functionality
- Close/Open entries independently of ending giveaway
- Reset giveaway (clear entries and winners)
- Backup system with 7-day retention
- Automatic cleanup of ended giveaways (configurable retention)
- Category system for organizing giveaways which can also be used in combination with variables to do things such as limit multiple entries within a set category
- Prize display and tracking

### Winner Selection & Management
- Weighted random winner selection with odds calculation
- Winner approval workflow:
  - Pick winner
  - Winner claims prize (optional)
  - Streamer approves or denies winner
- Three claim modes:
  - **Timer Mode**: Winner must claim within time limit
  - **Enabled Mode**: Winner must claim but no time limit
  - **Disabled Mode**: Winner auto-approved (no claim required)
- Claim timer with configurable duration
- Manual winner approval/denial
- Winner reroll functionality
- Auto-reroll on expired claims (optional)
- Multiple pending winners support with rotation
- Winner expiration handling
- Requeue options for denied/expired winners
- Search winner history by user and category

### Giveaway Options Management
- Add/remove individual entries
- Clear all entries
- Reset entire giveaway (entries + winners)
- Close/open entries independently
- Set entry odds multipliers per user
- Track user entry counts
- Query user entry status
- Remove specific user entries
- Category-based organization
- Custom retention periods

## Management UI

### Giveaway Management Page

- Open **Giveaways** in the Firebot sidebar to manage giveaways
- Top toolbar with giveaway selection, **New Giveaway**, **Templates**, and **Refresh**
- Remembers the last selected giveaway in the current Firebot profile
- **Entries & Winners**:
  - Add weighted entries and check eligibility
  - Search and page through pool entries and unresolved/resolved wins
  - Pick winners, manage claims, and approve or deny wins
- **Configuration**:
  - Shared form with the Create effect: **Basics**, **Rules**, **Claims & Timing**, **Display**, and **Appearance**
  - Create and start a giveaway, or save changes to the selected giveaway
  - Refresh preserves unsaved drafts, **Reload Stored Configuration** replaces the selected draft
- **History**: Search approved wins, set retention, and purge display history
- **Backups**: Browse, restore, and delete saved giveaway backups
- Quick controls for pause/resume, close/open entries, and show/hide
- **More** actions for restart, stop, **Reset Run**, **Reset Win Counts**, and **Remove & Back Up**
- Sections load as needed, with searchable paged tables and targeted refreshes

## Template Library

### Reusable Giveaway Configuration

- Open **Templates** from the management page toolbar
- **Save Draft as Template** keeps configuration in the current profile's library
- Create, edit, duplicate, rename, preview, and delete templates
- Apply a template to a new giveaway or an existing giveaway's configuration draft
- Saving a template-applied draft to an existing giveaway asks for confirmation and preserves its ID, title, overlay instance, entries, winners, and win-count baselines
- **Load Template** in the Create effect copies settings once, later library edits do not change saved effects
- Loading a template does not start a giveaway

## Import & Export

### Shareable Template Files

- **Export Selected** or **Export Library** downloads reusable configuration as JSON
- **Import Files** previews templates before importing them into the library
- Resolve each import with **Keep Both**, **Replace**, or **Skip**, then confirm
- Local images are embedded in exports and copied into managed storage on import, image URLs remain URLs
- Files contain configuration only, excluding entries, usernames, winner history, run IDs, and win-count baselines
- Importing files does not create or start giveaways
- Limits: 500 templates per file, 50 MiB per JSON file, and 20 MiB per embedded image
- See the [template library guide](docs/UPGRADING.md#configuration-and-template-library) for file and image handling details

## Display Features

### Visual Customization
- Custom background color
- Custom accent color
- Custom text color
- Custom title color
- Custom winner color
- Custom shadow color
- Custom prize label color
- Custom entry number color
- Extensive status-specific colors:
  - Entries closed color
  - Status paused color
  - Status ended color
  - Entry command color
  - Close timer colors (normal/urgent)
  - Claim command color
  - Claim timer colors (normal/urgent)
  - Winner pending color
  - Image text colors
  - Odds display color
- Adjustable giveaway scale
- Adjustable image scale
- Custom giveaway width

### Display Options
- Toggle title visibility
- Toggle prize visibility
- Prize display modes:
  - Label + Prize
  - Prize only
  - Label only
- Toggle entry count display
- Toggle entry command display
- Toggle winner display
- Toggle claim command display
- Toggle timer displays:
  - Close timer (time until entries close)
  - Claim timer (time for winner to claim)
- Odds display options:
  - Show/hide odds
  - Percentage format
  - Ratio format
  - Both formats
- Winner animation toggle
- Winner rotation (cycle through multiple pending winners)
- Custom text templates for all display elements

### Display Modes
- **Widget + Image**: Show both widget and image
- **Widget Only**: Show only the giveaway widget
- **Image Only**: Show only the giveaway image
- **Disabled**: Hide overlay completely - Command/text only mode for those who don't wish to use the overlay elements

### Widget Modes (when widget is shown)
- **Full Mode**: Complete giveaway information display
- **Minimal Mode**: Simplified display with essential info
- **Ticker Mode**: Scrolling/rotating information display

### Image Features
- Image placement options:
  - Above widget
  - Below widget
  - Left of widget
  - Right of widget
  - Background (behind widget)
  - None (no image)
- Image modes:
  - URL (direct image link)
  - Local file (from computer)
- Image overlay toggle
- Adjustable image scale
- Optional image text overlay:
  - Custom template with placeholders
  - Position options (top/bottom)
  - Adjustable text size
  - Custom colors

### Slide Mode
- **Cycle Mode**: Alternate between widget and image
- **Widget First**: Start with widget, then show image
- **Image First**: Start with image, then show widget
- **Disabled**: No alternating (static display)
- Configurable reveal interval
- Configurable visible duration

### Animations
Included are animations for the following events:
1. **Giveaway Start**: Smooth transition onto screen
2. **Winner Selected**:
   - Highlight animation
   - Confetti effect (when enabled)
   - Winner display with odds
3. **Entries Closed**:
   - Status indicator shows
   - Visual feedback
4. **Pausing a giveaway**:
   - Frost/freeze/blur effect
   - Pause indicator shows
5. **Resuming a giveaway**:
   - Animation reversal
   - Resume transition
6. **Giveaway Ended**:
   - End indicator
   - Winner highlight
   - Final winner display
7. **Winner Rotation**:
   - Smooth transitions between pending winners
   - Configurable rotation interval

## Events System

### Giveaway Events

- **Giveaway Entry Attempted** - Before admission, optional inline Manager controls can cancel or change this attempt's odds
- **Giveaway Entry Accepted** - After the ticket is saved, use for entry confirmation chat
- **Giveaway Entry Rejected** - Cancellation or a built-in admission rule blocked entry, includes a readable reason
- **Giveaway Started Event** - Triggered when a giveaway begins
- **Giveaway Stopped Event** - Triggered when a giveaway ends (manual or automatic)
- **Winner Picked Event** - Triggered when a winner is randomly selected
- **Winner Claimed Event** - Triggered when a winner claims their prize
- **Winner Approved Event** - Triggered when the streamer approves a winner
- **Winner Denied Event** - Triggered when the streamer denies a winner
- **Winner Expired Event** - Triggered when a winner fails to claim in time
- **Giveaway Empty Event** - Triggered when no entries remain after resolving winners

Entry events need no mode switch. Without custom controls, Add Entry follows the normal rules, including the configured **approved**-win cap. Pending and claimed wins are exposed separately. In **Entry Attempted**, use **Advanced Giveaway Manager → Entry Management → Cancel Entry Attempt** or **Set Entry Attempt Odds** inside Firebot conditionals. Leave **Entry Attempt ID** blank to target the current attempt, cancellation can include a reason. Controls must finish inline before that event completes.

Use `$eventMeta[username]`, `$eventMeta[approvedWins]`, `$eventMeta[pendingWins]`, and `$eventMeta[claimedWins]` for custom checks. Send `@$eventMeta[username]: $eventMeta[reasonText]` from **Entry Rejected**, and success chat from **Entry Accepted**. Expected rejections let subsequent effects continue, so replace unconditional command success messages with the Accepted event or check the new `entryAccepted` effect output. Existing `$giveawayWinSearch` calendar/history queries remain available. See [entry-event controls and metadata](docs/UPGRADING.md#optional-entry-event-controls) for examples, scope rules, outputs, and timing.

## Variables System

### Giveaway Search Variable
- `$giveawaySearch` - Search and list giveaways with extensive filtering
  - Search by scope (active/ended/current/backups/all)
  - Search by query (title/prize/category)
  - Field selection (id, title, category, prize, status, etc.)
  - Time calculations (remaining time, close time)
  - Count results
  - Raw/JSON output for advanced processing

### User Information Variable
- `$giveawayUserInfo` - Get user-specific giveaway information
  - Entry count for user
  - Whether user has entered
  - Whether user is a winner
  - Winner status (pending/claimed/approved/denied/expired)
  - User's odds multiplier
  - Last entry timestamp
  - Raw data output

### Giveaway Information Variable
- `$giveawayInfo` - Comprehensive giveaway details
  - Basic info (title, prize, category, status)
  - Entry statistics (total entries, unique entrants)
  - Winner information (current winner, all winners, filtered winners)
  - Timer information (close time, claim time remaining)
  - Configuration details (commands, durations, modes)
  - Entry/winner lists (detailed or simple)
  - Raw/JSON output options

### Winner History Variable
- `$giveawayWinSearch` - Search archived winner history
  - Search by username
  - Filter by category
  - Time-based filtering (days/hours/weeks/months)
  - Calendar-day mode for accurate day counting
  - Multiple output modes (full/category/time/formatted)
  - Raw timestamp output
  - Check if user won within time window

### Variable Display Options
- Multiple formatting options for each variable
- Customizable output formats
- Support for raw data output
- Custom separators for lists
- Time formatting options (human-readable, seconds, ISO timestamps)
- Boolean string outputs
- Count-only modes
- Detailed vs. simple modes

## Backup System

### Backup Features
- Automatic backup on giveaway removal
- Configurable backup retention (default 7 days)
- Backup restoration
- Backup browsing interface
- Manual backup deletion
- Winner archival before backup removal

## Winner History System

### Winner History Features
- Automatic archival of approved winners
- Configurable retention period (default 30 days) through the Manager effect or the Giveaways UI in Firebot sidebar **History** tab, affects **all** giveaways
- Category-based organization
- Search by username
- Search by category
- Time-window filtering
- Purge old records automatically
- Manual history management
- Source tracking (approved/backup/cleanup)

## Overlay UI Elements

### Real-time Overlay Features

- Live entry updates
- Live winner status updates
- Animated winner selection
- Interactive giveaway management
- Pause state visualization
- Winner highlighting
- Timer countdowns (close/claim)
- Entry count display
- Odds calculation display
- Error handling with user feedback
- Status indicators (active/paused/closed/ended)

## Technical Features

### Data Management
- Local database storage
- Automatic data cleanup
- Entry history tracking
- User entry tracking
- Timestamp tracking for all actions

### Entry System
- Single or multiple entries per user
- Configurable max entries per user
- Weighted entry system with odds multipliers
- Entry timestamps
- User ID tracking
- Entry removal (individual or all)
- Entry count queries

### Winner System
- Weighted random selection algorithm
- Odds calculation (percentage and ratio)
- Multiple winner status tracking:
  - Pending (waiting for claim)
  - Claimed (winner claimed prize)
  - Approved (streamer approved)
  - Denied (streamer denied)
  - Expired (claim timer expired)
- Claim timer management
- Per-winner claim deadlines
- Requeue logic for denied/expired winners
- Winner rotation display
- Winner history archival

### Pause/Resume System
- Pause giveaway (freezes timers)
- Resume giveaway (restores timers)
- Preserves remaining time on close timer
- Preserves remaining time on claim timers
- Multiple pending winner timer management

### Accessibility
- Clear status indicators
- Color-coded information
- Readable timer displays
- User-friendly error messages

## Usage

### Creating a Giveaway
1. Add the "Advanced Giveaway System" effect to any effect list
2. Configure the basic giveaway settings:
   - Set the giveaway title
   - Set the prize (optional)
   - Set the category (optional)
   - Configure the entry command (default: !enter) - You must still make your actual enter command this is for **DISPLAY ONLY**
   - Configure the claim command (default: !claim) - You must still make your actual claim command this is for **DISPLAY ONLY**
   - Set auto-close options if desired
   - Configure claim mode (timer/enabled/disabled)
   - Set claim duration if using timer mode
3. Customize the display (optional):
   - Choose display mode and widget mode
   - Configure image settings
   - Customize colors and styling
   - Set positioning
4. Configure entry options:
   - Allow multiple entries per user (optional)
   - Set max entries per user
   - Configure retention days
5. Configure winner behavior:
   - Enable/disable auto-reroll on expiration
   - Set requeue options for denied/expired winners
   - Configure display duration after ending

### Managing a Giveaway
Use the "Advanced Giveaway Manager" effect to:
- Add/remove entries manually
- Close/open entries
- Pick a winner
- Approve/deny winners
- Reroll winners
- Pause/resume giveaways
- Stop giveaways
- Reset giveaways
- Remove giveaways (with backup)
- Query giveaway status

### Working with Backups
Use the "Advanced Giveaway Backup Manager" effect to:
- View all backed up giveaways
- Restore backups (full/merge/overwrite)
- Delete old backups
- Browse backup history

### Tips and Best Practices
1. Use categories to organize different types of giveaways
2. Use variables to gate entries for user roles, entries, categories, etc
3. Regularly clean up ended giveaways using the backup manager
4. Test giveaway visibility and positioning before going live
5. Use variables for dynamic giveaway information in chat
6. Consider your overlay layout when positioning giveaways
7. Use claim timers to create urgency for winners or ensure they remain active during giveaways
8. Configure requeue options based on your needs or use events/commands to handle manual requeuing
9. Set appropriate retention periods for your data needs
10. Use winner history to track past giveaway winners and variables to use that information in gating entries

### Known Limitations
- Maximum number of entries limited by system performance
- Some animations may impact performance on lower-end systems

## Installation

### Plugin installation

1. Use Firebot **5.67.0 or newer**. Disable/remove the old startup-script registration before enabling the plugin.
2. Download `MSGG-GiveawaySystem.js` from a release, or build it below. Import the file through **Settings > Plugins** and enable it.
3. Reload Firebot's main window after adding/updating UI extensions, then refresh the Firebot overlay in OBS.
4. Open **Giveaways** in the Firebot sidebar, or use the existing **Advanced Giveaway System**, **Advanced Giveaway Manager**, and **Advanced Giveaway Backup Manager** effects.

Entry/claim command fields remain **display text only**. Create your Firebot chat commands and connect them to Manager effects. Running Create starts and shows that giveaway, stored giveaways are not all replayed onto an overlay connection. Show explicitly displays a stored giveaway again.

### Upgrading to v2.0

- Disable the legacy startup script before enabling the plugin, existing effect IDs and variable handles remain supported
- Entry allowances now count admissions per run, and optional approved-win limits default to unlimited
- Read [Upgrading and using v2.0](docs/UPGRADING.md) for migration, entry and win rules, claims, entry-event controls, and variable changes
- See [CHANGELOG.md](CHANGELOG.md) for the release changes

### Building
1. Clone the repository:
```
git clone https://github.com/MorningStarGG/Firebot-Giveaway-System.git
```
2. Install dependencies:
```
npm ci
```
3. Build the script:
```
npm run build:prod
```

## Technical Support

### Troubleshooting
If a giveaway isn't displaying:
1. Check that the Firebot overlay is loaded in your streaming software
2. Verify the selected overlay instance matches your configuration
3. Ensure the giveaway hasn't been automatically closed & try "showing" the giveaway again
4. Check the position settings
5. Verify display mode is not set to "Disabled"

If winners aren't being selected:
1. Ensure there are entries in the giveaway
2. Check eligibility: unresolved wins and configured win limits can hold pool entries
3. Check positive weights and a valid winner count, manual draws remain available while paused/stopped
4. Approve or deny the intended unresolved win, or inspect its Win ID in the Givaway tab within Firebot.

If claim timers aren't working:
1. Verify claim mode is set to "Timer"
2. Check that claim duration is greater than 0
3. Ensure the giveaway isn't paused
4. Check for JavaScript errors in browser console

### Requirements

- Firebot 5.67.0 or higher

### Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Join the Firebot Discord server

## License

This script is provided as-is under the GPL-3.0 license. You are free to modify and distribute it according to your needs.

## Acknowledgments

Special thanks to the Firebot community for their support and contributions.

---
**AI Disclaimer:** Parts of this was made with various AI tools to speed development time.

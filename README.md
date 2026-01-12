# Advanced Giveaway System for Firebot

A comprehensive and feature-rich giveaway system for Firebot, designed to be HIGHLY customizable with entry management, winner selection, and approval options.

## Features

### Core Functionality

### Giveaway Creation & Management
- Create giveaways with customizable entry tracking
- Two input modes for giveaway configuration:
  - Manual entry setup
  - Variable-based configuration
- Automatic or manual giveaway closing
- Entry management:
  - Single entry per user (default)
  - Multiple entries per user allowed (configurable)
  - Maximum entries per user limit
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
- **Giveaway Started Event** - Triggered when a giveaway begins
- **Giveaway Stopped Event** - Triggered when a giveaway ends (manual or automatic)
- **Winner Picked Event** - Triggered when a winner is randomly selected
- **Winner Claimed Event** - Triggered when a winner claims their prize
- **Winner Approved Event** - Triggered when the streamer approves a winner
- **Winner Denied Event** - Triggered when the streamer denies a winner
- **Winner Expired Event** - Triggered when a winner fails to claim in time
- **Giveaway Empty Event** - Triggered when no entries remain after resolving winners

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
- 7-day backup retention
- Backup restoration
- Backup browsing interface
- Manual backup deletion
- Winner archival before backup removal

## Winner History System

### Winner History Features
- Automatic archival of approved winners
- Configurable retention period (default 30 days) -  Configurable **ONLY** inside the Manager effect and will affect **ALL** giveaways
- Category-based organization
- Search by username
- Search by category
- Time-window filtering
- Purge old records automatically
- Manual history management
- Source tracking (approved/backup/cleanup)

## UI Elements

### Real-time UI Features
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

### Script Installation
1. Download the script files or build it from source following the below instructions
2. **Place the Script in Firebot Scripts Folder**
   - In Firebot, navigate to **Settings > Scripts > Manage Startup Scripts**.
   - Click **Add New Script**.
   - In the blue notification bar, click the link labeled **scripts folder**.
   - Copy the downloaded script into this folder.
   - Hit the **refresh button** beside the **Select script** dropdown.
   - Select **MSGG-GiveawaySystem.js** from the dropdown menu.
   - Click **Save**.
3. The script will add three new effects for use in Firebot:
   - Advanced Giveaway System
   - Advanced Giveaway Manager
   - Advanced Giveaway Backup Manager
4. The script will also add eight new events for use in Firebot:
   - Giveaway Started
   - Giveaway Stopped
   - Giveaway Empty
   - Giveaway Winner Picked
   - Giveaway Winner Claimed
   - Giveaway Winner Approved
   - Giveaway Winner Denied
   - Giveaway Winner Expired

### Building
1. Clone the repository:
```
git clone https://github.com/MorningStarGG/Firebot-Giveaway-System.git
```
2. Install dependencies:
```
npm install
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
2. Check that the giveaway isn't paused
3. Verify entries aren't closed (unless intended)
4. Check that users haven't already won (unless requeue is enabled)

If claim timers aren't working:
1. Verify claim mode is set to "Timer"
2. Check that claim duration is greater than 0
3. Ensure the giveaway isn't paused
4. Check for JavaScript errors in browser console

### Requirements

- Firebot 5.63.2 or higher

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

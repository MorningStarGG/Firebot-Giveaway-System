# Management UI performance and verification

The management page requests giveaway summaries first. It reads configuration only when needed and pages entries, unresolved wins, winners, history, backups, and library templates independently. Rows use stable ordering and debounced searches, pages clamp after removals. A committed-state cache avoids rereading the database for each UI request. Writes remain serialized and atomic, and failed writes leave the cache and notifications unchanged.

Change messages identify affected areas and giveaways. The page coalesces them, refreshes visible affected tables, and defers hidden tables until opened. Revision checks prevent older responses from replacing newer data. Configuration has its own revision so entry activity does not invalidate a draft. Changing selection during a pending save cannot move the user back or associate another giveaway's draft with that save.

Configuration controls are shared with the Create effect. Each section uses lazy mounting while the full model is initialized up front. The previous form declared 32 Firebot inputs and 28 color pickers. In browser checks, the initial management screen mounts none and Basics mounts three Firebot inputs. The first Appearance group mounts six color pickers with image text off, or eight with image text on. Leaving a section removes its controls while retaining values in the model.

The layout preserves full-width text and timing fields, inline checkbox groups, and the original paired color columns. Conditional controls are mounted without permanent empty grid cells. Display mode and image placement live in Layout & Images, visibility controls live with their text settings, Animation contains animation controls and their intervals. Win Limits uses one shared partial in the Create form and Manager. Layout wrappers do not provide the lazy-loading performance benefit.

## Measurements

These are synthetic checks on the development machine, not Firebot startup guarantees:

| Check | Previous/full form | New projection or section |
| --- | --- | --- |
| Configuration construction, sample browser run | 23.8 ms | 1.1 ms for Basics |
| Initial management configuration controls | Full form when configuring | 0 before opening Configuration |
| Sample query fixture: 5,000 entries and 2,000 history rows | 1,327,813-byte full snapshot | 315-byte dashboard summary |

The query sample's summary excludes entry/history rows and configuration. Restoring a selected giveaway additionally requests the visible Entries & Winners pages. Filtering/sorting still operates on cached data, mutations still commit the database, so these checks do not claim constant-time operations for arbitrarily large profiles.

## Repeatable checks

Run from the project root:

```powershell
npm run typecheck
npm test -- --runInBand
npm run test:browser
```

`tests/templates-and-queries.test.ts` includes a 5,000-entry projection check, repository-read counts, failed commits, scoped changes, pagination, configuration conflicts, library CRUD, and image/file validation. To print that test's current benchmark output, run `npm test -- --runInBand --silent=false tests/templates-and-queries.test.ts`.

Browser checks use an isolated Chrome/Edge profile with the built plugin and pinned Firebot 5.67 UI loader, page directive, and input/position/instance/color-picker wrappers. They print form construction measurements and exercise tabs, defaults, saved values, selection/save races, scoped refreshes, template application, actual file input/import and Blob download/export, effect copies, and disposal. The third-party color popup is not the complete live Firebot color-picker implementation, so construction timings measure this test harness.

Form layout checks also load Firebot 5.67's bundled Bootstrap, its container/radio components, and the relevant form layout rules. They verify Create and management-page forms at 1280px and 700px viewports: full-width/stacked fields, conditional claim/close/removal durations, checkbox wrapping, display-group placement, paired color alignment, single odds-color controls, and disposal of inactive color groups. These geometry checks supplement the binding and state-preservation checks.

Live acceptance still needs Firebot and OBS: replace the built plugin, reload Firebot's main window to register the updated UI, and check the page and Create effect in the actual app. Verify the intended overlay instance and appearance with your settings. Automated checks do not install the plugin or change a live profile.

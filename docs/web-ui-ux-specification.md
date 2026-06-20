# Klipper Farm Control Plane Web UI/UX Specification

## Source Analysis

This specification is based on the current project files in the Printing-YAWWAY workspace, including the FastAPI backend, React/Tailwind frontend, node agent, Docker Compose files, storage scripts, README, environment examples, and tests. Generated dependency/build artefacts such as `node_modules`, build output, caches, and live storage contents are not treated as product source.

The application is a local-network-only Klipper print farm control plane. A central server runs the web dashboard, backend, database, reverse proxy, shared storage, backups, G-code library, slicing workflow, and event log. Raspberry Pi nodes run the node-agent plus Klipper, Moonraker, Mainsail, and the printer service instances directly. Printer configuration, G-code, logs, backups, uploaded models, slicer profiles, and metadata are managed centrally through the server and shared to nodes through NFS.

The product is intended to be a practical MVP that is useful in a real workshop, while remaining simple enough for users who are newer to 3D printing. The app should surface safe, common actions first and move advanced controls into detail drawers, settings panels, and confirmation flows.

## Product Purpose

Klipper Farm Control Plane exists to let one local dashboard manage several Klipper printers and disposable Raspberry Pi execution nodes. It should help the operator answer five daily questions quickly:

- Which printers are available, printing, idle, offline, or in error?
- Which node is each printer running on, and is the node healthy?
- Where are my configs, logs, G-code files, backups, and slicer outputs?
- Can I safely start this print on one or more printers?
- If hardware or a node fails, how do I diagnose, recover, migrate, or restore?

## Target Users

- Print farm operator: runs multiple printers, starts jobs, watches progress, handles failures, and needs fast status visibility.
- Workshop owner or maker: wants centralised storage, printer profiles, filament tracking, and backups without needing to SSH into every Pi.
- Newer 3D printing user: needs plain language, safe defaults, clear warnings, and guided setup.
- Advanced Klipper user: needs service logs, config editing, generated service templates, Moonraker/Mainsail access, node software install status, and migration controls.

## Key Use Cases

- First-run setup of the dashboard LAN address and shared NFS storage.
- Register, approve, edit, refresh, update, reboot, or remove Raspberry Pi nodes.
- Install printer runtime software on a node: Klipper, Moonraker, Mainsail, nginx, and required dependencies.
- Create a printer profile, assign it to a node, pick the expected MCU serial, and provision service instances.
- Monitor printers, active G-code files, print progress, temperatures, and Moonraker/Klipper state.
- Restart Klipper, restart Moonraker, firmware restart, home axes, repair Moonraker config, and emergency stop.
- Edit printer profile notes: model, bed size, nozzle, hotend, extruder, probe, board, slicer notes, known issues, maintenance notes, and last serviced date.
- View, upload, edit, rename, download, and delete managed files by printer and type.
- Create file edit backups before config saves and restore from farm or file backups.
- Upload STL/3MF models, preview them on a build plate, select Orca profiles, slice locally, and save output into the G-code Hub.
- Manage filament spools, load a spool onto a printer, deduct estimated usage when a print starts, and manually adjust stock.
- Dispatch one G-code file or one grouped slicer output to selected printers or only compatible printers.
- Record and filter events by printer, node, severity, and event type.
- Configure SMTP, OrcaSlicer binary path, network host, backup schedule, and NFS settings.

## Current Feature Inventory

The current frontend already contains these major routes:

- `/` Fleet
- `/nodes` Nodes
- `/nodes/assignments` Assignments and Migration
- `/printers/:id` Printer Detail
- `/gcode` G-code Hub
- `/slicer` Slicer
- `/filament` Filament
- `/files` Files
- `/backups` Backups
- `/events` Events
- `/settings` Settings
- `/setup/network` First-run Network Setup

The backend exposes APIs for:

- Printers CRUD, runtime snapshot, notes, service templates, restart, emergency stop, homing, config helper, Moonraker repair, G-code listing and print dispatch.
- Nodes CRUD, heartbeat, approval, refresh, health, USB, instances, logs, agent update, agent restart, reboot, storage checks, NFS mount, runtime installs, and printer instance creation.
- Assignment preflight and migration execution.
- Files: Klipper example configs, list, read, save with backup, upload, rename, download, delete.
- Backups: list, settings, manual farm backup, scheduled backup loop, restore.
- Slicer: settings, health, install info, profiles, uploaded models, jobs, batch jobs, cancel jobs.
- Filament: spools, usage history, manual adjustment, print-start deduction.
- Events, notifications, storage status, network settings, and WebSocket status broadcasts.

## Design Principles

- Dark mode is the default and only required MVP theme.
- Navigation should be predictable: monitor, prepare, maintain, configure.
- New users should see simple labels and next actions. Advanced controls remain available but visually secondary.
- Risky actions must use confirmation modals with clear consequences.
- Use consistent cards, tables, forms, badges, buttons, modals, empty states, and toasts everywhere.
- Keep page headers consistent: title, short purpose, status indicator, primary action, secondary actions.
- Use real-time updates for live machine state, node operations, print progress, slicer jobs, and alerts.
- Use polling as a fallback where WebSocket events are not complete.
- Desktop should support dense side-by-side monitoring. Tablet should keep the same hierarchy but collapse side panels into drawers or stacked sections.
- Use British English in UI labels: Centre, colour, programme only where natural, and "configuration" rather than "config" in user-facing headings unless space is tight.

## Information Architecture

### Primary Navigation

Use a fixed left navigation on desktop and a collapsible rail on tablet. Group links into three clear sections:

Print Farm:

- Fleet
- Nodes
- Printer Detail, opened from Fleet or search rather than as a fixed nav item

Print Prep:

- G-code Hub
- Slicer
- Filament

Maintenance:

- Files
- Backups
- Events
- Settings

### Secondary Navigation

Several pages should use local tabs to reduce clutter:

- Printer Detail: Overview, Controls, Configuration, Files, Logs, Profile.
- Nodes: Overview, Discovered, Software, Storage, Logs.
- Settings: Network, Storage, Slicer, Email, Backups, System.
- Slicer: Prepare, Profiles, Jobs, Engine.

### Global Header

Every screen should share:

- Breadcrumb or section label.
- Page title and one-line description.
- Global connection indicator: Live, Reconnecting, Offline, or Polling.
- Activity button showing active install, backup, slicer, migration, and print operations.
- Global refresh button where useful.

### Global Activity Centre

Add a right-side drawer available from the app header. It should collect:

- Running node software installs with log tail and current command.
- NFS mount attempts.
- Slicer jobs: queued, running, completed, failed, cancelled.
- Backup creation or restore.
- Migration preflight/execution.
- Print dispatch results.
- Recent critical events.

Each item should show status, affected printer/node, start time, last update, message, and a link to the source page.

## Visual System

### Layout Tokens

- App background: very dark slate.
- Page content max width: normal pages 1280px, operational pages full width with 24px padding.
- Cards: 8px radius, 1px subtle border, dark surface, no nested decorative cards.
- Tool surfaces such as viewers and editors may be framed as panels.
- Spacing scale: 4, 8, 12, 16, 24, 32px.
- Tablet breakpoint: 768px and above should be comfortable; below that is optional but should not break.

### Colours

Use colour to communicate state consistently:

- Blue: primary action, selected navigation, connected control.
- Cyan: network/storage setup and informational infrastructure state.
- Green: healthy, online, completed, fits.
- Amber/orange: warning, in progress, attention needed.
- Red: failed, offline, destructive, emergency.
- Purple should be used sparingly for backup or metadata, not as the dominant brand colour.

### Typography

- Page title: 24 to 28px, bold.
- Section title: 16 to 18px, bold.
- Body: 13 to 14px.
- Metadata labels: 10 to 11px uppercase, but do not overuse uppercase for long text.
- Monospace only for paths, command output, G-code, service names, and logs.

### Controls

- Primary button: filled blue with icon and label.
- Secondary button: dark surface with border.
- Destructive button: red outline or filled red for emergency.
- Icon-only buttons must have tooltips.
- Confirmation modals must include action name, affected target, consequences, and typed confirmation only for destructive data loss.
- Forms should use inline validation and disabled save buttons until required fields are valid.

### Status Badges

Create one shared `StatusBadge` component with variants:

- Printer: Printing, Idle, Starting, Online, Offline, Error.
- Node: Online, Offline, Discovered, Approved, Updating, Rebooting, Connecting storage, Installing runtime.
- Job: Queued, Running, Complete, Failed, Cancelled.
- File fit: Fits, Too large, Unknown, Skipped.
- Filament: Active, Low, Empty, Archived.

## Real-Time Behaviour

The app should use `/ws/status` as the preferred live update channel and retain current polling as fallback. Required live updates:

- Printer state, progress, active G-code, runtime warnings.
- Node heartbeat, online/offline, CPU, RAM, temperature, uptime.
- Node operation state: NFS mounting, software installing, update, reboot, restart.
- Slicer job state and message.
- Backup and restore state.
- New critical events.

When live data is stale, show "Last seen X ago" and avoid implying a node has failed while a known long-running operation is in progress.

## Screen Specifications

### 1. App Shell

Purpose: Provide the persistent structure for the entire control plane.

Required functionality:

- Sidebar navigation grouped by workflow.
- Global live/polling/offline indicator.
- Activity Centre drawer.
- Toast notifications.
- Error boundary with reload and diagnostics copy button.
- Tablet collapsible navigation.

Layout and user flow:

- Desktop: left sidebar, main content, optional right drawer.
- Tablet: collapsed sidebar with icons and labels on hover/tap; drawers cover the right side.
- The active section is highlighted. Related advanced pages can be nested under their parent section.

Controls and visual elements:

- Sidebar links with lucide icons.
- Header status pill.
- Activity button with count badge.
- Toast stack bottom-right.
- Modal layer shared across app.

Improvements:

- Replace one-off page header styles with a shared `PageHeader`.
- Add global activity state so long-running operations are not hidden on individual cards.

### 2. First-Run Network Setup

Purpose: Ensure Pi nodes know the LAN address of the dashboard before node registration and NFS mounting.

Required functionality:

- Show detected browser host, suggested host, saved/effective host, and whether setup is required.
- Save dashboard LAN address or hostname.
- Validate that localhost is not used when a Pi node must connect.
- After save, redirect to Fleet if setup is complete.

Layout and user flow:

- Single centred setup panel with a clear "First run" heading.
- Warning panel when current browser host is not usable by nodes.
- Input for LAN IP/hostname and Save Network button.
- Summary cards below the input.

Controls and visual elements:

- Text input for Dashboard LAN Address.
- Save button.
- Success/warning banners.
- Three compact cards: Effective Host, Browser Host, Auto Suggestion.

Improvements:

- Add a "Test from node" action after at least one node is registered.
- Add plain examples: `10.1.8.137` or `klipper-farm.local`.

### 3. Fleet

Purpose: Main operational overview of all printers.

Required functionality:

- List every printer with status, assigned node, Moonraker URL, progress, active G-code, last seen, warnings, and webcam thumbnail if available.
- Quick actions: open printer, open embedded UI, restart Klipper, restart Moonraker, firmware restart, power cycle if supported, emergency stop, delete printer.
- Add Printer wizard.
- Show fleet health summary: printers online, printing, idle, offline, errors.
- Search and filter by status, node, and warning.

Layout and user flow:

- Top summary strip with fleet counts and a critical warning area.
- Printer cards grid on desktop, two columns on tablet.
- Each printer card has a compact top status area, progress bar, current file, assigned node, and action row.
- Add Printer is the primary page action.

Controls and visual elements:

- Status badges.
- Progress bar with percent and active file.
- Node link chip.
- Warning chips for Moonraker config, missing node, stale runtime.
- Action menu for risky/advanced controls.

Improvements:

- Move restart/delete actions into an overflow menu to reduce visual noise.
- Add "Needs attention" filter.
- Add a small "why offline?" hint when runtime has a status message.
- Add batch view toggle for cards/table.

### 4. Add Printer and Provisioning Wizard

Purpose: Create a printer profile, prepare a node, select the MCU, choose a configuration source, and provision Klipper/Moonraker services.

Required functionality:

- Create printer name, slug, model, expected MCU serial, Moonraker port, service names, storage paths, webcam URL, embedded UI URL.
- Select target node.
- Check node runtime: Klipper, Moonraker, Mainsail, nginx, NFS, agent version, USB serials.
- Install full runtime or individual components with live log/status.
- Choose MCU serial from `/dev/serial/by-id`.
- Choose config source: minimal generated config, Klipper example config, or uploaded config.
- Fetch and preview official Klipper example configs.
- Review before provisioning.
- Create printer record and node service instance.

Layout and user flow:

- Full-screen modal or dedicated route with stepper.
- Steps: Printer Profile, Target Node, Runtime and MCU, Configuration, Review, Result.
- Each step has a left explanation column and right form/checklist area.
- Result step shows created paths, service names, Mainsail URL, and next actions.

Controls and visual elements:

- Stepper with completion ticks.
- Node readiness checklist.
- Runtime install progress log.
- USB serial radio list.
- Config preview editor.
- Review table.
- Confirmation for provisioning.

Improvements:

- Replace long modal content with a route or large drawer to avoid cramped forms.
- Add "I do not know yet" option for MCU serial but warn that migration checks will be weaker.
- Add automatic path preview as slug changes.
- Add clear recovery instructions if provisioning fails halfway.

### 5. Printer Detail

Purpose: Per-printer monitoring, control, embedded UI, configuration, logs, and profile management.

Required functionality:

- Show printer status, state message, active G-code, progress, position, temperatures, homed axes, print stats, Moonraker warnings, and last update.
- Display embedded Mainsail/Fluidd iframe and external open button.
- Show webcam panel from stored URL.
- Controls: emergency stop, restart Klipper, restart Moonraker, firmware restart, home X/Y/Z/all, repair Moonraker config, reload embedded UI.
- Show printer settings/profile editing.
- Show generated service templates with copy/download.
- Show Klipper/Moonraker logs.
- Show config helper.
- Allow widget customisation as an advanced mode.

Layout and user flow:

- Header: printer name, status, assigned node, quick open Mainsail, emergency stop.
- Tabs: Overview, Controls, Configuration, Logs, Profile.
- Overview uses a two-column dashboard: status and toolhead cards left, Mainsail/webcam right.
- Tablet stacks panels and pins emergency stop at the top.

Controls and visual elements:

- Status card with progress ring/bar.
- Temperature cards for extruder and bed.
- Toolhead position readout.
- Homing buttons.
- Action buttons with confirmation.
- Iframe panel with reload/external controls.
- Webcam panel with placeholder state.
- Warnings panel for missing Moonraker sections and repair action.

Improvements:

- Keep custom widget layout hidden under "Customise dashboard"; default should be opinionated and simpler.
- Separate risky machine controls from monitoring with clear visual grouping.
- Add a "Recent events for this printer" mini timeline.
- Show "Config needs attention" as a link into Configuration rather than raw warning text.

### 6. Printer Profile

Purpose: Store practical machine metadata and maintenance notes for each printer.

Required functionality:

- Edit model, bed size, nozzle size, hotend, extruder, probe type, board type, MCU serial, slicer profile notes, known issues, maintenance notes, last serviced date.
- Use bed size for G-code fit checks and slicer defaults.
- Use MCU serial for migration preflight.
- Show linked slicer profiles and loaded filament spool.

Layout and user flow:

- Form split into Machine, Motion/Build Volume, Electronics, Slicer Notes, Maintenance.
- Save button stays sticky at bottom of panel/drawer.
- Warn if changing MCU serial affects migration checks.

Controls and visual elements:

- Text inputs.
- Date picker.
- Textareas for notes.
- Linked cards for active spool and slicer profiles.

Improvements:

- Parse common bed size formats and show a build volume preview.
- Add maintenance reminder field later, but keep MVP simple.

### 7. Config Helper

Purpose: Assist with safe, repeatable edits to Klipper printer configuration.

Required functionality:

- Detect active config-helper plugin sections from `printer.cfg`.
- Select probe pin presets, offsets, safe Z home, bed mesh parameters, and supported Klipper plugin sections.
- Preview config changes before applying.
- Create backup before writing.
- Restart services after apply when requested.
- Display validation warnings.

Layout and user flow:

- Available inside Printer Detail > Configuration.
- Use sections: Probe Setup, Bed Mesh, Plugin Sections, Preview, Apply.
- Preview is read-only code diff or generated snippet.
- Apply requires confirmation and shows backup path afterwards.

Controls and visual elements:

- Preset select.
- Numeric inputs for offsets and mesh.
- Plugin checkboxes with active/inactive state.
- Preview panel.
- Apply button with "Restart services after saving" toggle.

Improvements:

- Do not show removed experimental controls such as Auto Dual Z or automatic bed reach in the main UI.
- Add "Active in printer.cfg" badges beside plugins.
- Add diff view rather than only full generated text.

### 8. Nodes

Purpose: Monitor and manage Raspberry Pi execution nodes.

Required functionality:

- List node hostname/name, IP, agent port, status, approval state, CPU, RAM, temperature, uptime, model, last seen.
- Show NFS availability, mounted/writable/missing directories, persistent mount, auto-reconnect state.
- Show USB serial devices.
- Show running Klipper/Moonraker service instances.
- Show suitability warnings: Pi Zero limits, high temperature, high CPU/RAM, missing MCU, NFS unavailable, service failures.
- Actions: approve, refresh, edit, delete, detect port, restart agent, reboot node, update agent, restart printer services, connect NFS, install runtime components.
- Manual node registration.

Layout and user flow:

- Header with Simple/Advanced segmented control.
- Simple view: node health cards focused on status and next action.
- Advanced view: table or expanded cards with inventory, services, storage, and logs.
- Node detail opens in a right drawer from any node card/table row.

Controls and visual elements:

- Node cards with metrics.
- Storage status card.
- USB and services lists.
- Warning cards.
- Action overflow menu.
- Manual Add Node modal.
- Edit Node modal.

Improvements:

- Do not disable refresh while NFS is connecting; show operation progress instead.
- Make delete reliable and confirm what will happen to assigned printers.
- Add "Why this node is not ready" checklist.
- Group install/update/reboot under "Maintenance" to reduce accidental clicks.

### 9. Node Detail Drawer

Purpose: Provide a focused operational view for one node.

Required functionality:

- Health details and history sparkline placeholders.
- Storage mount status and mount attempts.
- Runtime install status with live log tail.
- USB serial devices and service instances.
- Agent version/update status.
- Node logs where available.
- Printers assigned to this node.

Layout and user flow:

- Drawer tabs: Summary, Storage, Software, Services, Logs.
- Summary shows current state and assigned printers.
- Software tab includes install runtime buttons and log stream.

Controls and visual elements:

- Metric cards.
- Readiness checklist.
- Terminal-like install log.
- Service table with status and restart buttons.

Improvements:

- Show active operation timeline so users know downloads/builds are still running.
- Add copyable SSH/install commands only in advanced tab.

### 10. Assignments and Migration

Purpose: Move a printer from one node to another safely.

Required functionality:

- Select printer and target node.
- Run migration preflight.
- Verify target node online, target services reachable, expected MCU present, old node reachable, USB devices present.
- Warn if old services cannot be stopped.
- Stop old Klipper/Moonraker services if old node is reachable.
- Start new services on target node.
- Update printer assignment.
- Verify Moonraker connection.
- Record migration event.
- Require confirmation when warnings exist.

Layout and user flow:

- Three-step flow: Select, Preflight, Execute.
- Preflight checklist must be visible before execution.
- Execution result shows stop/start/verify results and links to printer detail and event log.

Controls and visual elements:

- Printer select.
- Target node select.
- Preflight checklist with pass/warn/fail icons.
- USB device list.
- Confirmation modal.
- Result summary.

Improvements:

- Keep this reachable from Nodes and Printer Detail, but not as a distracting top-level item unless the farm grows.
- Add "recommended target nodes" based on online state and MCU match.
- Add rollback guidance if Moonraker verification fails.

### 11. G-code Hub

Purpose: Central ready-to-print G-code library, 3D preview, compatibility checks, and print dispatch.

Required functionality:

- List G-code files across all printer stores or filtered by printer.
- Upload G-code to selected printer store.
- Group slicer batch outputs so one model sliced for several printers appears as one logical item with printer-specific variants.
- Search files.
- Show file metadata: size, modified date, source printer, dimensions, layers, XY moves, estimated time, filament use, source model, slicer profiles where available.
- 3D G-code viewer with rotate, zoom, pan, view presets, reset, travel toggle, and optional layer slider.
- Show build volume and file bounds.
- Fit check per target printer.
- Select individual printers, all selected, or only printers where the G-code fits.
- Select loaded filament spool or use default loaded spool.
- Start print through Moonraker and deduct filament when configured.
- Delete file with confirmation.

Layout and user flow:

- Desktop: three-column layout.
- Left: file search/filter/list.
- Centre: 3D viewer and optional G-code preview text.
- Right: selected file metadata, target printers, filament selection, print/delete actions.
- Tablet: file list collapses above viewer or into drawer; selected file panel becomes bottom sheet.

Controls and visual elements:

- Upload printer target select.
- Search input.
- File list with grouped variants.
- 3D viewer toolbar: Iso, Top, Front, Side, Reset, Pan, Travel, Layer.
- Target printer checklist with fit badges.
- Print button and "Select fits" button.
- Delete button.

Improvements:

- Make grouped slicer outputs obvious: one row labelled by model with a variant count.
- Add print confirmation showing printer, file, estimated filament, and spool deduction.
- Add layer slider and colour modes: by layer height, extrusion/travel, speed if metadata exists.
- Add "Centre during slicing" hint instead of modifying arbitrary G-code as the default path.

### 12. Slicer

Purpose: Local cloud-style slicing workflow using an externally installed OrcaSlicer binary.

Required functionality:

- Show OrcaSlicer engine health and setup guidance.
- Upload STL and 3MF model files.
- Preview selected model on a 3D build plate with dimensions and bed size.
- Select target printer or slice for multiple printers.
- Select printer profile, filament/material profile, and process/quality profile.
- Manage/import/export Orca-first profile records.
- Select loaded filament spool.
- Centre model on bed option.
- Start single or batch slice job.
- Show queued/running/completed/failed/cancelled jobs.
- Completed output must save to the target printer G-code store and appear in the G-code Hub.
- Batch output must share a slice group id so G-code Hub can show it as one logical item.
- Cancel queued/running jobs where possible.

Layout and user flow:

- Prepare tab uses a familiar slicer shape:
  - Left project panel: models and upload.
  - Centre build plate 3D viewer.
  - Right slicing settings panel.
  - Bottom job queue strip.
- Profiles tab manages Printer, Filament, and Process profiles.
- Engine tab manages Orca path, health, install info, and detected paths.

Controls and visual elements:

- Drag-and-drop upload zone.
- Model list with size/date/delete/download.
- Build plate viewer with view presets.
- Printer selector with multi-select option.
- Profile selects.
- Filament spool select.
- Toggle: Centre on bed.
- Toggle: Slice one variant per printer.
- Slice button.
- Job table/cards with status and messages.

Improvements:

- Use wording closer to normal slicers: Printer, Material, Quality, Build Plate, Slice, Send to G-code Hub.
- Add "Profile missing" inline guidance for STL files.
- Add default profile mapping from printer notes.
- Add model transform controls later: move, rotate, scale. For MVP, show read-only placement plus centre-on-bed.
- Hide raw binary path setup behind Engine unless health is failing.

### 13. Filament

Purpose: Track filament inventory and deduct material use from prints.

Required functionality:

- Add, edit, delete, archive filament spools.
- Track material, brand, colour, diameter, density, initial weight, remaining weight, empty spool weight, loaded printer, status, and notes.
- Show active spools, total remaining filament, low spool count.
- Manually use/add grams.
- Show usage history per spool.
- Deduct print usage from selected or loaded spool when a G-code print starts.

Layout and user flow:

- Summary cards across the top.
- Left form for add/edit spool.
- Right spool inventory grid/table.
- Selecting a spool opens a detail drawer with usage history.

Controls and visual elements:

- Spool cards with progress bar and colour swatch.
- Material select with automatic density defaults.
- Numeric inputs for grams, diameter, density.
- Printer loaded-on select.
- Status select.
- Use/Add adjustment controls.

Improvements:

- Add low-filament warning threshold.
- Add "loaded on printer" state on Fleet/Printer Detail.
- Add usage history drawer; current UI tracks usage in API but does not surface it well.

### 14. Files and Configuration Manager

Purpose: Clean file manager for printer configs, Moonraker configs, macros, G-code, logs, and backup files.

Required functionality:

- Select printer.
- Select file type: Printer Configuration, Moonraker Configuration, Macros, G-code, Logs, Backup Files.
- Show only selected file type for selected printer.
- View file contents.
- Edit supported text files.
- Save with automatic backup.
- Upload files where allowed.
- Rename files.
- Download files.
- Delete files with confirmation.
- Show clear path, size, modified date.
- Fetch official Klipper example configs for provisioning and reference.

Layout and user flow:

- Header filters: printer select, file type segmented control, upload, refresh.
- Left file tree/list.
- Right preview/editor panel.
- Bottom/action bar for Save, Download, Rename, Delete.
- Tablet: file list and editor stack vertically.

Controls and visual elements:

- File table/tree.
- Code editor with monospace font.
- Breadcrumb/path bar.
- Upload button.
- Rename inline or modal.
- Delete confirmation modal.
- Backup-created success toast with link to Backups.

Improvements:

- Add syntax highlighting for `.cfg`, `.conf`, `.gcode`, and `.log`.
- Add unsaved changes guard.
- Add diff against latest backup.
- Add read-only styling for logs and backup files.

### 15. Backups and Restore

Purpose: Create, schedule, list, filter, and restore backups.

Required functionality:

- List farm backups and file edit backups.
- Create manual farm backup.
- Configure automatic daily backup enabled/disabled, scheduled time, farm retention, and file edit retention.
- Filter by printer and backup type.
- Restore file edit backup or farm backup with confirmation.
- Record backup and restore events.

Layout and user flow:

- Top bar with Create Farm Backup primary action.
- Settings card: daily backup, time, retention.
- Filter bar.
- Backups table.
- Restore opens confirmation modal with scope and risk.

Controls and visual elements:

- Schedule toggle.
- Time input.
- Retention number inputs.
- Backup table with name, printer, type, date, status, actions.
- Restore icon button with tooltip.

Improvements:

- Add backup detail drawer showing manifest contents and included printers.
- Add restore dry-run summary before overwriting files.
- Add download backup action.

### 16. Events

Purpose: Audit and troubleshooting log for major system events.

Required functionality:

- List recent events with severity, type, message, printer, node, details, and timestamp.
- Filter by event type, severity, printer, and node.
- Refresh.
- Link events to relevant printer/node/job pages.
- Show details JSON in expandable panel.

Layout and user flow:

- Filter bar at top.
- Event timeline/list below.
- Clicking an event expands details.
- Critical events should also appear in Activity Centre.

Controls and visual elements:

- Severity icons.
- Event type chips.
- Date/time.
- Printer/node link chips.
- Expand/collapse details.

Improvements:

- Replace hard-coded event type dropdown with available event types from data.
- Add limit/pagination controls.
- Add "related events" for a printer or node.

### 17. Settings

Purpose: Configure system-level services and integration settings.

Required functionality:

- Network: dashboard LAN address, effective host, detected browser host, suggestion.
- Storage: NFS export path, storage root, expected client mount, permitted subnet, required directories, copyable mount commands.
- Slicer: OrcaSlicer binary path, health check, install info, helper command, detected paths.
- Email: SMTP host, port, username, password/app key, from address, test recipient, send test.
- Backups: daily backup defaults and retention, or link to Backups page.
- System: backend version, database status, deployment mode, storage capacity if available.

Layout and user flow:

- Use settings tabs instead of one long page.
- Each tab has one clear save action.
- Slicer and Email should show connection/test status after saving.

Controls and visual elements:

- Tab navigation.
- Forms.
- Status banners.
- Copy command buttons.
- Test buttons.

Improvements:

- Persist SMTP settings or clearly state environment variables are authoritative.
- Add "Test Orca" button beside path.
- Add "Test storage from selected node" action.
- Add storage usage summary if backend can expose disk stats.

### 18. Monitoring Screens

Purpose: Provide fast operational confidence without forcing users into deep pages.

Required views:

- Fleet health strip on Fleet.
- Node health summary on Nodes.
- Printer live status on Printer Detail.
- Activity Centre for operations and jobs.
- Events timeline for historical troubleshooting.

Required monitoring data:

- Printer status, active file, progress, runtime warnings, temperatures, position.
- Node online/offline, last seen, operation state, CPU/RAM/temp, NFS, USB, services.
- Job status for slicing, backups, installs, migration, print dispatch.

Improvements:

- Add "stale data" styling and clear timestamps.
- Show active operations as in-progress rather than failed while timeouts are expected.

### 19. Notifications and Alerts

Purpose: Make important problems visible without overwhelming users.

Required functionality:

- Toasts for user-triggered success/failure.
- Persistent alert banners for critical unresolved issues.
- Email notification settings and test.
- Event-triggered notifications for node offline/back online, Klipper error, Moonraker offline, MCU disconnected, print complete, print failed, backup failed, migration failed.

Layout and user flow:

- Toasts appear for immediate feedback and auto-dismiss.
- Critical alerts appear in Activity Centre and page-level warning strips.
- Settings controls notification channels and test email.

Controls and visual elements:

- Toast stack.
- Alert banner with severity icon, message, and action.
- Notification settings table by event type, with toggles.

Improvements:

- Add a Notifications settings table backed by `notification_settings`.
- Add quiet hours later if the farm grows.

### 20. Error Handling and Recovery

Purpose: Help users understand what failed and what to do next.

Required workflows:

- Node unreachable: show last seen, IP/port, retry, detect port, SSH/install guidance.
- NFS unavailable: show mount status, connect storage button, copy mount commands, missing dirs.
- Runtime install in progress: show live log, current command, elapsed time, do not mark failed too early.
- Slicer failure: show stderr message, missing profile guidance, Orca health check, link to Engine settings.
- G-code too large for printer: show dimensions, bed bounds, and recommend slicing for that printer.
- Moonraker warnings: show missing sections and repair action.
- Config save failure: preserve unsaved content, show backup status.
- Restore failure: show exact backup and error, do not hide partial state.
- Delete blocked/failure: show assigned printers or dependent records when relevant.

Controls and visual elements:

- Inline error panels.
- Retry buttons.
- Copy diagnostics button.
- Links to related settings or logs.

Improvements:

- Standardise API error rendering across pages.
- Use one confirmation modal component across all destructive actions.

## Data and Endpoint Contracts for Frontend

The frontend should consume these resource groups:

- Printers: `/api/printers`, `/api/printers/{id}`, `/detail`, `/runtime`, `/notes`, `/service-templates`, `/restart`, `/emergency-stop`, `/home`, `/repair-moonraker`, `/config-helper/*`, `/gcodes`, `/gcodes/print`.
- Nodes: `/api/nodes`, `/heartbeat`, `/approve`, `/refresh`, `/health`, `/usb`, `/instances`, `/logs/{service}`, `/storage/check`, `/storage/mount`, `/software/*`, `/update`, `/restart-agent`, `/reboot`, `/restart-services`, `/instances/create`.
- Assignments: `/api/assignments/check`, `/api/assignments/migrate`.
- Files: `/api/files/{printer_slug}/{file_type}`, `/read`, `/save`, `/upload`, `/rename`, `/download`, `/delete`, `/examples/klipper`.
- Slicer: `/api/slicer/settings`, `/health`, `/install-info`, `/profiles`, `/models`, `/jobs`, `/jobs/batch`, `/jobs/{id}/cancel`.
- Filament: `/api/filaments/spools`, `/usage`, `/adjust`.
- Backups: `/api/backups`, `/settings`, `/create`, `/restore/{id}`.
- Events: `/api/events`.
- Settings: `/api/settings/network`, `/api/settings/email`, `/api/notifications/test`.
- Storage: `/api/storage/nfs-status`.
- Live status: `/ws/status`.

## Responsive Behaviour

Desktop:

- Use full sidebar.
- Operational pages can use three-column layouts.
- Data tables can show all key columns.
- Drawers should be 420 to 560px wide.

Tablet:

- Collapse sidebar to rail or top menu.
- Three-column pages become two columns or stacked with drawers.
- Keep primary action visible at top.
- Viewer/editor panels should remain large enough to be useful.
- Tables should become card lists when columns would be cramped.

Touch considerations:

- Minimum tap target 40px.
- Avoid hover-only actions; show overflow menus.
- Keep emergency/destructive actions separated from routine controls.

## Component Inventory

Core layout:

- `AppShell`
- `Sidebar`
- `PageHeader`
- `SectionTabs`
- `ActivityCentre`
- `RightDrawer`
- `Modal`
- `ToastStack`

Status and data:

- `StatusBadge`
- `MetricCard`
- `ReadinessChecklist`
- `WarningPanel`
- `EventTimeline`
- `DataTable`
- `CardGrid`
- `EmptyState`
- `LoadingState`
- `StaleDataIndicator`

Forms:

- `FormField`
- `Select`
- `SegmentedControl`
- `Toggle`
- `NumberInput`
- `TextArea`
- `FileUploadDropzone`
- `CommandCopyBox`

Operational controls:

- `ConfirmActionModal`
- `EmergencyStopButton`
- `ServiceActionMenu`
- `InstallProgressLog`
- `NodeStoragePanel`
- `PrinterRuntimePanel`
- `PrinterProfileForm`
- `ConfigHelperPanel`

Print prep:

- `ModelBuildPlateViewer`
- `GcodeViewer3D`
- `LayerSlider`
- `GcodeFileList`
- `GcodeTargetSelector`
- `SlicerSettingsPanel`
- `SlicerJobQueue`
- `FilamentSpoolCard`

## Suggested Rebuild Order

1. Establish app shell, navigation, shared components, status badges, modal/toast system, and responsive layout.
2. Rebuild Fleet, Nodes, Printer Detail, and Activity Centre around shared live status state.
3. Rebuild G-code Hub and Slicer with consistent viewer panels and job handling.
4. Rebuild Files, Backups, Events, Filament, and Settings using shared tables/forms.
5. Add page-level recovery workflows and richer empty/error states.
6. Add tablet QA and visual consistency pass across all screens.

## Acceptance Checklist

- Dark mode is consistent across every page.
- Primary workflows are visible without opening advanced settings.
- Risky actions always require confirmation.
- Printer, node, job, file, backup, and event statuses use the same visual language.
- Fleet, Nodes, G-code Hub, Slicer, and Printer Detail update live or clearly show polling/stale state.
- New users can add a node, add a printer, upload/slice G-code, select filament, and start a print without needing to understand the database or file paths.
- Advanced users can still reach logs, generated service templates, raw paths, config editing, and node maintenance actions.
- Tablet layout remains usable for workshop operation.

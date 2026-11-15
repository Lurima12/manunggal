// SPDX-License-Identifier: GPL-2.0-or-later
//
// Local test harness. Never shipped with the extension. It drives Manunggal
// through a headless Shell session, writes a JSON report and stage screenshots.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'manunggal@lurim412';
const OUT = GLib.getenv('MG_TEST_OUT') ?? '/tmp/opencode/mgtest/out';
const SHOTS = GLib.build_filenamev([OUT, 'shots']);

function ensureDir(path) {
    GLib.mkdir_with_parents(path, 0o755);
}

function writeReport(report) {
    ensureDir(OUT);
    GLib.file_set_contents(GLib.build_filenamev([OUT, 'report.json']),
        JSON.stringify(report, null, 2));
}

function writeText(name, text) {
    ensureDir(OUT);
    GLib.file_set_contents(GLib.build_filenamev([OUT, name]), text);
}

function wait(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

// Clutter.Event has no public constructor, so key handling is invoked with a
// stub. The handler only reads these two fields.
function keyEvent(symbol, state = 0) {
    return {
        get_key_symbol: () => symbol,
        get_state: () => state,
    };
}

function describeError(error) {
    return {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
    };
}

export default class TestHarness extends Extension {
    enable() {
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._timeout = 0;
            this._run().catch(error => this._finish({ok: false, error: describeError(error)}));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
    }

    async _shot(name) {
        ensureDir(SHOTS);
        const path = GLib.build_filenamev([SHOTS, `${name}.png`]);
        return await new Promise(resolve => {
            try {
                const file = Gio.File.new_for_path(path);
                const stream = file.replace(null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                const screenshot = new Shell.Screenshot();
                screenshot.screenshot_area(0, 0,
                    global.stage.get_width(), global.stage.get_height(), stream,
                    (source, result) => {
                        try {
                            const ok = source.screenshot_area_finish(result);
                            stream.close(null);
                            resolve({ok, path});
                        } catch (error) {
                            resolve({ok: false, error: describeError(error)});
                        }
                    });
            } catch (error) {
                resolve({ok: false, error: describeError(error)});
            }
        });
    }

    async _run() {
        const report = {
            ok: true,
            shellVersion: Shell.ShellVersion ?? null,
            monitor: GLib.getenv('MG_TEST_MONITOR') ?? null,
            textScale: GLib.getenv('MG_TEST_TEXT_SCALE') ?? null,
            steps: [],
            errors: [],
            warnings: [],
        };
        this._report = report;

        const step = async (name, fn) => {
            try {
                const result = await fn();
                report.steps.push({name, ok: true, result: result ?? null});
                console.log(`[mgtest] ok ${name}`);
                return result;
            } catch (error) {
                report.steps.push({name, ok: false, error: describeError(error)});
                console.error(`[mgtest] fail ${name}: ${error.message}`);
                return null;
            }
        };

        await step('lookup', () => {
            const entry = Main.extensionManager.lookup(UUID);
            if (!entry)
                throw new Error('Manunggal is not installed');
            if (entry.state !== 1 && entry.state !== 2)
                throw new Error(`Manunggal state is ${entry.state}`);
            if (!entry.stateObj)
                throw new Error('Manunggal has no state object');
            this._ext = entry.stateObj;
            return {state: entry.state};
        });

        if (!this._ext) {
            report.ok = false;
            writeReport(report);
            this._finish(report);
            return;
        }

        const ind = this._ext._indicator;
        const view = ind?._mainView;
        const store = this._ext._store;
        const settings = this._ext._settings;

        await step('objects', () => {
            if (!ind || !view || !store || !settings)
                throw new Error('missing runtime objects');
            return {
                panelButton: Boolean(ind.button),
                menu: Boolean(ind.menu),
                entries: store.entries?.length ?? 0,
                loaded: Boolean(store.loaded),
                activeTab: view.activeTab,
            };
        });

        await step('accessibility', async () => {
            const failures = [];
            const counts = {buttons: 0, entries: 0, focusable: 0};
            const walk = actor => {
                if (actor instanceof St.Button) {
                    counts.buttons++;
                    if (!String(actor.accessible_name ?? '').trim()) {
                        failures.push(`button ${actor.get_style_class_name?.() ?? '?'} ` +
                            `(${actor.constructor.name})`);
                    }
                } else if (actor instanceof St.Entry) {
                    counts.entries++;
                    if (!String(actor.accessible_name ?? '').trim())
                        failures.push('entry');
                }
                if (actor.can_focus)
                    counts.focusable++;
                for (const child of actor.get_children?.() ?? [])
                    walk(child);
            };
            walk(view.actor);
            return {
                counts,
                failureCount: failures.length,
                failures: failures.slice(0, 40),
            };
        });

        await step('clipboard-set', async () => {
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD,
                'Manunggal harness clipboard entry');
            await wait(1200);
            return {entries: store.entries.map(entry => ({
                kind: entry.kind,
                text: entry.text?.slice(0, 80),
                category: entry.category,
            }))};
        });

        await step('clipboard-variety', async () => {
            store.addText('const answer = 42;\nconsole.log(answer);',
                {category: 'code'});
            store.addText('#D63F62', {category: 'color'});
            // 16×16 PNG so the image card renders a real thumbnail.
            const png = GLib.base64_decode(
                'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGO4' +
                'Zp/0nxLMMGrAqAGjBgwXAwCwAXYfkCtu5gAAAABJRU5ErkJggg==');
            await store.addImage({
                bytes: png,
                mimetype: 'image/png',
                width: 16,
                height: 16,
            });
            await wait(400);
            return {
                entries: store.entries.map(entry => ({
                    kind: entry.kind,
                    category: entry.category,
                })),
            };
        });

        await step('open-menu', async () => {
            ind.open();
            await wait(600);
            const open = ind.menu.isOpen;
            await wait(300);
            return {open, shot: await this._shot('01-clipboard')};
        });

        await step('private-on', async () => {
            settings.setBool('private-mode', true);
            await wait(350);
            const visible = view._privateLabel.visible;
            const state = store.entries.length;
            await wait(200);
            const shot = await this._shot('02-private');
            return {visible, entries: state, shot};
        });

        await step('private-off', async () => {
            settings.setBool('private-mode', false);
            await wait(300);
            return {visible: view._privateLabel.visible};
        });

        await step('emoji-tab', async () => {
            view.setActiveTab('emoji');
            await wait(450);
            const tab = view._tabs.emoji;
            return {
                cells: tab._grid._cells.length,
                group: tab._groupId,
                sizes: {
                    grid: [tab._grid._grid.actor.width, tab._grid._grid.actor.height],
                    naturalWidth: tab._grid._grid.actor.get_preferred_width(-1),
                    naturalHeight: tab._grid._grid.actor.get_preferred_height(-1),
                    height: tab._grid._grid.actor.height,
                    columns: tab._grid._grid.columns,
                    cell: [tab._grid._cells[0]?.actor.width, tab._grid._cells[0]?.actor.height],
                    scroll: [tab._grid.actor.width, tab._grid.actor.height],
                    content: [tab._grid._scrollContent.width, tab._grid._scrollContent.height],
                    tabActor: [tab.actor.width, tab.actor.height],
                    view: [view.actor.width, view.actor.height],
                    contentArea: [view._contentArea.width, view._contentArea.height],
                },
                shot: await this._shot('03-emoji'),
            };
        });

        await step('emoji-select', async () => {
            const tab = view._tabs.emoji;
            const item = tab._grid._items[0];
            tab._toggleSelection(item);
            await wait(150);
            return {
                selected: tab._selected.length,
                footer: tab._footer.visible,
                shot: await this._shot('04-emoji-selected'),
            };
        });

        await step('symbol-tab', async () => {
            view.setActiveTab('symbol');
            await wait(400);
            const tab = view._tabs.symbol;
            return {
                cells: tab._grid._cells.length,
                group: tab._groupId,
                shot: await this._shot('05-symbol'),
            };
        });

        await step('color-tab', async () => {
            view.setActiveTab('color');
            await wait(450);
            const tab = view.colorTab;
            tab.setColor({r: 214, g: 63, b: 98, a: 1});
            tab._advancedToggle.set_checked(true);
            tab._advancedToggle.emit('clicked', tab._advancedToggle);
            await wait(300);
            return {
                hex: tab._bigHex.text,
                rgba: tab._smallRgba.text,
                sizes: {
                    flow: [tab._recentFlow.actor.width, tab._recentFlow.actor.height],
                    palette: tab._paletteSwatches[0]
                        ? [tab._paletteSwatches[0].width, tab._paletteSwatches[0].height]
                        : null,
                    wheel: [tab._wheel.actor.width, tab._wheel.actor.height],
                    content: [tab._content.width, tab._content.height],
                },
                shot: await this._shot('06-color'),
            };
        });

        await step('color-sampling', async () => {
            const sampler = this._ext._sampler;
            return await sampler.sample(100, 100);
        });

        await step('search-tab', async () => {
            view.setActiveTab('clipboard');
            await wait(250);
            view._searchBar.setScope('tab');
            view._searchBar.setText('harness');
            view._applySearch();
            await wait(350);
            return {
                rows: view._clipboardTab._rows.length,
                query: view._searchBar.query,
                shot: await this._shot('07-search-tab'),
            };
        });

        await step('search-all', async () => {
            view._searchBar.setScope('all');
            view._applySearch();
            await wait(400);
            return {
                showingResults: view._showingResults,
                rows: view._results._rows.length,
                shot: await this._shot('08-search-all'),
            };
        });

        await step('dialog', async () => {
            view._searchBar.clear();
            const findOverlay = () => {
                for (const child of Main.layoutManager.uiGroup.get_children()) {
                    if (child.has_style_class_name?.('manunggal-modal-overlay'))
                        return child;
                }
                return null;
            };
            // Opens the confirmation dialog; cancelling keeps history intact.
            view._clearHistory();
            let overlay = null;
            for (let i = 0; i < 20 && !overlay; i++) {
                await wait(100);
                overlay = findOverlay();
            }
            if (!overlay)
                throw new Error('dialog overlay was not added');
            const box = overlay.get_first_child();
            if (!box)
                throw new Error('dialog box was not built');
            const bg = box.get_theme_node().get_background_color();
            const shot = await this._shot('09-dialog');
            let cancel = null;
            const walk = actor => {
                if (!cancel && actor instanceof St.Button && actor.label === 'Cancel')
                    cancel = actor;
                for (const child of actor.get_children?.() ?? [])
                    walk(child);
            };
            walk(box);
            if (cancel)
                cancel.emit('clicked', cancel);
            await wait(300);
            return {
                hasBackground: bg.alpha > 0,
                background: [bg.red, bg.green, bg.blue, bg.alpha],
                cancelled: Boolean(cancel),
                closed: findOverlay() === null,
                shot,
            };
        });

        await step('close-menu', async () => {
            view._searchBar.clear();
            // Escape with nothing left to dismiss must close the menu.
            view._handleKeyPress(keyEvent(Clutter.KEY_Escape));
            await wait(350);
            return {open: ind.menu.isOpen};
        });

        await step('floating-open', async () => {
            settings.setString('open-mode', 'floating');
            await wait(200);
            // Routing through the indicator mirrors a panel-icon click.
            ind.open();
            await wait(700);
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('floating window was not created');
            const area = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.primaryIndex);
            const [x, y] = [floating.actor.x, floating.actor.y];
            const [width, height] = [floating.actor.width, floating.actor.height];
            return {
                presentation: ind.presentation,
                menuOpen: ind.menu.isOpen,
                parentIsUiGroup:
                    floating.actor.get_parent() === Main.layoutManager.uiGroup,
                size: [width, height],
                position: [x, y],
                workArea: [area.x, area.y, area.width, area.height],
                insideWorkArea: x >= area.x && y >= area.y &&
                    x + width <= area.x + area.width &&
                    y + height <= area.y + area.height,
                viewParent: view.actor.get_parent() === floating._body,
                viewHeaderHidden: !view._header.visible,
                viewSize: [view.actor.width, view.actor.height],
                viewPreferred: view.actor.get_preferred_height(-1),
                bodySize: [floating._body.width, floating._body.height],
                headerSize: [floating._header.width, floating._header.height],
                contentSize: [
                    view._contentArea.width,
                    view._contentArea.height,
                ],
                fitsInsideWindow:
                    view.actor.width <= floating.actor.width &&
                    view.actor.height + floating._header.height <=
                        floating.actor.height,
                focused: global.stage.get_key_focus() !== null,
                shot: await this._shot('10-floating'),
            };
        });

        await step('floating-keyboard', async () => {
            if (!this._ext._floating)
                throw new Error('no floating window');
            const control = Clutter.ModifierType.CONTROL_MASK;
            const press = (symbol, state = 0) =>
                view._handleKeyPress(keyEvent(symbol, state));
            press(Clutter.KEY_2, control);
            await wait(150);
            const second = view.activeTab;
            press(Clutter.KEY_4, control);
            await wait(150);
            const fourth = view.activeTab;
            press(Clutter.KEY_f, control);
            await wait(200);
            return {
                second,
                fourth,
                afterCtrlF: view.activeTab,
                // St.Entry delegates key handling to its ClutterText, but the
                // stage focus owner is the entry actor itself.
                searchFocused:
                    global.stage.get_key_focus() === view._searchBar._entry,
            };
        });

        await step('floating-clamp', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            const area = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.primaryIndex);
            settings.setInt('floating-width', 1200);
            settings.setInt('floating-height', 1200);
            settings.setInt('floating-x', 99999);
            settings.setInt('floating-y', 99999);
            await wait(300);
            const [x, y] = [floating.actor.x, floating.actor.y];
            const [width, height] = [floating.actor.width, floating.actor.height];
            return {
                size: [width, height],
                position: [x, y],
                maxSize: [
                    Math.round(area.width * 0.92),
                    Math.round(area.height * 0.92),
                ],
                withinBounds: x >= area.x && y >= area.y &&
                    x + width <= area.x + area.width &&
                    y + height <= area.y + area.height,
            };
        });

        await step('floating-drag', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            const area = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.primaryIndex);
            floating._x = area.x + 40;
            floating._y = area.y + 40;
            floating.actor.set_position(floating._x, floating._y);
            const buttonPress = floating._onPress({
                get_button: () => 1,
                get_coords: () => [floating._x + 20, floating._y + 12],
                get_source: () => floating._closeButton,
            });
            const start = [floating._x, floating._y];
            floating._onPress({
                get_button: () => 1,
                get_coords: () => [start[0] + 20, start[1] + 12],
                get_source: () => floating._header,
            });
            floating._onMotion({
                get_coords: () => [start[0] + 80, start[1] + 50],
            });
            const moved = [floating.actor.x, floating.actor.y];
            floating._onRelease();
            return {
                buttonPressPropagated: buttonPress === Clutter.EVENT_PROPAGATE,
                movedBy: [moved[0] - start[0], moved[1] - start[1]],
                position: moved,
                persisted: [
                    settings.getInt('floating-x'),
                    settings.getInt('floating-y'),
                ],
            };
        });

        await step('floating-reset', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            const area = Main.layoutManager.getWorkAreaForMonitor(
                Main.layoutManager.primaryIndex);
            settings.setInt('floating-width', 420);
            settings.setInt('floating-height', 560);
            await wait(200);
            floating._resetPosition();
            await wait(250);
            const expected = [
                area.x + Math.round((area.width - floating.actor.width) / 2),
                area.y + Math.round((area.height - floating.actor.height) / 2),
            ];
            return {
                position: [floating.actor.x, floating.actor.y],
                expected,
                centred: Math.abs(floating.actor.x - expected[0]) <= 1 &&
                    Math.abs(floating.actor.y - expected[1]) <= 1,
                shot: await this._shot('11-floating-reset'),
            };
        });

        await step('floating-layer', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            settings.setBool('floating-keep-above', false);
            await wait(250);
            const windowLayer =
                floating.actor.get_parent() === global.window_group;
            settings.setBool('floating-keep-above', true);
            await wait(250);
            return {
                windowLayer,
                uiLayer:
                    floating.actor.get_parent() === Main.layoutManager.uiGroup,
                fallback: floating.keepAboveFallback,
            };
        });

        await step('floating-workspaces', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            const active = global.workspace_manager.get_active_workspace_index();
            settings.setBool('floating-all-workspaces', false);
            await wait(250);
            const visibleOnOpen = floating.actor.visible;
            floating._openedWorkspace = active + 1;
            floating._syncWorkspaceVisibility();
            const hiddenAway = !floating.actor.visible;
            floating._openedWorkspace = active;
            floating._syncWorkspaceVisibility();
            const visibleAgain = floating.actor.visible;
            settings.setBool('floating-all-workspaces', true);
            await wait(250);
            return {
                visibleOnOpen,
                hiddenAway,
                visibleAgain,
                visibleEverywhere: floating.actor.visible,
            };
        });

        await step('floating-outside', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            settings.setBool('floating-close-outside', true);
            await wait(250);
            const connected = floating._stageId !== 0;
            settings.setBool('floating-close-outside', false);
            await wait(250);
            return {
                connected,
                disconnected: floating._stageId === 0,
                stillOpen: floating.visible,
            };
        });

        await step('floating-close', async () => {
            const floating = this._ext._floating;
            if (!floating)
                throw new Error('no floating window');
            // Escape with nothing left to dismiss must close the overlay.
            view._handleKeyPress(keyEvent(Clutter.KEY_Escape));
            await wait(500);
            const closed = {
                cleared: this._ext._floating === null,
                actorDetached: floating.closed,
                focusCleared: global.stage.get_key_focus() === null,
                viewBackInMenu: view.actor.get_parent() === ind.menu.box,
                viewHeaderRestored: view._header.visible,
                menuClosed: !ind.menu.isOpen,
            };
            settings.setString('open-mode', 'menu');
            await wait(200);
            ind.open();
            await wait(500);
            const menuWorks = ind.menu.isOpen;
            ind.close();
            await wait(300);
            return {...closed, presentation: ind.presentation, menuWorks};
        });

        await step('performance', async () => {
            const mono = () => GLib.get_monotonic_time();
            const stats = runs => {
                const sorted = [...runs].sort((a, b) => a - b);
                const sum = sorted.reduce((total, value) => total + value, 0);
                return {
                    bestMs: Number(sorted[0].toFixed(2)),
                    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
                    meanMs: Number((sum / sorted.length).toFixed(2)),
                };
            };
            const time = (fn, runs = 5) => {
                const samples = [];
                for (let i = 0; i < runs; i++) {
                    const start = mono();
                    fn();
                    samples.push((mono() - start) / 1000);
                }
                return stats(samples);
            };

            // Seed a full list while the menu is closed: the tab defers its
            // refresh, so this measures the open path rather than 100 store
            // events.
            for (let i = 0; i < 100; i++)
                store.addText(`Performance sample entry ${i} — unique ${i}`);

            // Menu open with the 100-entry list: click to open signal,
            // including the first row build.
            const openMs = await new Promise(resolve => {
                const start = mono();
                const id = ind.menu.connect('open-state-changed', (_menu, open) => {
                    if (!open)
                        return;
                    ind.menu.disconnect(id);
                    resolve((mono() - start) / 1000);
                });
                ind.open();
            });
            await wait(200);

            // A mapped view is the realistic refresh path. One rebuild, with a
            // settle gap: three back-to-back rebuilds mostly measure GC.
            await wait(150);
            const clipboard = view._clipboardTab;
            const refreshStart = mono();
            clipboard.refresh();
            const refreshMs = (mono() - refreshStart) / 1000;
            const rows = clipboard._rows.length;

            const symbolSearch = time(() =>
                view._tabs.symbol._config.search('arrow', 400));
            const emojiSearch = time(() =>
                view._tabs.emoji._config.search('heart', 400));

            ind.close();
            await wait(200);

            const timings = {
                clipboardRefresh100Ms: Number(refreshMs.toFixed(2)),
                symbolSearch1769: symbolSearch,
                emojiSearch1898: emojiSearch,
                menuOpen100EntriesMs: Number(openMs.toFixed(2)),
                rows,
            };
            report.timings = timings;
            return timings;
        });

        writeReport(report);
        this._finish(report);
    }

    _finish(report) {
        this._finished = true;
        writeReport(report);
        console.log('[mgtest] FINISHED');
        console.log(`[mgtest] report at ${OUT}/report.json`);
    }
}

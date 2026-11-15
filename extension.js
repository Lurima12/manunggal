// SPDX-License-Identifier: GPL-2.0-or-later
//
// Manunggal — clipboard, emoji, symbol and colour in one panel menu.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {EXTENSION_NAME, UUID} from './src/constants.js';
import {ClipboardWatcher} from './src/services/clipboardWatcher.js';
import {ColorSampler} from './src/services/colorSampler.js';
import {HistoryStore} from './src/services/historyStore.js';
import {Settings} from './src/services/settings.js';
import {ColorPickerOverlay} from './src/ui/colorPickerOverlay.js';
import {FloatingWindow} from './src/ui/floatingWindow.js';
import {ManunggalIndicator} from './src/ui/indicator.js';

function prettyShortcut(accelerator) {
    return accelerator
        .replace(/<([^>]+)>/g, '$1+')
        .replace(/\+$/, '')
        .replace(/\+([a-z])$/, (_match, letter) => `+${letter.toUpperCase()}`);
}

function delay(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

export default class ManunggalExtension extends Extension {
    enable() {
        this._enabled = true;
        this._settings = new Settings(this);
        this._store = new HistoryStore(this._settings);
        this._watcher = new ClipboardWatcher(this._settings, this._store);
        this._sampler = new ColorSampler();
        this._overlay = null;
        this._floating = null;
        this._pickingColor = false;
        this._settingsIds = [];
        this._wasLocked = false;

        if (!this._settings.getBool('privacy-remember') &&
            this._settings.getBool('private-mode')) {
            this._settings.setBool('private-mode', false);
        }

        this._indicator = new ManunggalIndicator({
            settings: this._settings,
            store: this._store,
            copyEntry: entry => this._copyEntry(entry),
            copyText: text => this._copyText(text),
            openPreferences: () => this.openPreferences(),
            togglePrivate: () => this._togglePrivate(),
            pickScreen: () => this._pickColorFromScreen(),
            toggleFloating: () => this._toggleFloating(),
            closeFloating: () => this._closeFloating(),
            onOpened: () => this._onFirstOpen(),
        });
        this._indicator.setPresentation(this._settings.getString('open-mode'));
        Main.panel.addToStatusArea(UUID, this._indicator.button, 1, 'right');
        this._indicator.setPrivate(this._settings.getBool('private-mode'));

        this._addKeybinding();
        this._connectSettings();
        this._connectSession();

        this._store.init().then(() => {
            if (!this._enabled)
                return;
            this._watcher.start();
            this._indicator.updateGeometry();
        }).catch(e => {
            console.error(`Manunggal: history could not be initialised (${e.message})`);
            if (this._enabled)
                this._watcher.start();
        });
    }

    disable() {
        this._enabled = false;
        this._removeKeybinding();

        for (const id of this._settingsIds) {
            try {
                this._settings.disconnect(id);
            } catch {
                // Settings may already be gone.
            }
        }
        this._settingsIds = [];

        if (this._sessionUpdatedId) {
            try {
                Main.sessionMode.disconnect(this._sessionUpdatedId);
            } catch {
                // Session mode is going away.
            }
            this._sessionUpdatedId = 0;
        }

        if (this._overlay) {
            this._overlay.cancel();
            this._overlay = null;
        }

        this._closeFloating();
        this._indicator?.destroy();
        this._indicator = null;
        this._watcher?.destroy();
        this._watcher = null;

        if (this._store) {
            if (this._settings.getBool('persist-history')) {
                this._store.flush();
            } else {
                this._store.forgetSaved();
                this._store.discardFiles();
            }
            this._store.destroy();
            this._store = null;
        }

        this._sampler?.destroy();
        this._sampler = null;
        this._settings?.destroy();
        this._settings = null;
    }

    // ------------------------------------------------------------- keybinding

    _addKeybinding() {
        try {
            Main.wm.addKeybinding(
                'toggle-shortcut',
                this._settings.raw,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => this._indicator?.toggle());
        } catch (e) {
            console.error(`Manunggal: shortcut could not be registered (${e.message})`);
        }
    }

    _removeKeybinding() {
        try {
            Main.wm.removeKeybinding('toggle-shortcut');
        } catch {
            // Not registered.
        }
    }

    _connectSettings() {
        this._settingsIds.push(this._settings.connect('toggle-shortcut', () => {
            this._removeKeybinding();
            this._addKeybinding();
        }));
        this._settingsIds.push(this._settings.connect('private-mode', value => {
            this._indicator?.setPrivate(value);
        }));
        this._settingsIds.push(this._settings.connect('persist-history', value => {
            this._store?.setPersistence(value);
        }));
        this._settingsIds.push(this._settings.connect('open-mode', value => {
            const floating = value === 'floating';
            if (!floating)
                this._closeFloating();
            this._indicator?.setPresentation(floating ? 'floating' : 'menu');
        }));
        this._settingsIds.push(this._settings.connect('clear-history-request', () => {
            if (!this._store)
                return;
            this._store.clear();
            this._store.purgeFiles().catch(() => {});
        }));
    }

    _connectSession() {
        if (!Main.sessionMode?.connect)
            return;
        this._sessionUpdatedId = Main.sessionMode.connect('updated', () => {
            const locked = Boolean(Main.sessionMode.isLocked);
            if (locked && !this._wasLocked &&
                this._settings.getBool('clear-on-lock')) {
                this._store.clear();
                this._store.purgeFiles().catch(() => {});
            }
            this._wasLocked = locked;
        });
    }

    // --------------------------------------------------------------- actions

    _copyText(text) {
        return this._watcher?.copyText(text) ?? false;
    }

    async _copyEntry(entry) {
        const ok = await this._watcher?.copyEntry(entry);
        if (ok)
            this._store.touch(entry.id);
        return Boolean(ok);
    }

    _togglePrivate() {
        this._settings.setBool('private-mode',
            !this._settings.getBool('private-mode'));
    }

    _toggleFloating() {
        if (this._floating) {
            if (this._floating.visible)
                this._closeFloating();
            else
                this._floating.present();
            return;
        }
        this._openFloating();
    }

    _openFloating() {
        if (!this._enabled || !this._indicator)
            return;
        if (this._floating) {
            this._floating.present();
            return;
        }
        this._indicator.close();
        this._indicator.detachView();
        const floating = new FloatingWindow({
            settings: this._settings,
            view: this._indicator.mainView,
            panelButton: this._indicator.button,
            onClose: () => this._closeFloating(),
            onTogglePrivate: () => this._togglePrivate(),
        });
        this._floating = floating;
        floating.setView(this._indicator.mainView.actor);
        floating.attach();
        floating.present();
        this._onFirstOpen();
    }

    _closeFloating() {
        if (!this._floating)
            return;
        const floating = this._floating;
        this._floating = null;
        floating.close();
        floating.destroy();
        this._indicator?.attachView();
        this._indicator?.updateGeometry();
    }

    async _pickColorFromScreen() {
        if (this._pickingColor || !this._enabled)
            return;
        this._pickingColor = true;
        try {
            this._indicator.close();
            // Let the popup release its grab before the overlay takes one.
            await delay(220);
            if (!this._enabled)
                return;

            const overlay = new ColorPickerOverlay(this._sampler);
            this._overlay = overlay;
            const result = await overlay.pick();
            this._overlay = null;

            if (!this._enabled)
                return;
            await delay(80);
            this._indicator.openAt('color');
            const colorTab = this._indicator.mainView?.colorTab;
            if (result.color)
                colorTab?.setColor(result.color);
            else
                colorTab?.showSamplingError(result.error ?? 'cancelled');
        } catch (e) {
            console.error(`Manunggal: colour sampling failed (${e.message})`);
        } finally {
            this._pickingColor = false;
        }
    }

    _onFirstOpen() {
        if (!this._settings?.getBool('first-run'))
            return;
        const shortcut = prettyShortcut(
            this._settings.getStrv('toggle-shortcut')[0] ?? '<Super><Shift>v');
        this._indicator.showToast(
            `${EXTENSION_NAME} is ready. Press ${shortcut} or click the panel icon.`,
            {timeout: 8000});
        this._settings.setBool('first-run', false);
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {EXTENSION_NAME, PANEL_ICON, PRIVATE_ICON} from '../constants.js';
import {MainView} from './mainView.js';

export class ManunggalIndicator {
    constructor(options) {
        this._options = options;
        this._private = false;
        this._openIdle = 0;
        this._presentation = options.settings.getString('open-mode');

        this.button = new PanelMenu.Button(0.5, EXTENSION_NAME, false);
        this._icon = new St.Icon({
            icon_name: PANEL_ICON,
            style_class: 'system-status-icon manunggal-panel-icon',
        });
        this.button.add_child(this._icon);
        this.button.menu.box.add_style_class_name('manunggal-menu-content');

        this._mainView = new MainView({
            settings: options.settings,
            store: options.store,
            copyEntry: entry => options.copyEntry(entry),
            copyText: text => options.copyText(text),
            onClose: () => this.close(),
            onOpenPreferences: () => options.openPreferences(),
            onTogglePrivate: () => options.togglePrivate(),
            onPickScreen: () => options.pickScreen(),
        });
        this.button.menu.box.add_child(this._mainView.actor);

        this._openStateId = this.button.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) {
                this._cancelOpenIdle();
                return;
            }
            this._cancelOpenIdle();
            if (this._presentation === 'floating') {
                this.button.menu.close();
                this._options.toggleFloating?.();
                return;
            }
            this._openIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._openIdle = 0;
                this._mainView.open();
                this._options.onOpened?.();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    get menu() {
        return this.button.menu;
    }

    get mainView() {
        return this._mainView;
    }

    get privateMode() {
        return this._private;
    }

    _cancelOpenIdle() {
        if (this._openIdle) {
            GLib.source_remove(this._openIdle);
            this._openIdle = 0;
        }
    }

    get presentation() {
        return this._presentation;
    }

    setPresentation(mode) {
        this._presentation = mode === 'floating' ? 'floating' : 'menu';
        // Never leave the popup open across a presentation change.
        if (this.button.menu.isOpen)
            this.button.menu.close();
    }

    detachView() {
        const parent = this._mainView?.actor.get_parent();
        if (parent)
            parent.remove_child(this._mainView.actor);
    }

    attachView() {
        if (!this._mainView)
            return;
        if (!this._mainView.actor.get_parent())
            this.button.menu.box.add_child(this._mainView.actor);
    }

    toggle() {
        if (this._presentation === 'floating') {
            this._options.toggleFloating?.();
            return;
        }
        if (this.button.menu.isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._presentation === 'floating') {
            this._options.toggleFloating?.();
            return;
        }
        this.button.menu.open();
    }

    openAt(tabId) {
        this._mainView.setActiveTab(tabId);
        this.open();
    }

    close() {
        if (this._presentation === 'floating') {
            this._options.closeFloating?.();
            return;
        }
        this.button.menu.close();
    }

    setPrivate(isPrivate) {
        this._private = Boolean(isPrivate);
        this._icon.icon_name = this._private ? PRIVATE_ICON : PANEL_ICON;
        this.button.set_accessible_name(this._private
            ? `${EXTENSION_NAME}, private mode on`
            : EXTENSION_NAME);
        this._mainView.setPrivate(this._private);
    }

    showToast(message, options) {
        this._mainView.showToast(message, options);
    }

    updateGeometry() {
        this._mainView.updateGeometry();
    }

    destroy() {
        this._cancelOpenIdle();
        if (this._openStateId) {
            try {
                this.button.menu.disconnect(this._openStateId);
            } catch {
                // Menu is going away.
            }
            this._openStateId = 0;
        }
        this._mainView?.destroy();
        this._mainView = null;
        this.button.destroy();
        this._options = null;
    }
}

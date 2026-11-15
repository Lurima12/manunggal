// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class TabBar {
    /**
     * @param {{id: string, label: string, icon: string}[]} tabs
     * @param {string} active
     * @param {(id: string) => void} onSelected
     */
    constructor(tabs, active, onSelected) {
        this._tabs = tabs;
        this._active = active;
        this._onSelected = onSelected;
        this._buttons = new Map();
        this._labelsVisible = true;

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-tab-bar',
            x_expand: true,
        });

        for (const tab of tabs) {
            const button = new St.Button({
                style_class: 'button manunggal-tab-button',
                can_focus: true,
                toggle_mode: true,
                checked: tab.id === active,
                x_expand: true,
            });
            button.accessible_role = Atk.Role.PAGE_TAB;
            button.set_accessible_name(tab.label);

            const box = new St.BoxLayout({
                style_class: 'manunggal-tab-content',
                x_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(new St.Icon({
                icon_name: tab.icon,
                style_class: 'manunggal-tab-icon',
            }));
            const label = new St.Label({
                text: tab.label,
                style_class: 'manunggal-tab-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(label);
            button.set_child(box);
            button._manunggalLabel = label;
            button._manunggalTabId = tab.id;

            button.connect('clicked', () => this.select(tab.id, true));
            button.connect('key-press-event', (_actor, event) => {
                const index = this._tabs.findIndex(entry => entry.id === tab.id);
                switch (event.get_key_symbol()) {
                case Clutter.KEY_Left:
                    this._move(index - 1);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_Right:
                    this._move(index + 1);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_Home:
                    this._move(0);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_End:
                    this._move(this._tabs.length - 1);
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
                }
            });

            this._buttons.set(tab.id, button);
            this.actor.add_child(button);
        }
    }

    _move(index) {
        const clamped = Math.max(0, Math.min(this._tabs.length - 1, index));
        const id = this._tabs[clamped].id;
        this.select(id, true);
        this._buttons.get(id)?.grab_key_focus();
    }

    select(id, emit = false) {
        if (!this._buttons.has(id))
            return;
        this._active = id;
        for (const [key, button] of this._buttons) {
            button.set_checked(key === id);
            if (key === id)
                button.add_style_class_name('manunggal-tab-active');
            else
                button.remove_style_class_name('manunggal-tab-active');
        }
        if (emit)
            this._onSelected?.(id);
    }

    get active() {
        return this._active;
    }

    setLabelsVisible(visible) {
        this._labelsVisible = Boolean(visible);
        for (const button of this._buttons.values()) {
            button._manunggalLabel.visible = this._labelsVisible;
            button.set_accessible_name(
                this._tabs.find(tab => tab.id === button._manunggalTabId)?.label ??
                button._manunggalLabel.text);
        }
    }

    focusActive() {
        this._buttons.get(this._active)?.grab_key_focus();
    }

    destroy() {
        this.actor.destroy();
    }
}

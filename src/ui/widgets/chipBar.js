// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * A single-select chip row. Buttons are real St.Buttons, so they are reachable
 * with Tab and activated with Enter/Space. Left/Right moves between chips.
 */
export class ChipBar {
    /**
     * @param {{id: string, label: string, icon?: string, swatch?: string}[]} items
     * @param {string} selected
     * @param {(id: string) => void} onSelected
     */
    constructor(items, selected, onSelected) {
        this._onSelected = onSelected;
        this._items = items;
        this._buttons = new Map();
        this._selected = selected;

        this.actor = new St.BoxLayout({
            style_class: 'manunggal-chips',
            x_expand: true,
        });

        for (const item of items) {
            const button = new St.Button({
                style_class: 'button manunggal-chip',
                can_focus: true,
                toggle_mode: true,
                checked: item.id === selected,
                accessible_name: item.label,
            });
            button.accessible_role = Atk.Role.TOGGLE_BUTTON;
            button._chipId = item.id;

            const box = new St.BoxLayout({style_class: 'manunggal-chip-content'});
            if (item.icon) {
                box.add_child(new St.Icon({
                    icon_name: item.icon,
                    style_class: 'manunggal-chip-icon',
                }));
            }
            if (item.swatch) {
                box.add_child(new St.Widget({
                    style_class: 'manunggal-chip-swatch',
                    style: `background-color: ${item.swatch};`,
                }));
            }
            box.add_child(new St.Label({
                text: item.label,
                style_class: 'manunggal-chip-label',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            button.set_child(box);

            button.connect('clicked', () => this.select(item.id, true));
            button.connect('key-press-event', (_actor, event) => {
                const index = this._items.findIndex(entry => entry.id === item.id);
                switch (event.get_key_symbol()) {
                case Clutter.KEY_Left:
                    this._focusAt(index - 1);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_Right:
                    this._focusAt(index + 1);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_Home:
                    this._focusAt(0);
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_End:
                    this._focusAt(this._items.length - 1);
                    return Clutter.EVENT_STOP;
                default:
                    return Clutter.EVENT_PROPAGATE;
                }
            });

            this._buttons.set(item.id, button);
            this.actor.add_child(button);
        }
    }

    _focusAt(index) {
        const clamped = Math.max(0, Math.min(this._items.length - 1, index));
        this._buttons.get(this._items[clamped].id)?.grab_key_focus();
    }

    select(id, emit = false) {
        if (!this._buttons.has(id))
            return;
        this._selected = id;
        for (const [key, button] of this._buttons)
            button.set_checked(key === id);
        if (emit)
            this._onSelected?.(id);
    }

    get selected() {
        return this._selected;
    }

    setItemVisible(id, visible) {
        const button = this._buttons.get(id);
        if (button)
            button.visible = Boolean(visible);
    }

    focusSelected() {
        this._buttons.get(this._selected)?.grab_key_focus();
    }

    destroy() {
        this.actor.destroy();
    }
}

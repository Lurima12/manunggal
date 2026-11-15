// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

/**
 * Places items in a wrapping grid and sizes itself to the resulting rows.
 *
 * Clutter.FlowLayout misallocates children when it is resized inside a
 * ScrollView, and a row of BoxLayouts cannot shrink below the sum of its
 * children. Positioning the cells in a FixedLayout avoids both problems: the
 * grid has no minimum width to push the menu open, and every cell receives
 * its intended size.
 */
export class WrapGrid {
    /**
     * @param {{styleClass?: string, spacing?: number}} options
     */
    constructor({styleClass = null, spacing = 4} = {}) {
        this._spacing = spacing;
        this._items = [];
        this._columns = 1;
        this._idleId = 0;
        this._cellWidth = 0;
        this._cellHeight = 0;

        this.actor = new St.Widget({
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
            layout_manager: new Clutter.FixedLayout(),
        });
        if (styleClass)
            this.actor.add_style_class_name(styleClass);

        this._widthChangedId = this.actor.connect('notify::width',
            () => this._queueReflow());
    }

    /** @param {St.Widget} actor */
    addItem(actor) {
        this._items.push(actor);
        this.actor.add_child(actor);
        this._queueReflow();
    }

    get items() {
        return [...this._items];
    }

    get columns() {
        return this._columns;
    }

    get visible() {
        return this.actor.visible;
    }

    set visible(value) {
        this.actor.visible = value;
    }

    addStyleClass(name) {
        this.actor.add_style_class_name(name);
        this.refresh();
    }

    removeStyleClass(name) {
        this.actor.remove_style_class_name(name);
        this.refresh();
    }

    /** Re-measure items after a style change that alters their size. */
    refresh() {
        this._cellWidth = 0;
        this._cellHeight = 0;
        this._queueReflow();
    }

    clear() {
        for (const item of this._items) {
            this.actor.remove_child(item);
            item.destroy();
        }
        this._items = [];
        this._columns = 1;
        this._cellWidth = 0;
        this._cellHeight = 0;
        this.actor.set_height(0);
    }

    _queueReflow() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._reflow();
            return GLib.SOURCE_REMOVE;
        });
    }

    _measure() {
        let width = 0;
        let height = 0;
        for (const item of this._items) {
            const [, naturalWidth] = item.get_preferred_width(-1);
            const [, naturalHeight] = item.get_preferred_height(-1);
            width = Math.max(width, naturalWidth);
            height = Math.max(height, naturalHeight);
        }
        this._cellWidth = width;
        this._cellHeight = height;
    }

    _reflow() {
        if (!this._items.length)
            return;

        if (!this._cellWidth || !this._cellHeight)
            this._measure();
        if (!this._cellWidth || !this._cellHeight)
            return;

        const available = this.actor.width;
        // Before the first allocation stack the items in one column, which
        // keeps the minimum width at a single cell.
        const columns = available > 0
            ? Math.max(1, Math.floor((available + this._spacing) /
                (this._cellWidth + this._spacing)))
            : 1;
        this._columns = columns;

        for (let index = 0; index < this._items.length; index++) {
            const item = this._items[index];
            const column = index % columns;
            const row = Math.floor(index / columns);
            item.set_size(this._cellWidth, this._cellHeight);
            item.set_position(
                column * (this._cellWidth + this._spacing),
                row * (this._cellHeight + this._spacing));
        }

        const rows = Math.ceil(this._items.length / columns);
        this.actor.set_height(rows * this._cellHeight +
            Math.max(0, rows - 1) * this._spacing);
    }

    destroy() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        if (this._widthChangedId) {
            this.actor.disconnect(this._widthChangedId);
            this._widthChangedId = 0;
        }
        this._items = [];
        this.actor.destroy();
    }
}

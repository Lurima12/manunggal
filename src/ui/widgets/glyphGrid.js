// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {WrapGrid} from './wrapGrid.js';

const SPACING = 4;
const PAGE_ROWS = 5;

/**
 * Wrapping, keyboard-navigable grid of glyph buttons.
 */
export class GlyphGrid {
    /**
     * @param {{onActivate: (item, {shift: boolean}) => void, accessibleName: (item) => string}} options
     */
    constructor(options) {
        this._options = options;
        this._cells = [];
        this._items = [];
        this._selectedIds = new Set();
        this._selectionOrder = new Map();
        this._lastShift = false;
        this._destroyed = false;

        this.actor = new St.ScrollView({
            style_class: 'manunggal-glyph-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });

        this._grid = new WrapGrid({
            styleClass: 'manunggal-glyph-grid',
            spacing: SPACING,
        });
        this._grid.actor.set_accessible_name('Glyph grid');

        // St.ScrollView only accepts an StScrollable child, so the wrapping
        // grid lives inside a BoxLayout that provides the scrollable interface.
        this._scrollContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        this._scrollContent.add_child(this._grid.actor);
        this.actor.set_child(this._scrollContent);
    }

    get cellSizeClass() {
        return this._sizeClass ?? 'medium';
    }

    setSize(sizeClass) {
        const value = ['small', 'medium', 'large'].includes(sizeClass)
            ? sizeClass : 'medium';
        if (this._sizeClass === value)
            return;
        this._sizeClass = value;
        for (const cls of ['small', 'medium', 'large'])
            this._grid.removeStyleClass(`manunggal-glyph-size-${cls}`);
        this._grid.addStyleClass(`manunggal-glyph-size-${value}`);
    }

    setItems(items) {
        this._grid.clear();
        this._cells = [];
        this._items = items;

        for (let index = 0; index < items.length; index++) {
            const cell = this._makeCell(items[index], index);
            this._cells.push(cell);
            this._grid.addItem(cell.actor);
        }
        this._applySelection();
    }

    _makeCell(item, index) {
        const button = new St.Button({
            style_class: 'manunggal-glyph-cell',
            can_focus: true,
        });
        button.accessible_role = Atk.Role.TOGGLE_BUTTON;
        button.set_accessible_name(this._options.accessibleName(item));

        const container = new St.Widget({layout_manager: new Clutter.BinLayout()});
        const glyph = new St.Label({
            style_class: 'manunggal-glyph',
            text: item.char,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const badge = new St.Label({
            style_class: 'manunggal-glyph-badge',
            text: '',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        container.add_child(glyph);
        container.add_child(badge);
        button.set_child(container);

        const cell = {item, index, actor: button, badge};
        button.connect('button-press-event', (_actor, event) => {
            this._lastShift =
                (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('clicked', () => {
            const shift = this._lastShift;
            this._lastShift = false;
            this._options.onActivate?.(item, {shift});
        });
        button.connect('key-press-event', (_actor, event) =>
            this._onKeyPress(cell, event));
        return cell;
    }

    _onKeyPress(cell, event) {
        const symbol = event.get_key_symbol();
        const columns = this._columns();
        switch (symbol) {
        case Clutter.KEY_Left:
            this._focusIndex(cell.index - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
            this._focusIndex(cell.index + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._focusIndex(cell.index - columns);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._focusIndex(cell.index + columns);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._focusIndex(cell.index - columns * PAGE_ROWS);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._focusIndex(cell.index + columns * PAGE_ROWS);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._focusIndex(0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._focusIndex(this._cells.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_space: {
            const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            this._options.onActivate?.(cell.item, {shift});
            return Clutter.EVENT_STOP;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _columns() {
        return this._grid.columns;
    }

    _focusIndex(index) {
        if (!this._cells.length)
            return;
        const clamped = Math.max(0, Math.min(this._cells.length - 1, index));
        const cell = this._cells[clamped];
        cell.actor.grab_key_focus();
        this._ensureVisible(cell);
    }

    _ensureVisible(cell) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._destroyed || !this.actor || !this._grid)
                return GLib.SOURCE_REMOVE;
            const adjustment = this.actor.get_vadjustment();
            if (!adjustment)
                return GLib.SOURCE_REMOVE;
            const [, cellY] = cell.actor.get_transformed_position();
            const [, gridY] = this._grid.actor.get_transformed_position();
            const top = cellY - gridY;
            const bottom = top + cell.actor.get_height();
            if (top < adjustment.value)
                adjustment.value = top;
            else if (bottom > adjustment.value + adjustment.page_size)
                adjustment.value = bottom - adjustment.page_size;
            return GLib.SOURCE_REMOVE;
        });
    }

    focusFirst() {
        this._focusIndex(0);
    }

    focusItem(item) {
        const index = this._cells.findIndex(cell => cell.item.id === item.id);
        if (index >= 0)
            this._focusIndex(index);
    }

    setSelection(ids, order = []) {
        this._selectedIds = new Set(ids);
        this._selectionOrder = new Map(order.map((id, index) => [id, index + 1]));
        this._applySelection();
    }

    _applySelection() {
        for (const cell of this._cells) {
            const selected = this._selectedIds.has(cell.item.id);
            cell.actor.set_checked(selected);
            cell.actor.add_style_class_name('manunggal-glyph-selected');
            if (!selected)
                cell.actor.remove_style_class_name('manunggal-glyph-selected');
            const order = this._selectionOrder.get(cell.item.id);
            cell.badge.visible = Boolean(order);
            cell.badge.text = order ? String(order) : '';
            cell.actor.set_accessible_name(
                this._options.accessibleName(cell.item, {
                    selected,
                    index: order ?? 0,
                    total: this._selectedIds.size,
                }));
        }
    }

    clear() {
        this.setItems([]);
    }

    destroy() {
        this._destroyed = true;
        this._cells = [];
        this.actor.destroy();
    }
}

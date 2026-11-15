// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {CATEGORY_META, PALETTE} from '../../constants.js';
import {effectiveCategory} from '../../core/classify.js';
import {parseColor, toCss} from '../../core/color.js';
import {formatBytes, relativeTime} from '../../core/format.js';

const ACCENT_NAMES = [
    ['Blue', PALETTE[0]],
    ['Green', PALETTE[3]],
    ['Yellow', PALETTE[6]],
    ['Orange', PALETTE[9]],
    ['Red', PALETTE[12]],
    ['Purple', PALETTE[15]],
    ['Brown', PALETTE[18]],
    ['Grey', PALETTE[23]],
];

function oneLine(text, maxChars) {
    const value = String(text).replace(/\s+/gu, ' ').trim();
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(1, maxChars - 1))}…`;
}

function previewFor(entry, lines) {
    if (entry.sensitive)
        return '••••••••';
    if (entry.kind === 'image')
        return 'Image';
    const max = lines <= 1 ? 110 : lines === 2 ? 190 : lines === 3 ? 260 : 340;
    return oneLine(entry.text ?? '', max);
}

function imageCaption(entry) {
    const parts = [];
    if (entry.width && entry.height)
        parts.push(`${entry.width}×${entry.height}`);
    if (entry.bytes)
        parts.push(formatBytes(entry.bytes));
    return parts.join(' · ');
}

/**
 * One clipboard history row. The row itself is a button; secondary actions are
 * separate focusable buttons inside it.
 */
export class ClipboardRow {
    /**
     * @param {object} entry
     * @param {object} options
     */
    constructor(entry, options) {
        this.entry = entry;
        this._options = options;
        this._menu = null;
        this._destroyed = false;

        const category = effectiveCategory(entry);
        const categoryMeta = CATEGORY_META[category] ?? CATEGORY_META.text;
        const actionsMode = options.actionsMode ?? 'always';

        const row = new St.Button({
            style_class: 'manunggal-card',
            can_focus: true,
            x_expand: true,
        });
        row.accessible_role = Atk.Role.LIST_ITEM;
        row.set_accessible_name(this._accessibleName(categoryMeta, entry));
        if (entry.pinned)
            row.add_style_class_name('manunggal-card-pinned');
        this.actor = row;

        const body = new St.BoxLayout({
            style_class: 'manunggal-card-body',
            vertical: true,
            x_expand: true,
        });
        row.set_child(body);

        // Card header: kind, time, state, then hover/focus actions.
        const header = new St.BoxLayout({
            style_class: 'manunggal-card-header',
            x_expand: true,
        });
        header.add_child(new St.Icon({
            style_class: 'manunggal-card-icon dim-label',
            icon_name: categoryMeta.icon,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(new St.Label({
            style_class: 'manunggal-card-kind',
            text: categoryMeta.label,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (options.showMeta !== false) {
            header.add_child(new St.Label({
                style_class: 'manunggal-card-time dim-label',
                text: relativeTime(entry.lastUsedAt),
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        if (entry.sensitive) {
            header.add_child(new St.Label({
                style_class: 'manunggal-card-badge',
                text: 'Sensitive',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        if (entry.pinned) {
            header.add_child(new St.Icon({
                style_class: 'manunggal-card-pin',
                icon_name: 'view-pin-symbolic',
                icon_size: 12,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        header.add_child(new St.Widget({x_expand: true}));

        const actions = new St.BoxLayout({
            style_class: 'manunggal-card-actions',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._actions = actions;

        this._pinButton = null;
        if (actionsMode !== 'menu') {
            this._pinButton = new St.Button({
                style_class: 'icon-button manunggal-card-action',
                can_focus: true,
                toggle_mode: true,
                checked: Boolean(entry.pinned),
                child: new St.Icon({icon_name: 'view-pin-symbolic'}),
            });
            this._pinButton.set_accessible_name(entry.pinned ? 'Unpin item' : 'Pin item');
            this._pinButton.connect('clicked', () => {
                options.onPin?.(entry);
            });
            actions.add_child(this._pinButton);
        }

        this._menuButton = new St.Button({
            style_class: 'icon-button manunggal-card-action',
            can_focus: true,
            child: new St.Icon({icon_name: 'view-more-symbolic'}),
        });
        this._menuButton.set_accessible_name('Item actions');
        this._menuButton.connect('clicked', () => this._toggleMenu());
        actions.add_child(this._menuButton);
        header.add_child(actions);
        body.add_child(header);

        // Nested preview card: the visual weight sits here, like a stacked
        // sheet of paper inside the outer card.
        const preview = new St.BoxLayout({
            style_class: 'manunggal-card-preview',
            x_expand: true,
        });
        if (entry.accent) {
            preview.add_child(new St.Widget({
                style_class: 'manunggal-card-accent',
                style: `background-color: ${entry.accent};`,
            }));
        }

        if (entry.kind === 'image') {
            if (options.previewFile && !entry.sensitive) {
                preview.add_child(new St.Icon({
                    style_class: 'manunggal-card-thumb',
                    gicon: new Gio.FileIcon({file: options.previewFile}),
                    icon_size: 64,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            } else {
                preview.add_child(new St.Icon({
                    style_class: 'manunggal-card-icon dim-label',
                    icon_name: entry.sensitive
                        ? 'channel-secure-symbolic'
                        : 'image-x-generic-symbolic',
                    icon_size: 32,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            const info = new St.BoxLayout({
                style_class: 'manunggal-card-info',
                vertical: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            info.add_child(new St.Label({
                style_class: 'manunggal-card-text',
                text: entry.sensitive ? '••••••••' : 'Image',
                x_expand: true,
            }));
            const caption = imageCaption(entry);
            if (caption && options.showMeta !== false) {
                info.add_child(new St.Label({
                    style_class: 'manunggal-card-sub dim-label',
                    text: caption,
                    x_expand: true,
                }));
            }
            preview.add_child(info);
        } else if (category === 'color') {
            const color = parseColor(entry.text);
            if (!entry.sensitive) {
                preview.add_child(new St.Widget({
                    style_class: 'manunggal-card-swatch',
                    style: color ? `background-color: ${toCss(color)};` : '',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            preview.add_child(this._previewLabel(entry, options, true));
        } else {
            preview.add_child(this._previewLabel(entry, options,
                category === 'code'));
        }
        body.add_child(preview);

        if (actionsMode === 'hover')
            this._setActionsVisible(false);

        row.connect('clicked', () => options.onCopy?.(entry));
        row.connect('notify::hover', () => {
            if (actionsMode === 'hover')
                this._setActionsVisible(row.hover || row.has_key_focus());
        });
        row.connect('key-focus-in', () => {
            if (actionsMode === 'hover')
                this._setActionsVisible(true);
        });
        row.connect('key-focus-out', () => {
            if (actionsMode === 'hover')
                this._setActionsVisible(row.hover);
        });
        row.connect('key-press-event', (_actor, event) => this._onKeyPress(event));

        this._mode = actionsMode;
    }

    _previewLabel(entry, options, mono) {
        const label = new St.Label({
            style_class: mono
                ? 'manunggal-card-text manunggal-card-mono'
                : 'manunggal-card-text',
            text: previewFor(entry, options.previewLines ?? 2),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    _accessibleName(categoryMeta, entry) {
        if (entry.sensitive)
            return `Sensitive ${categoryMeta.label} item, ${relativeTime(entry.lastUsedAt)}`;
        const preview = entry.kind === 'image'
            ? 'Image'
            : oneLine(entry.text ?? '', 80);
        const parts = [
            `${categoryMeta.label}: ${preview}`,
            relativeTime(entry.lastUsedAt),
        ];
        if (entry.pinned)
            parts.push('pinned');
        return parts.join(', ');
    }

    _setActionsVisible(visible) {
        if (!this._actions)
            return;
        this._actions.opacity = visible ? 255 : 0;
        this._actions.set_reactive(visible);
        this._actions.can_focus = visible;
        for (const child of this._actions.get_children())
            child.can_focus = visible;
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const entry = this.entry;
        switch (symbol) {
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_space:
            this._options.onCopy?.(entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_p:
        case Clutter.KEY_P:
            this._options.onPin?.(entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Delete:
            this._options.onDelete?.(entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_e:
        case Clutter.KEY_E:
            if (entry.kind === 'text')
                this._options.onEdit?.(entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Menu:
        case Clutter.KEY_F10:
            if (symbol === Clutter.KEY_F10 &&
                !(event.get_state() & Clutter.ModifierType.SHIFT_MASK))
                return Clutter.EVENT_PROPAGATE;
            this._openMenu();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._options.onNavigate?.(-1, entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._options.onNavigate?.(1, entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._options.onNavigate?.(-Infinity, entry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._options.onNavigate?.(Infinity, entry);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _toggleMenu() {
        if (this._menu?.isOpen) {
            this._menu.close();
            return;
        }
        this._openMenu();
    }

    _openMenu() {
        if (this._destroyed)
            return;
        if (!this._menu)
            this._buildMenu();
        this._menu.open();
    }

    _buildMenu() {
        const menu = new PopupMenu.PopupMenu(this._menuButton, 0, St.Side.TOP, 0);
        menu.actor.add_style_class_name('manunggal-card-menu');
        this._menu = menu;
        const entry = this.entry;

        const addItem = (label, callback) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                menu.close();
                callback();
            });
            menu.addMenuItem(item);
            return item;
        };

        addItem('Copy', () => this._options.onCopy?.(entry));
        addItem(entry.pinned ? 'Unpin' : 'Pin', () => this._options.onPin?.(entry));

        if (entry.kind === 'text')
            addItem('Edit text', () => this._options.onEdit?.(entry));

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const categoryMenu = new PopupMenu.PopupSubMenuMenuItem('Change category');
        for (const id of ['text', 'code', 'color', 'emoji']) {
            const item = new PopupMenu.PopupMenuItem(CATEGORY_META[id].label);
            if (effectiveCategory(entry) === id && item.setOrnament)
                item.setOrnament(PopupMenu.Ornament.CHECK);
            item.connect('activate', () => {
                menu.close();
                this._options.onCategory?.(entry, id);
            });
            categoryMenu.menu.addMenuItem(item);
        }
        menu.addMenuItem(categoryMenu);

        const accentMenu = new PopupMenu.PopupSubMenuMenuItem('Accent colour');
        const none = new PopupMenu.PopupMenuItem('No accent');
        none.connect('activate', () => {
            menu.close();
            this._options.onAccent?.(entry, null);
        });
        accentMenu.menu.addMenuItem(none);
        for (const [name, color] of ACCENT_NAMES) {
            const item = new PopupMenu.PopupMenuItem(name);
            item.insert_child_at_index(new St.Widget({
                style_class: 'manunggal-menu-swatch',
                style: `background-color: ${color};`,
            }), 0);
            item.connect('activate', () => {
                menu.close();
                this._options.onAccent?.(entry, color);
            });
            accentMenu.menu.addMenuItem(item);
        }
        menu.addMenuItem(accentMenu);

        addItem(entry.sensitive ? 'Remove sensitive mark' : 'Mark as sensitive',
            () => this._options.onSensitive?.(entry, !entry.sensitive));

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const remove = addItem('Delete', () => this._options.onDelete?.(entry));
        remove.add_style_class_name('manunggal-destructive');
    }

    destroy() {
        this._destroyed = true;
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        this.actor.destroy();
    }
}

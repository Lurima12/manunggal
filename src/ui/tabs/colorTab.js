// SPDX-License-Identifier: GPL-2.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {PALETTE} from '../../constants.js';
import {
    equalColor,
    normalize,
    parseColor,
    toHex,
    toRgb,
    toRgba,
} from '../../core/color.js';
import {ColorWheel} from '../widgets/colorWheel.js';
import {WrapGrid} from '../widgets/wrapGrid.js';

const DEFAULT_COLOR = {r: 53, g: 132, b: 228, a: 1};
const MAX_RECENT = 12;
const FORMATS = [
    ['hex', 'HEX'],
    ['rgb', 'RGB'],
    ['rgba', 'RGBA'],
];

function clampByte(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.min(255, n));
}

export class ColorTab {
    constructor(options) {
        this._options = options;
        this._settings = options.settings;
        this._formatRows = new Map();
        this._formatButtons = new Map();
        this._recentFlow = null;
        this._paletteSwatches = [];
        this._recentSwatches = [];
        this._settingsIds = [];
        this._fieldError = null;
        this._samplingError = null;
        this._current = DEFAULT_COLOR;

        const saved = this._settings.getStrv('recent-colors')
            .map(value => parseColor(value))
            .find(Boolean);
        if (saved)
            this._current = normalize(saved);

        this.actor = new St.ScrollView({
            style_class: 'manunggal-tab manunggal-color-tab',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });

        this._content = new St.BoxLayout({
            style_class: 'manunggal-color-content',
            vertical: true,
            x_expand: true,
        });
        this.actor.set_child(this._content);

        this._buildPreview();
        this._buildFormats();
        this._buildSwatches();
        this._buildAdvanced();

        this._settingsIds.push(this._settings.connect('color-format',
            () => this._refreshFormatPreference()));
        this._settingsIds.push(this._settings.connect('hex-uppercase',
            () => this._syncColor()));
        this._settingsIds.push(this._settings.connect('recent-colors',
            () => this._rebuildRecent()));
        this._settingsIds.push(this._settings.connect('color-sampling-enabled',
            () => this._updateSamplingAvailability()));

        this._refreshFormatPreference();
        this._syncColor(true);
        this._rebuildRecent();
        this._updateSamplingAvailability();
    }

    get id() {
        return 'color';
    }

    focusFirst() {
        this._primaryCopy.grab_key_focus();
    }

    scrollToTop() {
        const adjustment = this.actor.get_vadjustment();
        if (adjustment)
            adjustment.value = 0;
    }

    setSearch() {
        // The Color tab has no textual search.
    }

    handleEscape() {
        return false;
    }

    setColor(color) {
        if (!color)
            return;
        this._setColor(color, {fromWheel: false});
    }

    showSamplingError(reason) {
        if (!this._samplingError)
            return;
        const messages = {
            unavailable: 'Screen sampling is not available in this GNOME Shell. ' +
                'Use the wheel or the HEX field instead.',
            denied: 'Screen sampling was denied. Remote and headless sessions may ' +
                'not allow it. Use the wheel or the HEX field instead.',
            'no-colour': 'No colour could be read. Use the wheel or the HEX field instead.',
            cancelled: '',
        };
        const message = messages[reason] ?? '';
        this._samplingError.text = message;
        this._samplingError.visible = Boolean(message);
    }

    // ------------------------------------------------------------------- build

    _buildPreview() {
        const section = new St.BoxLayout({
            style_class: 'manunggal-color-preview-row',
            x_expand: true,
        });

        this._previewArea = new St.DrawingArea({
            style_class: 'manunggal-color-preview',
            reactive: false,
            can_focus: false,
        });
        this._previewArea.accessible_role = Atk.Role.IMAGE;
        this._previewArea.set_accessible_name('Colour preview');
        this._previewArea.connect('repaint', () => this._drawPreview());
        this._previewArea.connect('notify::width', () => this._previewArea.queue_repaint());
        this._previewArea.connect('notify::height', () => this._previewArea.queue_repaint());
        section.add_child(this._previewArea);

        const values = new St.BoxLayout({
            style_class: 'manunggal-color-values',
            vertical: true,
            x_expand: true,
        });
        this._bigHex = new St.Label({
            style_class: 'manunggal-color-big-value',
            text: '—',
        });
        this._smallRgba = new St.Label({
            style_class: 'manunggal-color-small-value dim-label',
            text: '',
        });
        this._primaryCopy = new St.Button({
            style_class: 'button manunggal-primary-copy',
            can_focus: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._primaryCopy.connect('clicked', () => this._copy(this._primaryFormat));
        values.add_child(this._bigHex);
        values.add_child(this._smallRgba);
        values.add_child(this._primaryCopy);
        section.add_child(values);

        this._content.add_child(section);
    }

    _buildFormats() {
        const section = new St.BoxLayout({
            style_class: 'manunggal-color-formats',
            vertical: true,
            x_expand: true,
        });

        for (const [format, label] of FORMATS) {
            const row = new St.BoxLayout({
                style_class: 'manunggal-color-format-row',
                x_expand: true,
            });
            const name = new St.Label({
                style_class: 'manunggal-color-format-name dim-label',
                text: label,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const value = new St.Label({
                style_class: 'manunggal-color-format-value',
                text: '',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const copy = new St.Button({
                style_class: 'icon-button manunggal-color-copy',
                can_focus: true,
                child: new St.Icon({icon_name: 'edit-copy-symbolic'}),
            });
            copy.set_accessible_name(`Copy ${label} value`);
            copy.connect('clicked', () => this._copy(format));

            row.add_child(name);
            row.add_child(value);
            row.add_child(copy);
            section.add_child(row);
            this._formatRows.set(format, row);
            this._formatButtons.set(format, {value, copy});
        }

        this._content.add_child(section);
    }

    _buildSwatches() {
        const section = new St.BoxLayout({
            style_class: 'manunggal-color-swatches',
            vertical: true,
            x_expand: true,
        });
        section.add_child(new St.Label({
            style_class: 'manunggal-section-title dim-label',
            text: 'Swatches',
        }));

        const palette = new WrapGrid({
            styleClass: 'manunggal-swatch-flow',
            spacing: 4,
        });
        for (const hex of PALETTE) {
            const button = this._makeSwatch(hex, `Colour ${hex}`);
            palette.addItem(button);
            this._paletteSwatches.push(button);
        }
        section.add_child(palette.actor);

        this._recentTitle = new St.Label({
            style_class: 'manunggal-section-title dim-label',
            text: 'Recent',
            visible: false,
        });
        this._recentFlow = new WrapGrid({
            styleClass: 'manunggal-swatch-flow',
            spacing: 4,
        });
        section.add_child(this._recentTitle);
        section.add_child(this._recentFlow.actor);

        const pickRow = new St.BoxLayout({
            style_class: 'manunggal-pick-row',
            x_expand: true,
        });
        this._pickButton = new St.Button({
            style_class: 'button manunggal-pick-button',
            can_focus: true,
        });
        const pickBox = new St.BoxLayout({style_class: 'manunggal-pick-content'});
        pickBox.add_child(new St.Icon({icon_name: 'color-select-symbolic'}));
        pickBox.add_child(new St.Label({
            text: 'Pick from screen',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._pickButton.set_child(pickBox);
        this._pickButton.set_accessible_name(
            'Pick a colour from the screen. Only one pixel is read; no screenshot is saved.');
        this._pickButton.connect('clicked', () => {
            this.showSamplingError('cancelled');
            this._options.onPickScreen?.();
        });
        pickRow.add_child(this._pickButton);
        section.add_child(pickRow);

        this._samplingError = new St.Label({
            style_class: 'manunggal-sampling-error dim-label',
            text: '',
            visible: false,
        });
        this._samplingError.clutter_text.line_wrap = true;
        section.add_child(this._samplingError);

        this._content.add_child(section);
    }

    _makeSwatch(hex, name) {
        const button = new St.Button({
            style_class: 'manunggal-color-swatch',
            can_focus: true,
            style: `background-color: ${hex};`,
        });
        button._manunggalColor = hex;
        button.set_accessible_name(name);
        button.connect('clicked', () => {
            const color = parseColor(hex);
            if (color)
                this._setColor(color, {fromWheel: false});
        });
        return button;
    }

    _buildAdvanced() {
        this._advancedToggle = new St.Button({
            style_class: 'button manunggal-advanced-toggle',
            can_focus: true,
            toggle_mode: true,
            label: 'Advanced',
            x_expand: true,
        });
        this._advancedToggle.set_accessible_name('Show advanced colour controls');
        this._advancedToggle.connect('clicked', () => {
            const open = this._advancedToggle.get_checked();
            this._advancedBox.visible = open;
            this._advancedToggle.set_accessible_name(
                open ? 'Hide advanced colour controls' : 'Show advanced colour controls');
        });
        this._content.add_child(this._advancedToggle);

        this._advancedBox = new St.BoxLayout({
            style_class: 'manunggal-advanced-box',
            vertical: true,
            x_expand: true,
            visible: false,
        });

        this._wheel = new ColorWheel({
            onChanged: color => this._setColor(color, {fromWheel: true}),
        });
        this._advancedBox.add_child(this._wheel.actor);

        this._fieldError = new St.Label({
            style_class: 'manunggal-dialog-error',
            text: '',
            visible: false,
        });

        const hexRow = new St.BoxLayout({
            style_class: 'manunggal-advanced-row',
            x_expand: true,
        });
        hexRow.add_child(new St.Label({
            style_class: 'manunggal-field-label dim-label',
            text: 'HEX',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._hexEntry = new St.Entry({
            style_class: 'manunggal-hex-entry',
            hint_text: '#RRGGBB',
            can_focus: true,
            x_expand: true,
        });
        this._hexEntry.set_accessible_name('Hexadecimal colour value');
        this._hexEntry.clutter_text.connect('key-press-event', (_text, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return ||
                event.get_key_symbol() === Clutter.KEY_KP_Enter) {
                this._applyHex();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        hexRow.add_child(this._hexEntry);
        this._advancedBox.add_child(hexRow);

        const rgbaRow = new St.BoxLayout({
            style_class: 'manunggal-advanced-row',
            x_expand: true,
        });
        this._numberEntries = {};
        for (const [key, label] of [['r', 'R'], ['g', 'G'], ['b', 'B'], ['a', 'A %']]) {
            rgbaRow.add_child(new St.Label({
                style_class: 'manunggal-field-label dim-label',
                text: label,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const entry = new St.Entry({
                style_class: 'manunggal-number-entry',
                can_focus: true,
                x_expand: true,
            });
            entry.set_accessible_name(key === 'a'
                ? 'Alpha percentage'
                : `${label} channel`);
            entry.clutter_text.connect('key-press-event', (_text, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Return ||
                    event.get_key_symbol() === Clutter.KEY_KP_Enter) {
                    this._applyNumbers();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._numberEntries[key] = entry;
            rgbaRow.add_child(entry);
        }
        this._advancedBox.add_child(rgbaRow);
        this._advancedBox.add_child(this._fieldError);

        const hint = new St.Label({
            style_class: 'manunggal-advanced-hint dim-label',
            text: 'Every value can be typed. Press Enter to apply.',
        });
        this._advancedBox.add_child(hint);

        this._content.add_child(this._advancedBox);
    }

    // ------------------------------------------------------------------ update

    get _primaryFormat() {
        const format = this._settings.getString('color-format');
        return FORMATS.some(([id]) => id === format) ? format : 'hex';
    }

    _formatValue(format, color = this._current) {
        switch (format) {
        case 'rgb':
            return toRgb(color);
        case 'rgba':
            return toRgba(color, 3);
        case 'hex':
        default:
            return toHex(color, {
                includeAlpha: color.a < 1,
                uppercase: this._settings.getBool('hex-uppercase'),
            });
        }
    }

    _setColor(color, {fromWheel = false} = {}) {
        this._current = normalize(color);
        if (!fromWheel && this._wheel)
            this._wheel.setColor(this._current);
        this._syncColor();
    }

    _syncColor(forceFields = false) {
        if (!this._previewArea)
            return;
        this._previewArea.queue_repaint();
        const hex = this._formatValue('hex');
        this._bigHex.text = hex;
        this._smallRgba.text = this._formatValue('rgba');
        this._previewArea.set_accessible_name(`Colour preview: ${hex}`);
        this._primaryCopy.set_label(`Copy ${this._primaryFormat.toUpperCase()}`);
        this._primaryCopy.set_accessible_name(
            `Copy ${this._primaryFormat.toUpperCase()} value, ${hex}`);

        for (const [format, widgets] of this._formatButtons) {
            widgets.value.text = this._formatValue(format);
            widgets.copy.set_accessible_name(
                `Copy ${format.toUpperCase()} value, ${this._formatValue(format)}`);
        }

        if (this._hexEntry && (forceFields || !this._hexEntry.has_key_focus()))
            this._hexEntry.set_text(hex);
        if (this._numberEntries) {
            const values = {
                r: String(Math.round(this._current.r)),
                g: String(Math.round(this._current.g)),
                b: String(Math.round(this._current.b)),
                a: String(Math.round(this._current.a * 100)),
            };
            for (const [key, entry] of Object.entries(this._numberEntries)) {
                if (forceFields || !entry.has_key_focus())
                    entry.set_text(values[key]);
            }
        }

        this._updateSwatchSelection();
    }

    _refreshFormatPreference() {
        const primary = this._primaryFormat;
        for (const [format, row] of this._formatRows) {
            if (format === primary)
                row.add_style_class_name('manunggal-format-primary');
            else
                row.remove_style_class_name('manunggal-format-primary');
        }
        this._syncColor();
    }

    _updateSwatchSelection() {
        for (const button of this._paletteSwatches) {
            const color = parseColor(button._manunggalColor);
            if (color && equalColor(color, this._current))
                button.add_style_class_name('manunggal-swatch-current');
            else
                button.remove_style_class_name('manunggal-swatch-current');
        }
        for (const button of this._recentSwatches) {
            const color = parseColor(button._manunggalColor);
            if (color && equalColor(color, this._current))
                button.add_style_class_name('manunggal-swatch-current');
            else
                button.remove_style_class_name('manunggal-swatch-current');
        }
    }

    _rebuildRecent() {
        if (!this._recentFlow)
            return;
        this._recentFlow.clear();
        this._recentSwatches = [];

        const colors = this._settings.getStrv('recent-colors')
            .map(value => parseColor(value))
            .filter(Boolean)
            .slice(0, MAX_RECENT);
        this._recentTitle.visible = colors.length > 0;
        this._recentFlow.visible = colors.length > 0;
        for (const color of colors) {
            const hex = toHex(color, {includeAlpha: color.a < 1, uppercase: true});
            const button = this._makeSwatch(hex, `Recent colour ${hex}`);
            button._manunggalColor = hex;
            this._recentFlow.addItem(button);
            this._recentSwatches.push(button);
        }
        this._updateSwatchSelection();
    }

    _updateSamplingAvailability() {
        const enabled = this._settings.getBool('color-sampling-enabled');
        this._pickButton.set_reactive(enabled);
        this._pickButton.opacity = enabled ? 255 : 120;
        if (!enabled) {
            this._samplingError.text = 'Screen sampling is disabled in Preferences. ' +
                'The wheel and fields still work.';
            this._samplingError.visible = true;
        } else if (this._samplingError.text.startsWith('Screen sampling is disabled')) {
            this._samplingError.text = '';
            this._samplingError.visible = false;
        }
    }

    _drawPreview() {
        if (!this._previewArea)
            return;
        const cr = this._previewArea.get_context();
        const width = this._previewArea.width;
        const height = this._previewArea.height;
        const size = 8;

        for (let y = 0; y < height; y += size) {
            for (let x = 0; x < width; x += size) {
                const light = ((x / size) + (y / size)) % 2 === 0;
                const shade = light ? 0.72 : 0.52;
                cr.setSourceRGB(shade, shade, shade);
                cr.rectangle(x, y, size, size);
                cr.fill();
            }
        }

        cr.setSourceRGBA(
            this._current.r / 255,
            this._current.g / 255,
            this._current.b / 255,
            this._current.a);
        cr.rectangle(0, 0, width, height);
        cr.fill();
    }

    _applyHex() {
        const color = parseColor(this._hexEntry.get_text());
        if (!color) {
            this._showFieldError('Enter a complete HEX, rgb(), or hsl() value.');
            return;
        }
        this._clearFieldError();
        this._setColor(color, {fromWheel: false});
    }

    _applyNumbers() {
        const r = clampByte(this._numberEntries.r.get_text());
        const g = clampByte(this._numberEntries.g.get_text());
        const b = clampByte(this._numberEntries.b.get_text());
        const aRaw = Number.parseInt(this._numberEntries.a.get_text(), 10);
        if (r === null || g === null || b === null || !Number.isFinite(aRaw)) {
            this._showFieldError('R, G and B must be 0–255; A must be 0–100.');
            return;
        }
        this._clearFieldError();
        this._setColor({r, g, b, a: Math.max(0, Math.min(100, aRaw)) / 100},
            {fromWheel: false});
        this._syncColor(true);
    }

    _showFieldError(message) {
        this._fieldError.text = message;
        this._fieldError.visible = true;
    }

    _clearFieldError() {
        this._fieldError.text = '';
        this._fieldError.visible = false;
    }

    _copy(format) {
        const text = this._formatValue(format);
        if (!this._options.onCopyText?.(text)) {
            this._options.onToast?.('Could not copy the colour.');
            return;
        }
        this._rememberColor(this._current);
        if (this._settings.getBool('close-after-copy'))
            this._options.onClose?.();
    }

    _rememberColor(color) {
        const hex = toHex(color, {includeAlpha: color.a < 1, uppercase: false}).toLowerCase();
        const recent = this._settings.getStrv('recent-colors')
            .filter(value => value.toLowerCase() !== hex);
        recent.unshift(hex);
        this._settings.setStrv('recent-colors', recent.slice(0, MAX_RECENT));
        this._rebuildRecent();
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._wheel?.destroy();
        this._options = null;
        this.actor.destroy();
    }
}

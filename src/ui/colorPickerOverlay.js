// SPDX-License-Identifier: GPL-2.0-or-later
//
// Full-stage crosshair used for single-pixel colour sampling. The centre of
// the crosshair is deliberately empty so the sampled pixel is never painted by
// this overlay. No screenshot is taken; only Shell.Screenshot.pick_color() is
// used, one pixel at a time.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {toHex, toRgb} from '../core/color.js';

const SAMPLE_DELAY_MS = 60;
const RING_RADIUS = 10;
const LINE_GAP = 15;

export class ColorPickerOverlay {
    /**
     * @param {import('../services/colorSampler.js').ColorSampler} sampler
     */
    constructor(sampler) {
        this._sampler = sampler;
        this._overlay = null;
        this._drawing = null;
        this._preview = null;
        this._swatch = null;
        this._hexLabel = null;
        this._rgbLabel = null;
        this._hint = null;
        this._point = null;
        this._color = null;
        this._sampleId = 0;
        this._generation = 0;
        this._sampling = false;
        this._grab = null;
        this._resolve = null;
        this._finished = false;
        this._signalIds = [];
    }

    /**
     * @returns {Promise<{color?: object, error?: string}>}
     */
    pick() {
        if (this._resolve) {
            return Promise.reject(new Error('colour picker already open'));
        }
        return new Promise(resolve => {
            this._resolve = resolve;
            this._open();
        });
    }

    /**
     * Close the overlay without a result (used when the extension is disabled).
     */
    cancel() {
        this._finish({error: 'cancelled'});
    }

    // ------------------------------------------------------------------- setup

    _open() {
        const stage = global.stage;
        const width = Math.max(1, stage.get_width());
        const height = Math.max(1, stage.get_height());

        const overlay = new St.Widget({
            style_class: 'manunggal-color-picker-overlay',
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width,
            height,
            layout_manager: new Clutter.BinLayout(),
        });
        overlay.set_accessible_name(
            'Screen colour picker. Move the pointer and press Space to pick, Escape to cancel.');

        this._overlay = overlay;
        Main.layoutManager.uiGroup.add_child(overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(overlay, null);

        this._drawing = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        this._signalIds.push(this._drawing.connect('repaint', () => this._repaint()));
        overlay.add_child(this._drawing);

        this._buildPreview();
        this._buildHint();

        this._signalIds.push(overlay.connect(
            'motion-event', this._onMotion.bind(this)));
        this._signalIds.push(overlay.connect(
            'button-press-event', this._onButtonPress.bind(this)));
        this._signalIds.push(overlay.connect(
            'key-press-event', this._onKeyPress.bind(this)));

        try {
            this._grab = Main.pushModal(overlay, {actionMode: Shell.ActionMode.POPUP});
        } catch {
            this._grab = null;
        }
        overlay.grab_key_focus();
        try {
            global.display.set_cursor(Meta.Cursor.CROSSHAIR);
        } catch {
            // Cursor shape is cosmetic.
        }

        const [x, y] = global.get_pointer();
        this._point = {x: Math.round(x), y: Math.round(y)};
        this._drawing.queue_repaint();
        this._positionPreview();
        this._queueSample(true);
    }

    _buildPreview() {
        const box = new St.BoxLayout({
            style_class: 'manunggal-color-picker-preview',
            vertical: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });

        this._swatch = new St.Widget({
            style_class: 'manunggal-color-picker-swatch',
        });
        this._hexLabel = new St.Label({
            style_class: 'manunggal-color-picker-value',
            text: '—',
        });
        this._rgbLabel = new St.Label({
            style_class: 'manunggal-color-picker-subvalue',
            text: '',
        });

        const labels = new St.BoxLayout({vertical: true});
        labels.add_child(this._hexLabel);
        labels.add_child(this._rgbLabel);
        box.add_child(this._swatch);
        box.add_child(labels);
        box.hide();

        this._preview = box;
        this._overlay.add_child(box);
    }

    _buildHint() {
        this._hint = new St.Label({
            style_class: 'manunggal-color-picker-hint',
            text: 'Move to sample · Space to pick · Esc to cancel',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            margin_bottom: 24,
        });
        this._overlay.add_child(this._hint);
    }

    // ---------------------------------------------------------------- sampling

    _queueSample(immediate = false) {
        if (this._sampleId) {
            GLib.source_remove(this._sampleId);
            this._sampleId = 0;
        }
        const run = () => {
            this._sampleId = 0;
            this._updateSample();
            return GLib.SOURCE_REMOVE;
        };
        if (immediate)
            run();
        else
            this._sampleId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, SAMPLE_DELAY_MS, run);
    }

    async _updateSample() {
        if (!this._point || !this._overlay)
            return;
        if (this._sampling) {
            this._queueSample();
            return;
        }

        this._sampling = true;
        const generation = ++this._generation;
        const {x, y} = this._point;
        let result;
        try {
            result = await this._sampler.sample(x, y);
        } catch (e) {
            console.error(`Manunggal: sampling failed (${e.message})`);
            result = {ok: false, reason: 'denied'};
        }
        this._sampling = false;

        if (this._finished || generation !== this._generation || !this._overlay)
            return;

        if (!result.ok) {
            // The compositor refused or cannot sample. Stop and let the tab
            // explain the fallback rather than leaving a dead overlay open.
            this._finish({error: result.reason});
            return;
        }

        this._color = result.color;
        this._preview.show();
        this._swatch.set_style(
            `background-color: ${toRgb(this._color)};`);
        this._hexLabel.text = toHex(this._color, {uppercase: true});
        this._rgbLabel.text = toRgb(this._color);
        this._positionPreview();
    }

    _positionPreview() {
        if (!this._preview || !this._point || !this._preview.visible)
            return;
        const width = this._overlay.width;
        const height = this._overlay.height;
        const [, natural] = this._preview.get_preferred_size();
        const boxWidth = Math.max(160, natural.width);
        const boxHeight = Math.max(64, natural.height);
        let x = this._point.x + 26;
        let y = this._point.y + 26;
        if (x + boxWidth > width - 8)
            x = this._point.x - 26 - boxWidth;
        if (y + boxHeight > height - 8)
            y = this._point.y - 26 - boxHeight;
        this._preview.set_translation(
            Math.max(8, Math.min(width - boxWidth - 8, x)),
            Math.max(8, Math.min(height - boxHeight - 8, y)),
            0);
    }

    // -------------------------------------------------------------------- draw

    _repaint() {
        if (!this._drawing || !this._point)
            return;
        const cr = this._drawing.get_context();
        const width = this._drawing.width;
        const height = this._drawing.height;
        const {x, y} = this._point;

        cr.setLineCap(1); // CAIRO_LINE_CAP_ROUND
        for (const [lineWidth, red, green, blue, alpha] of [
            [3, 0, 0, 0, 0.55],
            [1, 1, 1, 1, 0.95],
        ]) {
            cr.setLineWidth(lineWidth);
            cr.setSourceRGBA(red, green, blue, alpha);
            cr.moveTo(0, y);
            cr.lineTo(Math.max(0, x - LINE_GAP), y);
            cr.moveTo(Math.min(width, x + LINE_GAP), y);
            cr.lineTo(width, y);
            cr.moveTo(x, 0);
            cr.lineTo(x, Math.max(0, y - LINE_GAP));
            cr.moveTo(x, Math.min(height, y + LINE_GAP));
            cr.lineTo(x, height);
            cr.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
            cr.stroke();
        }
    }

    // ------------------------------------------------------------------ events

    _onMotion(_overlay, event) {
        const [x, y] = event.get_coords();
        this._setPoint(x, y);
        return Clutter.EVENT_STOP;
    }

    _onButtonPress(_overlay, event) {
        const button = event.get_button();
        if (button !== 1) {
            this._finish({error: 'cancelled'});
            return Clutter.EVENT_STOP;
        }
        const [x, y] = event.get_coords();
        this._setPoint(x, y);
        this._pickNow();
        return Clutter.EVENT_STOP;
    }

    _onKeyPress(_overlay, event) {
        const symbol = event.get_key_symbol();
        const shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const step = shift ? 10 : 1;
        let {x, y} = this._point;

        switch (symbol) {
        case Clutter.KEY_Escape:
            this._finish({error: 'cancelled'});
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_space:
            this._pickNow();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Left:
            x -= step;
            break;
        case Clutter.KEY_Right:
            x += step;
            break;
        case Clutter.KEY_Up:
            y -= step;
            break;
        case Clutter.KEY_Down:
            y += step;
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        this._setPoint(x, y);
        this._queueSample();
        return Clutter.EVENT_STOP;
    }

    _setPoint(x, y) {
        this._point = {
            x: Math.max(0, Math.min(this._overlay.width - 1, Math.round(x))),
            y: Math.max(0, Math.min(this._overlay.height - 1, Math.round(y))),
        };
        this._drawing.queue_repaint();
        this._queueSample();
    }

    async _pickNow() {
        if (!this._point)
            return;
        if (this._sampleId) {
            GLib.source_remove(this._sampleId);
            this._sampleId = 0;
        }
        const {x, y} = this._point;
        let result;
        try {
            result = await this._sampler.sample(x, y);
        } catch (e) {
            console.error(`Manunggal: sampling failed (${e.message})`);
            result = {ok: false, reason: 'denied'};
        }
        if (!result.ok) {
            this._finish({error: result.reason});
            return;
        }
        this._finish({color: result.color});
    }

    // ------------------------------------------------------------------- close

    _finish(result) {
        if (this._finished)
            return;
        this._finished = true;

        if (this._sampleId) {
            GLib.source_remove(this._sampleId);
            this._sampleId = 0;
        }
        for (const id of this._signalIds) {
            try {
                this._overlay.disconnect(id);
            } catch {
                // The actor is going away anyway.
            }
        }
        this._signalIds = [];

        try {
            global.display.set_cursor(Meta.Cursor.DEFAULT);
        } catch {
            // Ignore.
        }
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch {
                // The grab may already have been released.
            }
            this._grab = null;
        }
        if (this._overlay) {
            this._overlay.destroy();
            this._overlay = null;
        }

        const resolve = this._resolve;
        this._resolve = null;
        if (resolve)
            resolve(result);
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later

import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {hsvToRgb, normalize, rgbToHsv} from '../../core/color.js';

const HUE_SEGMENTS = 180;
const RING_INNER = 0.74;
const SQUARE_RATIO = 0.92;

/**
 * Hue ring plus saturation/value square. Drawn with Cairo; the numeric fields
 * in the tab remain the authoritative keyboard-accessible input.
 */
export class ColorWheel {
    constructor(options = {}) {
        this._onChanged = options.onChanged;
        this._dragging = false;
        this._hsv = {h: 210, s: 0.8, v: 0.9, a: 1};

        this.actor = new St.DrawingArea({
            style_class: 'manunggal-color-wheel',
            reactive: true,
            can_focus: true,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        this.actor.set_accessible_name(
            'Colour wheel. Left and Right change hue, Up and Down change brightness, ' +
            'Shift+Up and Shift+Down change saturation.');

        this.actor.connect('repaint', () => this._draw());
        this.actor.connect('notify::width', () => this.actor.queue_repaint());
        this.actor.connect('notify::height', () => this.actor.queue_repaint());
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this._dragging = true;
            this.actor.grab_key_focus();
            this._applyPointer(event);
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-release-event', () => {
            this._dragging = false;
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('motion-event', (_actor, event) => {
            if (!this._dragging)
                return Clutter.EVENT_PROPAGATE;
            this._applyPointer(event);
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('key-press-event', (_actor, event) => this._onKeyPress(event));
    }

    setColor(color) {
        const normalized = normalize(color);
        const hsv = rgbToHsv(normalized);
        // Preserve hue when the colour is grey (rgbToHsv returns h = 0).
        if (normalized.r === normalized.g && normalized.g === normalized.b && this._hsv)
            hsv.h = this._hsv.h;
        this._hsv = hsv;
        this.actor.queue_repaint();
    }

    get color() {
        return normalize(hsvToRgb(this._hsv));
    }

    _geometry() {
        const width = this.actor.width || 1;
        const height = this.actor.height || 1;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.max(1, Math.min(width, height) / 2 - 2);
        const inner = radius * RING_INNER;
        const side = inner * Math.SQRT2 * SQUARE_RATIO;
        return {
            width,
            height,
            cx,
            cy,
            radius,
            inner,
            side,
            square: {
                x: cx - side / 2,
                y: cy - side / 2,
                w: side,
                h: side,
            },
        };
    }

    _draw() {
        const cr = this.actor.get_context();
        const geo = this._geometry();
        cr.setOperator(cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(cairo.Operator.OVER);

        // Hue ring.
        cr.setLineWidth(geo.radius - geo.inner);
        for (let i = 0; i < HUE_SEGMENTS; i++) {
            const start = (i / HUE_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
            const end = ((i + 1.2) / HUE_SEGMENTS) * Math.PI * 2 - Math.PI / 2;
            const rgb = hsvToRgb({h: (i / HUE_SEGMENTS) * 360, s: 1, v: 1});
            cr.setSourceRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255);
            cr.arc(geo.cx, geo.cy, (geo.radius + geo.inner) / 2, start, end);
            cr.stroke();
        }

        // Saturation/value square: white→hue horizontally, then black overlay.
        const hue = hsvToRgb({h: this._hsv.h, s: 1, v: 1});
        const sq = geo.square;
        const horizontal = new cairo.LinearGradient(sq.x, sq.y, sq.x + sq.w, sq.y);
        horizontal.addColorStopRGBA(0, 1, 1, 1, 1);
        horizontal.addColorStopRGBA(1, hue.r / 255, hue.g / 255, hue.b / 255, 1);
        cr.setSource(horizontal);
        cr.rectangle(sq.x, sq.y, sq.w, sq.h);
        cr.fill();
        const vertical = new cairo.LinearGradient(sq.x, sq.y, sq.x, sq.y + sq.h);
        vertical.addColorStopRGBA(0, 0, 0, 0, 0);
        vertical.addColorStopRGBA(1, 0, 0, 0, 1);
        cr.setSource(vertical);
        cr.rectangle(sq.x, sq.y, sq.w, sq.h);
        cr.fill();

        // Hue marker.
        const angle = (this._hsv.h / 360) * Math.PI * 2 - Math.PI / 2;
        const markerRadius = (geo.radius + geo.inner) / 2;
        const mx = geo.cx + Math.cos(angle) * markerRadius;
        const my = geo.cy + Math.sin(angle) * markerRadius;
        cr.setLineWidth(3);
        cr.setSourceRGBA(0, 0, 0, 0.55);
        cr.arc(mx, my, 7, 0, Math.PI * 2);
        cr.stroke();
        cr.setLineWidth(2);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.arc(mx, my, 7, 0, Math.PI * 2);
        cr.stroke();

        // Saturation/value marker.
        const sx = sq.x + this._hsv.s * sq.w;
        const sy = sq.y + (1 - this._hsv.v) * sq.h;
        cr.setLineWidth(3);
        cr.setSourceRGBA(0, 0, 0, 0.55);
        cr.arc(sx, sy, 6, 0, Math.PI * 2);
        cr.stroke();
        cr.setLineWidth(2);
        cr.setSourceRGBA(1, 1, 1, 0.95);
        cr.arc(sx, sy, 6, 0, Math.PI * 2);
        cr.stroke();
    }

    _applyPointer(event) {
        const [stageX, stageY] = event.get_coords();
        const [actorX, actorY] = this.actor.get_transformed_position();
        const x = stageX - actorX;
        const y = stageY - actorY;
        const geo = this._geometry();
        const dx = x - geo.cx;
        const dy = y - geo.cy;
        const distance = Math.hypot(dx, dy);

        if (distance >= geo.inner - 2) {
            let angle = Math.atan2(dy, dx) + Math.PI / 2;
            if (angle < 0)
                angle += Math.PI * 2;
            this._hsv.h = (angle / (Math.PI * 2)) * 360;
        } else {
            const sq = geo.square;
            this._hsv.s = Math.max(0, Math.min(1, (x - sq.x) / sq.w));
            this._hsv.v = Math.max(0, Math.min(1, 1 - (y - sq.y) / sq.h));
        }

        this.actor.queue_repaint();
        this._onChanged?.(this.color);
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        switch (symbol) {
        case Clutter.KEY_Left:
            this._hsv.h = (this._hsv.h - (shift ? 10 : 2) + 360) % 360;
            break;
        case Clutter.KEY_Right:
            this._hsv.h = (this._hsv.h + (shift ? 10 : 2)) % 360;
            break;
        case Clutter.KEY_Up:
            if (shift)
                this._hsv.s = Math.min(1, this._hsv.s + 0.02);
            else
                this._hsv.v = Math.min(1, this._hsv.v + 0.02);
            break;
        case Clutter.KEY_Down:
            if (shift)
                this._hsv.s = Math.max(0, this._hsv.s - 0.02);
            else
                this._hsv.v = Math.max(0, this._hsv.v - 0.02);
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        this.actor.queue_repaint();
        this._onChanged?.(this.color);
        return Clutter.EVENT_STOP;
    }

    destroy() {
        this.actor.destroy();
    }
}

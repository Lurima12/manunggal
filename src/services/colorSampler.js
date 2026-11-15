// SPDX-License-Identifier: GPL-2.0-or-later
//
// Single-pixel screen sampling through the Shell's own screenshot API. The
// extension never captures a full screenshot and never stores sampled pixels.
//
// Version note: GNOME 45/46 return ClutterColor (0..255 fields); GNOME 47+
// return CoglColor (0..1 getters). Both are normalised here.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

Gio._promisify(Shell.Screenshot.prototype, 'pick_color');

function byte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizePicked(color) {
    if (!color)
        return null;

    // CoglColor exposes get_red()/get_green()/... returning 0..1 floats.
    if (typeof color.get_red === 'function') {
        return {
            r: byte(color.get_red() * 255),
            g: byte(color.get_green() * 255),
            b: byte(color.get_blue() * 255),
            a: Number(color.get_alpha().toFixed(3)),
        };
    }

    // ClutterColor exposes 0..255 integer fields.
    return {
        r: byte(color.red ?? 0),
        g: byte(color.green ?? 0),
        b: byte(color.blue ?? 0),
        a: Number(Math.max(0, Math.min(1, color.alpha ?? 1)).toFixed(3)),
    };
}

export class ColorSampler {
    constructor() {
        this._screenshot = null;
        this._lastError = null;
    }

    get available() {
        return typeof Shell.Screenshot?.prototype?.pick_color === 'function';
    }

    get lastError() {
        return this._lastError;
    }

    destroy() {
        this._screenshot = null;
        this._lastError = null;
    }

    /**
     * Sample one stage pixel.
     * @param {number} x stage coordinate
     * @param {number} y stage coordinate
     * @returns {Promise<{ok: true, color: object}|{ok: false, reason: string}>}
     */
    async sample(x, y) {
        if (!this.available) {
            this._lastError = 'Screen sampling is not available in this GNOME Shell version.';
            return {ok: false, reason: 'unavailable'};
        }

        try {
            if (!this._screenshot)
                this._screenshot = new Shell.Screenshot();
            const [color] = await this._screenshot.pick_color(
                Math.round(x), Math.round(y));
            const normalized = normalizePicked(color);
            if (!normalized) {
                this._lastError = 'The compositor returned no colour.';
                return {ok: false, reason: 'no-colour'};
            }
            this._lastError = null;
            return {ok: true, color: normalized};
        } catch (e) {
            // Access can be denied by the compositor in remote/headless
            // sessions or by future permission changes.
            this._lastError = e.message || 'Screen sampling was denied.';
            return {ok: false, reason: 'denied'};
        }
    }
}

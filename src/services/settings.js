// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

/**
 * Small typed wrapper around GSettings that owns every signal connection.
 * Nothing in the extension should connect to GSettings directly.
 */
export class Settings {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._connections = [];
    }

    get raw() {
        return this._settings;
    }

    get(key) {
        return this._settings.get_value(key).recursiveUnpack();
    }

    getString(key) {
        return this._settings.get_string(key);
    }

    getBool(key) {
        return this._settings.get_boolean(key);
    }

    getInt(key) {
        return this._settings.get_int(key);
    }

    getStrv(key) {
        return this._settings.get_strv(key);
    }

    set(key, value) {
        const current = this._settings.get_value(key);
        const variant = new GLib.Variant(current.get_type_string(), value);
        if (current.equal(variant))
            return;
        this._settings.set_value(key, variant);
    }

    setString(key, value) {
        if (this._settings.get_string(key) !== value)
            this._settings.set_string(key, value);
    }

    setBool(key, value) {
        if (this._settings.get_boolean(key) !== value)
            this._settings.set_boolean(key, value);
    }

    setInt(key, value) {
        if (this._settings.get_int(key) !== value)
            this._settings.set_int(key, value);
    }

    setStrv(key, value) {
        const current = this._settings.get_strv(key);
        if (current.length === value.length && current.every((v, i) => v === value[i]))
            return;
        this._settings.set_strv(key, value);
    }

    /** @returns {number} handler id */
    connect(key, callback) {
        const id = this._settings.connect(`changed::${key}`, () => {
            try {
                callback(this.get(key), key);
            } catch (e) {
                console.error(`Manunggal: settings callback for ${key} failed: ${e.message}`);
            }
        });
        this._connections.push(id);
        return id;
    }

    connectAll(callback) {
        const id = this._settings.connect('changed', (_settings, key) => {
            try {
                callback(key);
            } catch (e) {
                console.error(`Manunggal: settings callback for ${key} failed: ${e.message}`);
            }
        });
        this._connections.push(id);
        return id;
    }

    disconnect(id) {
        const index = this._connections.indexOf(id);
        if (index >= 0) {
            this._connections.splice(index, 1);
            this._settings.disconnect(id);
        }
    }

    destroy() {
        for (const id of this._connections) {
            try {
                this._settings.disconnect(id);
            } catch {
                // Already disconnected with the GSettings object.
            }
        }
        this._connections = [];
        this._settings = null;
    }
}

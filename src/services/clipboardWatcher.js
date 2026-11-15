// SPDX-License-Identifier: GPL-2.0-or-later
//
// Clipboard capture. Watches Meta.Selection instead of polling St.Clipboard,
// so the extension only reads content when the owner actually changes.
// Nothing in this file logs clipboard content.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {MIME} from '../constants.js';

Gio._promisify(Meta.SelectionSource.prototype, 'read_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');

const READ_CHUNK = 64 * 1024;
const OWN_WRITE_TTL_MS = 4000;

function nowMs() {
    return GLib.get_real_time() / 1000;
}

function sha256Bytes(bytes) {
    return GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
}

function sha256Text(text) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, text, -1);
}

function textKey(text) {
    return `text:${sha256Text(text)}`;
}

function imageKey(bytes) {
    return `image:${sha256Bytes(bytes)}`;
}

function imageMimeFor(mimetype) {
    switch (mimetype) {
    case 'image/jpeg':
    case 'image/webp':
    case 'image/png':
        return mimetype;
    default:
        return 'image/png';
    }
}

/**
 * Best-effort image dimensions. Decoding failure is not fatal: the entry is
 * still saved and the UI falls back to a generic icon.
 */
function imageSize(bytes) {
    try {
        const stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(bytes));
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
        const size = {width: pixbuf.get_width(), height: pixbuf.get_height()};
        stream.close(null);
        return size;
    } catch {
        return {width: 0, height: 0};
    }
}

export class ClipboardWatcher {
    /**
     * @param {import('./settings.js').Settings} settings
     * @param {import('./historyStore.js').HistoryStore} store
     */
    constructor(settings, store) {
        this._settings = settings;
        this._store = store;
        this._selection = null;
        this._clipboard = null;
        this._selectionId = 0;
        this._ownKey = null;
        this._ownKeyExpires = 0;
        this._destroyed = false;
    }

    get running() {
        return this._selectionId !== 0;
    }

    start() {
        if (this._destroyed || this._selectionId)
            return;
        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._selectionId = this._selection.connect(
            'owner-changed', this._onOwnerChanged.bind(this));
    }

    stop() {
        if (this._selection && this._selectionId) {
            try {
                this._selection.disconnect(this._selectionId);
            } catch {
                // Already gone with the display.
            }
        }
        this._selectionId = 0;
        this._selection = null;
        this._ownKey = null;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this.stop();
        this._clipboard = null;
        this._store = null;
        this._settings = null;
    }

    // ------------------------------------------------------------- own writes

    _rememberOwnWrite(key) {
        this._ownKey = key;
        this._ownKeyExpires = nowMs() + OWN_WRITE_TTL_MS;
    }

    _consumeOwnWrite(key) {
        if (!this._ownKey || !key)
            return false;
        const fresh = nowMs() <= this._ownKeyExpires;
        const matches = this._ownKey === key;
        this._ownKey = null;
        return fresh && matches;
    }

    _clipboard() {
        if (!this._clipboard)
            this._clipboard = St.Clipboard.get_default();
        return this._clipboard;
    }

    /**
     * Copy plain text. Marks the write so the watcher does not echo it back
     * into history.
     */
    copyText(text, {primary = false} = {}) {
        if (typeof text !== 'string' || !text)
            return false;
        this._rememberOwnWrite(textKey(text));
        try {
            const clipboard = this._clipboard();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
            if (primary || (this._settings && this._settings.getBool('sync-primary')))
                clipboard.set_text(St.ClipboardType.PRIMARY, text);
            return true;
        } catch (e) {
            console.error(`Manunggal: could not copy text (${e.message})`);
            return false;
        }
    }

    /**
     * Copy a stored entry back to the clipboard.
     * @returns {Promise<boolean>}
     */
    async copyEntry(entry) {
        if (!entry || !this._store)
            return false;
        if (entry.kind === 'text')
            return this.copyText(entry.text);

        if (entry.kind !== 'image')
            return false;

        try {
            const bytes = await this._store.imageBytes(entry);
            if (!bytes)
                return false;
            this._rememberOwnWrite(imageKey(bytes));
            this._clipboard().set_content(
                St.ClipboardType.CLIPBOARD,
                imageMimeFor(entry.mimetype),
                bytes);
            return true;
        } catch (e) {
            console.error(`Manunggal: could not copy image (${e.message})`);
            return false;
        }
    }

    // --------------------------------------------------------------- capturing

    async _onOwnerChanged(_selection, selectionType, selectionSource) {
        if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;
        if (!selectionSource)
            return;
        if (!this._shouldCapture())
            return;

        try {
            const mimetypes = Array.from(selectionSource.get_mimetypes?.() ?? []);
            if (!mimetypes.length)
                return;

            const sensitive = mimetypes.some(mimetype =>
                String(mimetype).toLowerCase().startsWith(MIME.sensitiveHint));
            if (sensitive && this._settings.getBool('ignore-password-manager'))
                return;
            if (this._isExcludedApp())
                return;

            const imageMime = this._settings.getBool('capture-images')
                ? MIME.image.find(mimetype => mimetypes.includes(mimetype))
                : null;

            if (imageMime) {
                if (await this._captureImage(selectionSource, imageMime, sensitive))
                    return;
                // Fall through to text when the image could not be read.
            }

            const textMime = MIME.text.find(mimetype => mimetypes.includes(mimetype));
            if (textMime)
                await this._captureText(selectionSource, textMime, sensitive);
        } catch (e) {
            // Never include clipboard content in the message.
            console.error(`Manunggal: clipboard read failed (${e.message})`);
        }
    }

    _shouldCapture() {
        if (!this._settings || !this._store)
            return false;
        if (!this._settings.getBool('clipboard-enabled'))
            return false;
        if (this._settings.getBool('private-mode'))
            return false;
        return true;
    }

    _isExcludedApp() {
        const exclusions = this._settings.getStrv('excluded-apps');
        if (!exclusions.length)
            return false;
        const window = global.display.focus_window;
        if (!window)
            return false;

        const names = new Set();
        for (const value of [
            window.get_wm_class?.(),
            window.get_wm_class_instance?.(),
            window.get_gtk_application_id?.(),
        ]) {
            if (value)
                names.add(String(value).toLowerCase());
        }
        return exclusions.some(value => names.has(String(value).trim().toLowerCase()));
    }

    async _captureText(source, mimetype, sensitive) {
        const max = this._settings.getInt('max-text-bytes');
        const bytes = await this._readBytes(source, mimetype, max);
        if (!bytes)
            return false;

        let text;
        try {
            text = new TextDecoder('utf-8').decode(bytes);
        } catch {
            return false;
        }
        if (!text.trim())
            return false;

        if (this._consumeOwnWrite(textKey(text)))
            return false;

        this._store.addText(text, {sensitive});
        return true;
    }

    async _captureImage(source, mimetype, sensitive) {
        const max = this._settings.getInt('max-image-bytes');
        const bytes = await this._readBytes(source, mimetype, max);
        if (!bytes || !bytes.byteLength)
            return false;

        if (this._consumeOwnWrite(imageKey(bytes)))
            return false;

        const {width, height} = imageSize(bytes);
        await this._store.addImage(
            {bytes, mimetype: imageMimeFor(mimetype), width, height},
            {sensitive});
        return true;
    }

    /**
     * Read a selection stream with a hard byte cap. Returns a Uint8Array, or
     * null when the stream is empty, unreadable or over the cap.
     */
    async _readBytes(source, mimetype, maxBytes) {
        let stream = null;
        try {
            stream = await source.read_async(mimetype, null);
            if (!stream)
                return null;

            const chunks = [];
            let total = 0;
            for (;;) {
                const chunk = await stream.read_bytes_async(
                    READ_CHUNK, GLib.PRIORITY_DEFAULT, null);
                const size = chunk.get_size();
                if (size === 0)
                    break;
                total += size;
                if (total > maxBytes)
                    return null;
                chunks.push(chunk.toArray());
            }
            if (!total)
                return null;

            const bytes = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return bytes;
        } catch {
            return null;
        } finally {
            if (stream) {
                try {
                    stream.close(null);
                } catch {
                    // The owner may already have closed it.
                }
            }
        }
    }
}

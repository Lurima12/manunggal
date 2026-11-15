// SPDX-License-Identifier: GPL-2.0-or-later
//
// Clipboard history persistence. Text lives in one JSON document; images live
// as individual files named by checksum. All files are private (0600), and the
// store never logs clipboard content.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {UUID, LIMITS, CATEGORY_IDS} from '../constants.js';
import {detectCategory} from '../core/classify.js';
import {parseColor, toHex} from '../core/color.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');

const DATA_VERSION = 1;
const SAVE_DELAY_MS = 1500;
const ORPHAN_CLEANUP_MS = 30000;
const THUMB_SIZE = 256;

function nowMs() {
    return GLib.get_real_time() / 1000;
}

function byteLength(text) {
    try {
        return new TextEncoder().encode(text).byteLength;
    } catch {
        return text.length * 2;
    }
}

function extensionFor(mimetype) {
    switch (mimetype) {
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    default: return 'png';
    }
}

function validCategory(value) {
    return CATEGORY_IDS.includes(value) ? value : 'text';
}

function validTimestamp(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export class HistoryStore {
    constructor(settings) {
        this._settings = settings;
        this._entries = [];
        this._nextId = 1;
        this._listeners = new Set();
        this._saveId = 0;
        this._orphanId = 0;
        this._saving = false;
        this._dirty = false;
        this._loaded = false;
        this._destroyed = false;

        this._dataDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_data_dir(), UUID]));
        this._imagesDir = this._dataDir.get_child('images');
        this._cacheDir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_cache_dir(), UUID, 'thumbs']));
        this._historyFile = this._dataDir.get_child('history.json');

        this._totalImageBytes = 0;
    }

    get entries() {
        return this._entries;
    }

    get loaded() {
        return this._loaded;
    }

    get historyPath() {
        return this._historyFile.get_path();
    }

    get imagesPath() {
        return this._imagesDir.get_path();
    }

    connect(callback) {
        this._listeners.add(callback);
        return callback;
    }

    disconnect(callback) {
        this._listeners.delete(callback);
    }

    async init() {
        await this._ensureDirs();
        if (this._destroyed)
            return;
        if (this._settings.getBool('persist-history')) {
            await this._load();
        } else {
            // Never leave old content behind when persistence is off.
            this.forgetSaved();
            this.discardFiles();
        }
        if (this._destroyed)
            return;
        this._purgeExpired(false);
        this._trim(false);
        this._loaded = true;
        this._emit('init');
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this.flush();
        this._listeners.clear();
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
        }
        if (this._orphanId) {
            GLib.source_remove(this._orphanId);
            this._orphanId = 0;
        }
    }

    // ---------------------------------------------------------------- capture

    /**
     * Add or touch a text entry.
     * @param {string} text
     * @param {{category?: string, categoryOverride?: string|null, timestamp?: number}} [options]
     * @returns {object|null}
     */
    addText(text, options = {}) {
        if (typeof text !== 'string' || !text.trim())
            return null;
        if (byteLength(text) > this._settings.getInt('max-text-bytes'))
            return null;

        const existing = this._entries.find(entry =>
            entry.kind === 'text' && entry.text === text);
        if (existing) {
            existing.lastUsedAt = options.timestamp ?? nowMs();
            // A re-copy of a sensitive value stays sensitive even if the new
            // owner did not advertise the password-manager hint.
            existing.sensitive = existing.sensitive || Boolean(options.sensitive);
            this._promote(existing);
            this._emit('touch');
            this._scheduleSave();
            return existing;
        }

        let category = options.category;
        if (!category) {
            category = this._settings.getBool('detect-categories')
                ? detectCategory(text).category
                : 'text';
        }

        const timestamp = options.timestamp ?? nowMs();
        const entry = {
            id: this._nextId++,
            kind: 'text',
            text,
            category: validCategory(category),
            categoryOverride: options.categoryOverride ?? null,
            pinned: false,
            sensitive: Boolean(options.sensitive),
            accent: null,
            createdAt: timestamp,
            lastUsedAt: timestamp,
        };
        this._entries.unshift(entry);
        this._trim();
        this._emit('add');
        this._scheduleSave();
        return entry;
    }

    /**
     * Add or touch an image entry.
     * @param {{bytes: Uint8Array, mimetype: string, width: number, height: number}} image
     * @returns {Promise<object|null>}
     */
    async addImage({bytes, mimetype, width, height}, options = {}) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
            return null;
        if (bytes.byteLength > this._settings.getInt('max-image-bytes'))
            return null;

        const checksum = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes);
        if (!checksum)
            return null;
        const filename = `${checksum}.${extensionFor(mimetype)}`;

        const existing = this._entries.find(entry =>
            entry.kind === 'image' && entry.image === filename);
        if (existing) {
            existing.lastUsedAt = nowMs();
            existing.sensitive = existing.sensitive || Boolean(options.sensitive);
            this._promote(existing);
            this._emit('touch');
            this._scheduleSave();
            return existing;
        }

        try {
            await this._writeImage(filename, bytes);
        } catch (e) {
            console.error(`Manunggal: could not store image (${e.message})`);
            return null;
        }

        const timestamp = nowMs();
        const entry = {
            id: this._nextId++,
            kind: 'image',
            image: filename,
            mimetype,
            width: Math.max(0, Math.round(width || 0)),
            height: Math.max(0, Math.round(height || 0)),
            bytes: bytes.byteLength,
            category: 'image',
            categoryOverride: null,
            pinned: false,
            sensitive: Boolean(options.sensitive),
            accent: null,
            createdAt: timestamp,
            lastUsedAt: timestamp,
        };
        this._entries.unshift(entry);
        this._totalImageBytes += entry.bytes;
        this._trimImageBytes(entry.id);
        this._trim();
        this._emit('add');
        this._scheduleSave();
        return entry;
    }

    // ------------------------------------------------------------------ edits

    touch(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry)
            return;
        entry.lastUsedAt = nowMs();
        this._promote(entry);
        this._emit('touch');
        this._scheduleSave();
    }

    /** Move an entry to the front of the list (most recently used first). */
    _promote(entry) {
        const index = this._entries.indexOf(entry);
        if (index > 0) {
            this._entries.splice(index, 1);
            this._entries.unshift(entry);
        }
    }

    togglePin(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry)
            return null;
        entry.pinned = !entry.pinned;
        this._emit('update');
        this._scheduleSave();
        return entry;
    }

    setAccent(id, color) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry)
            return;
        if (!color) {
            entry.accent = null;
        } else {
            const parsed = parseColor(color);
            if (!parsed)
                return;
            entry.accent = toHex(parsed, {includeAlpha: false});
        }
        this._emit('update');
        this._scheduleSave();
    }

    setSensitive(id, sensitive) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry)
            return;
        entry.sensitive = Boolean(sensitive);
        this._emit('update');
        // Saving removes it from disk when sensitive-persist is off.
        this._scheduleSave();
    }

    setCategory(id, category) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry || !CATEGORY_IDS.includes(category))
            return;
        entry.categoryOverride = category === entry.category ? null : category;
        this._emit('update');
        this._scheduleSave();
    }

    updateText(id, text) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry || entry.kind !== 'text' || !text.trim())
            return false;
        if (byteLength(text) > this._settings.getInt('max-text-bytes'))
            return false;

        const duplicate = this._entries.find(other =>
            other.id !== id && other.kind === 'text' && other.text === text);
        if (duplicate) {
            // The edited text already exists: keep one entry, drop this one.
            this._removeEntry(entry, false);
            duplicate.lastUsedAt = nowMs();
            this._emit('update');
            this._scheduleSave();
            return true;
        }

        entry.text = text;
        entry.lastUsedAt = nowMs();
        if (!entry.categoryOverride && this._settings.getBool('detect-categories'))
            entry.category = detectCategory(text).category;
        this._emit('update');
        this._scheduleSave();
        return true;
    }

    remove(id) {
        const index = this._entries.findIndex(e => e.id === id);
        if (index < 0)
            return null;
        const [entry] = this._entries.splice(index, 1);
        if (entry.kind === 'image')
            this._totalImageBytes = Math.max(0, this._totalImageBytes - entry.bytes);
        this._emit('remove');
        this._scheduleSave();
        this._scheduleOrphanCleanup();
        return entry;
    }

    restore(entry) {
        if (!entry || this._entries.some(e => e.id === entry.id))
            return false;
        this._entries.unshift(entry);
        if (entry.kind === 'image')
            this._totalImageBytes += entry.bytes;
        this._trim();
        this._emit('add');
        this._scheduleSave();
        return true;
    }

    clear({keepPinned = false} = {}) {
        if (!this._entries.length)
            return;
        const removed = this._entries.filter(e => !(keepPinned && e.pinned));
        if (!removed.length)
            return;
        this._entries = this._entries.filter(e => keepPinned && e.pinned);
        this._recountImages();
        this._emit('clear');
        this._scheduleSave();
        this._scheduleOrphanCleanup(true);
    }

    // ------------------------------------------------------------------ prune

    _purgeExpired(emit = true) {
        const days = this._settings.getInt('retention-days');
        if (days <= 0)
            return false;
        const cutoff = nowMs() - days * 24 * 60 * 60 * 1000;
        const before = this._entries.length;
        this._entries = this._entries.filter(entry => entry.pinned || entry.lastUsedAt >= cutoff);
        const changed = this._entries.length !== before;
        if (changed) {
            this._recountImages();
            if (emit) {
                this._emit('trim');
                this._scheduleSave();
            }
        }
        return changed;
    }

    _trim(emit = true) {
        const changed = this._purgeExpired(emit) || this._trimCount() || this._trimImageBytes();
        if (changed && emit) {
            this._emit('trim');
            this._scheduleSave();
        }
        return changed;
    }

    _trimCount() {
        const max = Math.max(10, this._settings.getInt('max-items'));
        if (this._entries.length <= max)
            return false;
        const pinned = this._entries.filter(e => e.pinned);
        const unpinned = this._entries.filter(e => !e.pinned)
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        const keepUnpinned = unpinned.slice(0, Math.max(0, max - pinned.length));
        const keep = new Set([...pinned, ...keepUnpinned].map(e => e.id));
        const before = this._entries.length;
        this._entries = this._entries.filter(e => keep.has(e.id));
        const changed = before !== this._entries.length;
        if (changed)
            this._recountImages();
        return changed;
    }

    _trimImageBytes(keepId = null) {
        const max = Math.min(
            this._settings.getInt('max-image-bytes') * 4, LIMITS.totalImageBytes);
        if (this._totalImageBytes <= max)
            return false;
        const images = this._entries
            .filter(e => e.kind === 'image' && !e.pinned && e.id !== keepId)
            .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
        let changed = false;
        for (const entry of images) {
            if (this._totalImageBytes <= max)
                break;
            this._removeEntry(entry, false);
            changed = true;
        }
        this._recountImages();
        return changed;
    }

    _removeEntry(entry, emit = true) {
        const index = this._entries.indexOf(entry);
        if (index < 0)
            return;
        this._entries.splice(index, 1);
        if (entry.kind === 'image')
            this._totalImageBytes = Math.max(0, this._totalImageBytes - entry.bytes);
        if (emit) {
            this._emit('remove');
            this._scheduleSave();
        }
    }

    _recountImages() {
        this._totalImageBytes = this._entries
            .filter(e => e.kind === 'image')
            .reduce((sum, e) => sum + (e.bytes || 0), 0);
    }

    // ---------------------------------------------------------------- loading

    async _ensureDirs() {
        for (const dir of [this._dataDir, this._imagesDir, this._cacheDir]) {
            try {
                if (!dir.query_exists(null))
                    dir.make_directory_with_parents(null);
                dir.set_attribute_uint32('unix::mode', 0o700,
                    Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                console.error(`Manunggal: could not prepare storage directory (${e.message})`);
            }
        }
    }

    async _load() {
        if (!this._historyFile.query_exists(null))
            return;
        try {
            const [contents] = await this._historyFile.load_contents_async(null);
            const document = JSON.parse(new TextDecoder().decode(contents));
            if (!document || document.version !== DATA_VERSION)
                throw new Error('unsupported history version');

            const rawEntries = Array.isArray(document.entries) ? document.entries : [];
            let maxId = 0;
            for (const raw of rawEntries) {
                const entry = this._sanitizeEntry(raw);
                if (!entry)
                    continue;
                this._entries.push(entry);
                maxId = Math.max(maxId, entry.id);
            }
            this._nextId = Math.max(maxId + 1, Number(document.nextId) || 1);
            this._recountImages();
        } catch (e) {
            this._quarantineCorruptHistory();
            console.error(`Manunggal: history could not be read (${e.message}); starting empty`);
            this._entries = [];
        }
    }

    _sanitizeEntry(raw) {
        if (!raw || typeof raw !== 'object')
            return null;
        const id = Number(raw.id);
        if (!Number.isInteger(id) || id <= 0)
            return null;
        const createdAt = validTimestamp(raw.createdAt, nowMs());
        const lastUsedAt = validTimestamp(raw.lastUsedAt, createdAt);
        if (raw.sensitive && !this._settings.getBool('sensitive-persist'))
            return null;

        if (raw.kind === 'text') {
            if (typeof raw.text !== 'string' || !raw.text.trim())
                return null;
            return {
                id,
                kind: 'text',
                text: raw.text,
                category: validCategory(raw.category),
                categoryOverride: raw.categoryOverride ? validCategory(raw.categoryOverride) : null,
                pinned: Boolean(raw.pinned),
                sensitive: Boolean(raw.sensitive),
                accent: typeof raw.accent === 'string' ? raw.accent : null,
                createdAt,
                lastUsedAt,
            };
        }

        if (raw.kind === 'image') {
            if (typeof raw.image !== 'string' || !/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(raw.image))
                return null;
            const file = this._imagesDir.get_child(raw.image);
            if (!file.query_exists(null))
                return null;
            return {
                id,
                kind: 'image',
                image: raw.image,
                mimetype: ['image/png', 'image/jpeg', 'image/webp'].includes(raw.mimetype)
                    ? raw.mimetype : 'image/png',
                width: Math.max(0, Number(raw.width) || 0),
                height: Math.max(0, Number(raw.height) || 0),
                bytes: Math.max(0, Number(raw.bytes) || 0),
                category: 'image',
                categoryOverride: null,
                pinned: Boolean(raw.pinned),
                sensitive: Boolean(raw.sensitive),
                accent: typeof raw.accent === 'string' ? raw.accent : null,
                createdAt,
                lastUsedAt,
            };
        }

        return null;
    }

    _quarantineCorruptHistory() {
        try {
            if (!this._historyFile.query_exists(null))
                return;
            const suffix = Math.floor(nowMs());
            const target = this._dataDir.get_child(`history.corrupt-${suffix}.json`);
            this._historyFile.move(target, Gio.FileCopyFlags.OVERWRITE, null, null);
        } catch {
            // Keep the original file; the user can still inspect it.
        }
    }

    // ----------------------------------------------------------------- saving

    _serializableEntries() {
        const keepSensitive = this._settings.getBool('sensitive-persist');
        return this._entries
            .filter(entry => keepSensitive || !entry.sensitive)
            .map(entry => {
                if (entry.kind === 'text') {
                    return {
                        id: entry.id,
                        kind: 'text',
                        text: entry.text,
                        category: entry.category,
                        categoryOverride: entry.categoryOverride,
                        pinned: entry.pinned,
                        sensitive: entry.sensitive,
                        accent: entry.accent,
                        createdAt: entry.createdAt,
                        lastUsedAt: entry.lastUsedAt,
                    };
                }
                return {
                    id: entry.id,
                    kind: 'image',
                    image: entry.image,
                    mimetype: entry.mimetype,
                    width: entry.width,
                    height: entry.height,
                    bytes: entry.bytes,
                    category: 'image',
                    categoryOverride: null,
                    pinned: entry.pinned,
                    sensitive: entry.sensitive,
                    accent: entry.accent,
                    createdAt: entry.createdAt,
                    lastUsedAt: entry.lastUsedAt,
                };
            });
    }

    _scheduleSave() {
        if (this._destroyed || !this._loaded || !this._settings.getBool('persist-history'))
            return;
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveId = 0;
            this._writeNow().catch(e => {
                console.error(`Manunggal: history save failed (${e.message})`);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    async _writeNow() {
        if (this._saving) {
            this._dirty = true;
            return;
        }
        this._saving = true;
        try {
            const document = {
                version: DATA_VERSION,
                nextId: this._nextId,
                entries: this._serializableEntries(),
            };
            const data = new TextEncoder().encode(JSON.stringify(document));
            await this._historyFile.replace_contents_async(
                data, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                null);
        } finally {
            this._saving = false;
            if (this._dirty) {
                this._dirty = false;
                this._scheduleSave();
            }
        }
    }

    /** Synchronous last-chance save used from disable(). */
    flush() {
        if (!this._settings || !this._loaded || !this._settings.getBool('persist-history'))
            return;
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
        }
        try {
            const document = {
                version: DATA_VERSION,
                nextId: this._nextId,
                entries: this._serializableEntries(),
            };
            const data = new TextEncoder().encode(JSON.stringify(document));
            this._historyFile.replace_contents(
                data, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
                null);
        } catch (e) {
            console.error(`Manunggal: final history save failed (${e.message})`);
        }
    }

    // ----------------------------------------------------------------- images

    async _writeImage(filename, bytes) {
        const file = this._imagesDir.get_child(filename);
        if (file.query_exists(null))
            return;
        await file.replace_contents_async(
            bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
            null);
    }

    async imageBytes(entry) {
        if (entry?.kind !== 'image' || !entry.image)
            return null;
        const file = this._imagesDir.get_child(entry.image);
        if (!file.query_exists(null))
            return null;
        const [contents] = await file.load_contents_async(null);
        return contents;
    }

    /**
     * Returns a cached 256px PNG for an image entry, or null when it cannot be
     * decoded. Never throws: the UI falls back to a generic icon.
     */
    previewFile(entry) {
        if (entry?.kind !== 'image' || !entry.image)
            return null;
        const source = this._imagesDir.get_child(entry.image);
        if (!source.query_exists(null))
            return null;
        const thumbName = `${entry.image.replace(/\.(png|jpg|webp)$/, '')}-${THUMB_SIZE}.png`;
        const thumb = this._cacheDir.get_child(thumbName);
        if (thumb.query_exists(null))
            return thumb;

        try {
            if (!this._cacheDir.query_exists(null))
                this._cacheDir.make_directory_with_parents(null);
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                source.get_path(), THUMB_SIZE, THUMB_SIZE, true);
            if (!pixbuf)
                return null;
            const ok = pixbuf.savev(thumb.get_path(), 'png', [], []);
            return ok ? thumb : null;
        } catch {
            return null;
        }
    }

    imageDimensions(entry) {
        if (entry?.kind !== 'image' || !entry.image)
            return null;
        try {
            const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(
                this._imagesDir.get_child(entry.image).get_path());
            return width > 0 ? {width, height} : null;
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------- cleanup

    _scheduleOrphanCleanup(immediate = false) {
        if (this._orphanId) {
            GLib.source_remove(this._orphanId);
            this._orphanId = 0;
        }
        const run = () => {
            this._orphanId = 0;
            this._removeOrphanFiles();
            return GLib.SOURCE_REMOVE;
        };
        if (immediate)
            this._orphanId = GLib.timeout_add(GLib.PRIORITY_LOW, 50, run);
        else
            this._orphanId = GLib.timeout_add(GLib.PRIORITY_LOW, ORPHAN_CLEANUP_MS, run);
    }

    _removeOrphanFiles() {
        const referenced = new Set(this._entries
            .filter(e => e.kind === 'image' && e.image)
            .map(e => e.image));
        const referencedThumbs = new Set([...referenced]
            .map(name => `${name.replace(/\.(png|jpg|webp)$/, '')}-${THUMB_SIZE}.png`));
        this._deleteUnreferenced(this._imagesDir, referenced);
        this._deleteUnreferenced(this._cacheDir, referencedThumbs);
    }

    _deleteUnreferenced(dir, referenced) {
        try {
            if (!dir.query_exists(null))
                return;
            const enumerator = dir.enumerate_children(
                'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (info.get_file_type() !== Gio.FileType.REGULAR)
                    continue;
                if (referenced && referenced.has(name))
                    continue;
                try {
                    dir.get_child(name).delete(null);
                } catch {
                    // A file may be in use; try again next time.
                }
            }
            enumerator.close(null);
        } catch {
            // Cleanup is best-effort.
        }
    }

    /** Remove all images and thumbnails immediately (used by clear). */
    async purgeFiles() {
        this._removeOrphanFiles();
    }

    /** Delete every stored image and thumbnail, referenced or not. */
    discardFiles() {
        this._deleteUnreferenced(this._imagesDir, new Set());
        this._deleteUnreferenced(this._cacheDir, new Set());
    }

    /** Delete the saved JSON without touching the in-memory list. */
    forgetSaved() {
        try {
            if (this._historyFile.query_exists(null))
                this._historyFile.delete(null);
        } catch (e) {
            console.error(`Manunggal: could not delete saved history (${e.message})`);
        }
    }

    /** Called when "persist history" changes. */
    setPersistence(enabled) {
        if (!this._loaded)
            return;
        if (enabled) {
            this._scheduleSave();
        } else {
            if (this._saveId) {
                GLib.source_remove(this._saveId);
                this._saveId = 0;
            }
            this.forgetSaved();
        }
    }

    _emit(reason) {
        for (const listener of [...this._listeners]) {
            try {
                listener(reason, this);
            } catch (e) {
                console.error(`Manunggal: history listener failed (${e.message})`);
            }
        }
    }
}

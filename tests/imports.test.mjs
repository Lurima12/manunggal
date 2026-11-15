// SPDX-License-Identifier: GPL-2.0-or-later

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PREFS_RESOURCE =
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
const BROKEN_PREFS_RESOURCE =
    'resource:///org/gnome/shell/extensions/prefs.js';

async function jsFiles(dir) {
    const entries = await readdir(dir, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            files.push(...await jsFiles(full));
        else if (entry.name.endsWith('.js'))
            files.push(full);
    }
    return files;
}

test('prefs.js imports ExtensionPreferences from the Extensions gresource', async () => {
    const source = await readFile(path.join(ROOT, 'prefs.js'), 'utf8');
    assert.ok(source.includes(PREFS_RESOURCE),
        `prefs.js must import from ${PREFS_RESOURCE}`);
});

test('no module uses the non-existent lowercase prefs resource', async () => {
    const files = [
        path.join(ROOT, 'extension.js'),
        path.join(ROOT, 'prefs.js'),
        ...await jsFiles(path.join(ROOT, 'src')),
    ];
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        assert.ok(!source.includes(BROKEN_PREFS_RESOURCE),
            `${path.relative(ROOT, file)} imports the non-existent ${BROKEN_PREFS_RESOURCE}`);
    }
});

test('every resource:// import is a known Shell module', async () => {
    const files = [
        path.join(ROOT, 'extension.js'),
        path.join(ROOT, 'prefs.js'),
        ...await jsFiles(path.join(ROOT, 'src')),
    ];
    for (const file of files) {
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(/resource:\/\/\/[^'"\s]+/gu)) {
            const specifier = match[0];
            const known = specifier === PREFS_RESOURCE ||
                specifier.startsWith('resource:///org/gnome/shell/');
            assert.ok(known,
                `${path.relative(ROOT, file)} imports unexpected ${specifier}`);
        }
    }
});

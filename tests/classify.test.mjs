import test from 'node:test';
import assert from 'node:assert/strict';

import {detectCategory, isEmojiOnly, looksLikeCode, effectiveCategory} from '../src/core/classify.js';

test('colours are detected only as complete literals', () => {
    assert.equal(detectCategory('#3584e4').category, 'color');
    assert.equal(detectCategory('  rgb(53, 132, 228) ').category, 'color');
    assert.equal(detectCategory('rgba(53, 132, 228, 0.5)').category, 'color');
    assert.equal(detectCategory('my colour is #3584e4').category, 'text');
    assert.equal(detectCategory('red').category, 'text');
});

test('emoji-only strings', () => {
    for (const value of ['😀', '👨‍👩‍👧', '🇮🇩', '❤️', '1️⃣', '#️⃣', '😀🎉', '👍🏽'])
        assert.equal(isEmojiOnly(value), true, value);

    for (const value of ['😀 ok', 'A', 'hello 👋', '', '   ', '1', '#', '♥ text'])
        assert.equal(isEmojiOnly(value), false, JSON.stringify(value));

    assert.equal(detectCategory('😀').category, 'emoji');
    assert.equal(detectCategory('hello 👋').category, 'text');
});

test('single words are never code', () => {
    assert.equal(detectCategory('function').category, 'text');
    assert.equal(detectCategory('const').category, 'text');
    assert.equal(detectCategory('hello world').category, 'text');
});

test('prose with a keyword stays text', () => {
    const prose = 'If you want to return the book, just let me know.';
    assert.equal(detectCategory(prose).category, 'text');
});

test('json is code', () => {
    assert.equal(detectCategory('{"a": 1, "b": [2, 3]}').category, 'code');
});

test('javascript and python snippets are code', () => {
    const js = 'const add = (a, b) => {\n  return a + b;\n};';
    assert.equal(detectCategory(js).category, 'code');

    const py = 'def greet(name):\n    print(f"hello {name}")\n';
    assert.equal(detectCategory(py).category, 'code');
});

test('shell commands are code but URLs are not', () => {
    assert.equal(detectCategory('#!/bin/bash\nsudo apt update').category, 'code');
    assert.equal(detectCategory('https://example.com/a?b=c').category, 'text');
});

test('markup is code', () => {
    assert.equal(detectCategory('<a href="https://example.com">link</a>').category, 'code');
});

test('confidence is bounded and manual overrides win', () => {
    const r = looksLikeCode('const x = 1;\nconst y = 2;');
    assert.ok(r.confidence > 0 && r.confidence <= 1);
    assert.equal(effectiveCategory({category: 'code', categoryOverride: 'text'}), 'text');
    assert.equal(effectiveCategory({category: 'code'}), 'code');
    assert.equal(effectiveCategory(null), 'text');
});

test('very long emoji runs are not classified as a single emoji', () => {
    assert.equal(isEmojiOnly('😀'.repeat(13)), false);
});

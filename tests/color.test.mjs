import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseColor, toHex, toRgb, toRgba, toHsl, rgbToHsv, hsvToRgb,
    normalize, equalColor, readableTextColor, isColorLiteral,
} from '../src/core/color.js';

const close = (a, b, eps = 0.6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('hex parsing: 3, 4, 6 and 8 digits', () => {
    let c = parseColor('#f00');
    assert.deepEqual(normalize(c), {r: 255, g: 0, b: 0, a: 1});

    c = parseColor('#f008');
    assert.deepEqual(normalize(c), {r: 255, g: 0, b: 0, a: 0.533});

    c = parseColor('#3584e4');
    assert.deepEqual(normalize(c), {r: 53, g: 132, b: 228, a: 1});

    c = parseColor('#3584e480');
    assert.deepEqual(normalize(c), {r: 53, g: 132, b: 228, a: 0.502});
});

test('rgb and rgba: commas, spaces, slash, percentages', () => {
    assert.deepEqual(normalize(parseColor('rgb(255, 0, 0)')), {r: 255, g: 0, b: 0, a: 1});
    assert.deepEqual(normalize(parseColor('rgba(12, 34, 56, 0.5)')), {r: 12, g: 34, b: 56, a: 0.5});
    assert.deepEqual(normalize(parseColor('rgb(12 34 56 / 50%)')), {r: 12, g: 34, b: 56, a: 0.5});
    assert.deepEqual(normalize(parseColor('rgb(100%, 0%, 50%)')), {r: 255, g: 0, b: 128, a: 1});
});

test('hsl parsing', () => {
    let c = parseColor('hsl(0, 100%, 50%)');
    assert.deepEqual(normalize(c), {r: 255, g: 0, b: 0, a: 1});

    c = parseColor('hsla(120 100% 25% / 0.25)');
    assert.deepEqual(normalize(c), {r: 0, g: 128, b: 0, a: 0.25});

    c = parseColor('hsl(210deg, 50%, 40%)');
    assert.ok(c && c.b > c.g && c.g > c.r);
});

test('invalid or partial strings are rejected', () => {
    for (const value of ['', 'red', '#12', '#12345', 'rgb(1,2)', 'rgb(a,b,c)',
        'rgb(0,0,0) trailing', 'hsl(0, 0)', '12', '##fff', null, 42]) {
        assert.equal(parseColor(value), null, `should reject ${JSON.stringify(value)}`);
        assert.equal(isColorLiteral(value), false);
    }
});

test('clamping', () => {
    assert.deepEqual(normalize(parseColor('rgb(300, -20, 128, 4)')), {r: 255, g: 0, b: 128, a: 1});
});

test('formatting hex, rgb and rgba', () => {
    const c = parseColor('#3584e4');
    assert.equal(toHex(c), '#3584E4');
    assert.equal(toHex(c, {uppercase: false}), '#3584e4');
    assert.equal(toRgb(c), 'rgb(53, 132, 228)');
    assert.equal(toRgba(c), 'rgba(53, 132, 228, 1)');

    const alpha = parseColor('rgba(1, 2, 3, 0.25)');
    assert.equal(toHex(alpha), '#01020340');
    assert.equal(toRgba(alpha), 'rgba(1, 2, 3, 0.25)');
    assert.equal(toHex(alpha, {includeAlpha: false}), '#010203');
});

test('hsv round-trip', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#3584e4', '#ffffff', '#000000', '#7f7f7f']) {
        const c = parseColor(hex);
        const back = hsvToRgb(rgbToHsv(c));
        assert.ok(equalColor(c, back), `${hex} round-trips`);
    }
});

test('hsl conversion is sane', () => {
    const hsl = toHsl(parseColor('#808080'));
    close(hsl.s, 0, 0.01);
    close(hsl.l, 0.502, 0.01);
});

test('readable text colour', () => {
    assert.equal(readableTextColor(parseColor('#ffffff')), '#000000');
    assert.equal(readableTextColor(parseColor('#000000')), '#ffffff');
    assert.equal(readableTextColor(parseColor('#f6d32d')), '#000000');
});

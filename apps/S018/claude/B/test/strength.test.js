'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { evaluatePassword } = require('../src/strength');

test('rates a short, single-class password as weak', () => {
  const r = evaluatePassword('abc');
  assert.strictEqual(r.rating, 'weak');
  assert.ok(r.feedback.length > 0);
});

test('rates a moderate password as medium', () => {
  const r = evaluatePassword('Abcdef12');
  assert.strictEqual(r.rating, 'medium');
});

test('rates a long, varied password as strong', () => {
  const r = evaluatePassword('Abcdef12!xyzQ');
  assert.strictEqual(r.rating, 'strong');
});

test('flags common passwords regardless of shape', () => {
  const r = evaluatePassword('password');
  assert.strictEqual(r.rating, 'weak');
  assert.strictEqual(r.score, 0);
});

test('penalises a single repeated character', () => {
  const r = evaluatePassword('aaaaaaaaaaaa');
  assert.strictEqual(r.rating, 'weak');
});

test('handles empty input without throwing', () => {
  const r = evaluatePassword('');
  assert.strictEqual(r.rating, 'weak');
  assert.strictEqual(r.score, 0);
});

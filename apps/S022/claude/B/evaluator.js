'use strict';

/**
 * Safe arithmetic expression evaluator.
 *
 * This deliberately AVOIDS `eval`, `Function`, `vm`, or any other dynamic
 * code execution. Input is tokenised against a strict whitelist and parsed
 * with a recursive-descent parser, so an attacker cannot inject code,
 * access globals, or trigger prototype pollution.
 *
 * Grammar (standard precedence, left-associative):
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/' | '%') factor)*
 *   factor := ('+' | '-') factor | power
 *   power  := primary ('^' factor)?        // right-associative
 *   primary:= number | '(' expr ')'
 */

const MAX_LENGTH = 256;

class ExpressionError extends Error {}

// Only these characters may ever appear in an expression.
const ALLOWED = /^[0-9+\-*/%^().eE\s]+$/;

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];

    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }

    if ('+-*/%^()'.includes(c)) {
      tokens.push({ type: c });
      i += 1;
      continue;
    }

    // Number: digits, optional decimal point, optional exponent.
    if ((c >= '0' && c <= '9') || c === '.') {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!match) {
        throw new ExpressionError('Malformed number');
      }
      const value = Number(match[0]);
      if (!Number.isFinite(value)) {
        throw new ExpressionError('Number out of range');
      }
      tokens.push({ type: 'num', value });
      i += match[0].length;
      continue;
    }

    throw new ExpressionError(`Unexpected character: ${c}`);
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (!t || t.type !== type) {
      throw new ExpressionError(`Expected '${type}'`);
    }
    return t;
  };

  function parseExpr() {
    let left = parseTerm();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = next().type;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek() && (peek().type === '*' || peek().type === '/' || peek().type === '%')) {
      const op = next().type;
      const right = parseFactor();
      if ((op === '/' || op === '%') && right === 0) {
        throw new ExpressionError('Division by zero');
      }
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
    }
    return left;
  }

  function parseFactor() {
    const t = peek();
    if (t && (t.type === '+' || t.type === '-')) {
      next();
      const value = parseFactor();
      return t.type === '-' ? -value : value;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek() && peek().type === '^') {
      next();
      const exponent = parseFactor(); // right-associative
      return Math.pow(base, exponent);
    }
    return base;
  }

  function parsePrimary() {
    const t = next();
    if (!t) {
      throw new ExpressionError('Unexpected end of expression');
    }
    if (t.type === 'num') {
      return t.value;
    }
    if (t.type === '(') {
      const value = parseExpr();
      expect(')');
      return value;
    }
    throw new ExpressionError('Expected a number or "("');
  }

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new ExpressionError('Unexpected trailing input');
  }
  return result;
}

/**
 * Validate and evaluate an arithmetic expression.
 * @param {unknown} raw
 * @returns {number}
 * @throws {ExpressionError} on any invalid input.
 */
function evaluate(raw) {
  if (typeof raw !== 'string') {
    throw new ExpressionError('Expression must be a string');
  }
  if (raw.length === 0 || raw.trim().length === 0) {
    throw new ExpressionError('Expression must not be empty');
  }
  if (raw.length > MAX_LENGTH) {
    throw new ExpressionError(`Expression too long (max ${MAX_LENGTH} chars)`);
  }
  if (!ALLOWED.test(raw)) {
    throw new ExpressionError('Expression contains invalid characters');
  }

  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    throw new ExpressionError('Expression must not be empty');
  }

  const result = parse(tokens);
  if (!Number.isFinite(result)) {
    throw new ExpressionError('Result is not a finite number');
  }
  return result;
}

module.exports = { evaluate, ExpressionError, MAX_LENGTH };

'use strict';

// A small, safe arithmetic evaluator.
//
// We deliberately avoid `eval`/`new Function`, which would execute arbitrary
// JavaScript sent by a client. Instead we tokenize the input, convert it to
// Reverse Polish Notation with the shunting-yard algorithm, and evaluate that.
//
// Supported: numbers (including decimals and scientific notation),
// the binary operators + - * / %, exponentiation ^, unary + and -,
// and parentheses.

const OPERATORS = {
  '+': { precedence: 2, associativity: 'left', apply: (a, b) => a + b },
  '-': { precedence: 2, associativity: 'left', apply: (a, b) => a - b },
  '*': { precedence: 3, associativity: 'left', apply: (a, b) => a * b },
  '/': { precedence: 3, associativity: 'left', apply: (a, b) => a / b },
  '%': { precedence: 3, associativity: 'left', apply: (a, b) => a % b },
  '^': { precedence: 4, associativity: 'right', apply: (a, b) => Math.pow(a, b) },
};

function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Number: digits with optional decimal point and exponent.
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const match = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) {
        throw new Error(`Invalid number at position ${i}`);
      }
      tokens.push({ type: 'number', value: parseFloat(match[0]) });
      i += match[0].length;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(OPERATORS, ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${ch}" at position ${i}`);
  }

  return tokens;
}

// Convert infix tokens to RPN. Handles unary minus/plus by detecting operator
// position (start of expression, after another operator, or after an open paren).
function toRpn(tokens) {
  const output = [];
  const stack = [];
  let prev = null;

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.type === 'operator') {
      const isUnary =
        prev === null ||
        (prev.type === 'operator') ||
        (prev.type === 'paren' && prev.value === '(');

      if (isUnary && (token.value === '-' || token.value === '+')) {
        // Encode unary operators distinctly so evaluation can pop one operand.
        output.push({ type: 'number', value: 0 });
        stack.push({ type: 'operator', value: token.value === '-' ? 'u-' : 'u+' });
      } else {
        const o1 = OPERATORS[token.value];
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.type !== 'operator') break;
          if (top.value === 'u-' || top.value === 'u+') {
            stack.pop();
            output.push(top);
            continue;
          }
          const o2 = OPERATORS[top.value];
          const shouldPop =
            (o1.associativity === 'left' && o1.precedence <= o2.precedence) ||
            (o1.associativity === 'right' && o1.precedence < o2.precedence);
          if (!shouldPop) break;
          stack.pop();
          output.push(top);
        }
        stack.push(token);
      }
    } else if (token.value === '(') {
      stack.push(token);
    } else if (token.value === ')') {
      let foundParen = false;
      while (stack.length > 0) {
        const top = stack.pop();
        if (top.type === 'paren' && top.value === '(') {
          foundParen = true;
          break;
        }
        output.push(top);
      }
      if (!foundParen) {
        throw new Error('Mismatched parentheses');
      }
    }
    prev = token;
  }

  while (stack.length > 0) {
    const top = stack.pop();
    if (top.type === 'paren') {
      throw new Error('Mismatched parentheses');
    }
    output.push(top);
  }

  return output;
}

function evalRpn(rpn) {
  const stack = [];

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }

    if (token.value === 'u-' || token.value === 'u+') {
      // Unary operators were emitted with a leading 0 operand, so they behave
      // as binary here: 0 - x and 0 + x.
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) {
        throw new Error('Invalid expression');
      }
      stack.push(token.value === 'u-' ? a - b : a + b);
      continue;
    }

    const op = OPERATORS[token.value];
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) {
      throw new Error('Invalid expression');
    }
    stack.push(op.apply(a, b));
  }

  if (stack.length !== 1) {
    throw new Error('Invalid expression');
  }

  const result = stack[0];
  if (!Number.isFinite(result)) {
    throw new Error('Result is not a finite number');
  }
  return result;
}

function evaluate(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('Expression must be a non-empty string');
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) {
    throw new Error('Expression must contain at least one token');
  }
  const rpn = toRpn(tokens);
  return evalRpn(rpn);
}

module.exports = { evaluate };

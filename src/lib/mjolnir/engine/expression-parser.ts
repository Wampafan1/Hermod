/**
 * Mjolnir — Formula expression parser for the "calculate" step type.
 *
 * Architecture: Tokenizer -> Recursive Descent Parser -> AST Evaluator
 *
 * Column references use {Column Name} syntax. Supports arithmetic,
 * string concatenation (&), comparisons, and built-in functions.
 * Self-contained — no external dependencies.
 */

// ─── Token Types ────────────────────────────────────

export type TokenType =
  | "NUMBER"
  | "STRING"
  | "COLUMN_REF"
  | "OPERATOR"
  | "COMPARISON"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "FUNCTION"
  | "AMPERSAND"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
}

// ─── AST Node Types ─────────────────────────────────

export type AstNode =
  | NumberLiteral
  | StringLiteral
  | ColumnRef
  | BinaryOp
  | UnaryOp
  | FunctionCall
  | Comparison;

export interface NumberLiteral {
  type: "number";
  value: number;
}

export interface StringLiteral {
  type: "string";
  value: string;
}

export interface ColumnRef {
  type: "column_ref";
  name: string;
}

export interface BinaryOp {
  type: "binary_op";
  op: string;
  left: AstNode;
  right: AstNode;
}

export interface UnaryOp {
  type: "unary_op";
  op: string;
  operand: AstNode;
}

export interface FunctionCall {
  type: "function_call";
  name: string;
  args: AstNode[];
}

export interface Comparison {
  type: "comparison";
  op: string;
  left: AstNode;
  right: AstNode;
}

// ─── Known Functions ────────────────────────────────

const KNOWN_FUNCTIONS = new Set([
  "CONCAT",
  "UPPER",
  "LOWER",
  "TRIM",
  "LEFT",
  "RIGHT",
  "LEN",
  "IF",
  "AND",
  "OR",
  "NOT",
  "ROUND",
  "ABS",
  "MIN",
  "MAX",
  // Issue #15: 9 additional commonly needed functions
  "SUBSTITUTE",
  "REPLACE",
  "FIND",
  "INT",
  "CEILING",
  "FLOOR",
  "TEXT",
  "VALUE",
  "ISNULL",
  "ROUNDUP",
  "ROUNDDOWN",
  // Common Excel functions
  "IFERROR",
  "SUM",
  "AVERAGE",
  "SUMPRODUCT",
  "MOD",
  "POWER",
  "SQRT",
  "COUNTA",
  "COUNTBLANK",
  "PROPER",
  "MID",
]);

// ─── Tokenizer ──────────────────────────────────────

/**
 * Tokenize a formula expression string into a Token array.
 *
 * Handles: numbers, double-quoted strings, {Column Ref}, operators,
 * comparisons, parentheses, commas, ampersand, and function names.
 */
export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number: integer or decimal (single dot only)
    if (/\d/.test(ch)) {
      let num = "";
      let hasDot = false;
      while (i < expression.length) {
        const c = expression[i];
        if (/\d/.test(c)) { num += c; i++; }
        else if (c === "." && !hasDot) { hasDot = true; num += c; i++; }
        else break;
      }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }

    // String literal: "..."
    if (ch === '"') {
      i++; // skip opening quote
      let str = "";
      while (i < expression.length && expression[i] !== '"') {
        // Handle escaped quotes
        if (expression[i] === "\\" && i + 1 < expression.length && expression[i + 1] === '"') {
          str += '"';
          i += 2;
        } else {
          str += expression[i];
          i++;
        }
      }
      if (i < expression.length) {
        i++; // skip closing quote
      }
      tokens.push({ type: "STRING", value: str });
      continue;
    }

    // Column reference: {Column Name}
    if (ch === "{") {
      i++; // skip opening brace
      let ref = "";
      while (i < expression.length && expression[i] !== "}") {
        ref += expression[i];
        i++;
      }
      if (i < expression.length) {
        i++; // skip closing brace
      }
      tokens.push({ type: "COLUMN_REF", value: ref });
      continue;
    }

    // Two-character comparison operators: !=, >=, <=, <> (Excel not-equal)
    if (i + 1 < expression.length) {
      const twoChar = expression[i] + expression[i + 1];
      if (twoChar === "!=" || twoChar === ">=" || twoChar === "<=") {
        tokens.push({ type: "COMPARISON", value: twoChar });
        i += 2;
        continue;
      }
      // Excel uses <> for not-equal — normalize to !=
      if (twoChar === "<>") {
        tokens.push({ type: "COMPARISON", value: "!=" });
        i += 2;
        continue;
      }
    }

    // Single-character comparison operators: =, >, <
    if (ch === "=" || ch === ">" || ch === "<") {
      tokens.push({ type: "COMPARISON", value: ch });
      i++;
      continue;
    }

    // Arithmetic operators: +, -, *, /, %
    if ("+-*/%".includes(ch)) {
      tokens.push({ type: "OPERATOR", value: ch });
      i++;
      continue;
    }

    // Ampersand: string concatenation
    if (ch === "&") {
      tokens.push({ type: "AMPERSAND", value: "&" });
      i++;
      continue;
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }

    // Comma
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      i++;
      continue;
    }

    // Identifier: function name or NOT keyword
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < expression.length && /[A-Za-z_\d]/.test(expression[i])) {
        ident += expression[i];
        i++;
      }
      const upper = ident.toUpperCase();
      if (KNOWN_FUNCTIONS.has(upper)) {
        // NOT is a function when used as NOT(...), but also a unary keyword.
        // We emit it as FUNCTION either way; the parser handles the difference.
        tokens.push({ type: "FUNCTION", value: upper });
      } else {
        // Unknown identifier — treat as a string literal fallback
        tokens.push({ type: "STRING", value: ident });
      }
      continue;
    }

    // Unknown character — skip with a warning (production resilience)
    i++;
  }

  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

// ─── Parser ─────────────────────────────────────────

/**
 * Recursive descent parser. Consumes a Token array and produces an AST.
 *
 * Grammar:
 *   expression     → comparison
 *   comparison     → addition (("=" | "!=" | ">" | "<" | ">=" | "<=") addition)*
 *   addition       → multiplication (("+" | "-" | "&") multiplication)*
 *   multiplication → unary (("*" | "/" | "%") unary)*
 *   unary          → ("-" | NOT) unary | primary
 *   primary        → NUMBER | STRING | COLUMN_REF | function_call | "(" expression ")"
 *   function_call  → FUNCTION "(" (expression ("," expression)*)? ")"
 */
export function parse(tokens: Token[]): AstNode {
  let pos = 0;

  function peek(): Token {
    return tokens[pos] ?? { type: "EOF", value: "" };
  }

  function advance(): Token {
    const token = tokens[pos];
    pos++;
    return token;
  }

  function expect(type: TokenType): Token {
    const token = peek();
    if (token.type !== type) {
      throw new Error(
        `Expected ${type} but got ${token.type} ("${token.value}") at position ${pos}`
      );
    }
    return advance();
  }

  function parseExpression(): AstNode {
    return parseComparison();
  }

  function parseComparison(): AstNode {
    let left = parseAddition();

    while (peek().type === "COMPARISON") {
      const op = advance().value;
      const right = parseAddition();
      left = { type: "comparison", op, left, right };
    }

    return left;
  }

  function parseAddition(): AstNode {
    let left = parseMultiplication();

    while (
      (peek().type === "OPERATOR" && (peek().value === "+" || peek().value === "-")) ||
      peek().type === "AMPERSAND"
    ) {
      const token = advance();
      const op = token.value;
      const right = parseMultiplication();
      left = { type: "binary_op", op, left, right };
    }

    return left;
  }

  function parseMultiplication(): AstNode {
    let left = parseUnary();

    while (
      peek().type === "OPERATOR" &&
      (peek().value === "*" || peek().value === "/" || peek().value === "%")
    ) {
      const op = advance().value;
      const right = parseUnary();
      left = { type: "binary_op", op, left, right };
    }

    return left;
  }

  function parseUnary(): AstNode {
    // Unary minus
    if (peek().type === "OPERATOR" && peek().value === "-") {
      advance();
      const operand = parseUnary();
      return { type: "unary_op", op: "-", operand };
    }

    // NOT as a unary operator (may or may not have parens)
    if (peek().type === "FUNCTION" && peek().value === "NOT") {
      // Check if this is NOT(...) function call or NOT expression
      // We look ahead: if next token after NOT is LPAREN, parse as function call
      // to maintain consistency — but NOT is logically a unary op.
      // Handle in primary via function_call path so NOT(x) works.
      // For bare `NOT expr` without parens, handle here:
      if (tokens[pos + 1]?.type !== "LPAREN") {
        advance();
        const operand = parseUnary();
        return { type: "unary_op", op: "NOT", operand };
      }
    }

    return parsePrimary();
  }

  function parsePrimary(): AstNode {
    const token = peek();

    // Number literal
    if (token.type === "NUMBER") {
      advance();
      return { type: "number", value: parseFloat(token.value) };
    }

    // String literal
    if (token.type === "STRING") {
      advance();
      return { type: "string", value: token.value };
    }

    // Column reference
    if (token.type === "COLUMN_REF") {
      advance();
      return { type: "column_ref", name: token.value };
    }

    // Function call: FUNCTION "(" args ")"
    if (token.type === "FUNCTION") {
      const funcName = advance().value;
      expect("LPAREN");
      const args: AstNode[] = [];

      if (peek().type !== "RPAREN") {
        args.push(parseExpression());
        while (peek().type === "COMMA") {
          advance(); // consume comma
          args.push(parseExpression());
        }
      }

      expect("RPAREN");
      return { type: "function_call", name: funcName, args };
    }

    // Parenthesized expression
    if (token.type === "LPAREN") {
      advance();
      const expr = parseExpression();
      expect("RPAREN");
      return expr;
    }

    throw new Error(
      `Unexpected token ${token.type} ("${token.value}") at position ${pos}`
    );
  }

  const ast = parseExpression();

  // Ensure all tokens are consumed (except EOF)
  if (peek().type !== "EOF") {
    throw new Error(
      `Unexpected token ${peek().type} ("${peek().value}") at position ${pos} — expected end of expression`
    );
  }

  return ast;
}

// ─── Evaluator ──────────────────────────────────────

/**
 * Coerce a value to a number. Returns NaN if not coercible.
 */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return NaN;
    return Number(trimmed);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return 0;
  return NaN;
}

/**
 * Coerce a value to a string.
 */
function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Check if a value is truthy in expression context.
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

/**
 * Evaluate an AST node against a data row.
 */
export function evaluate(node: AstNode, row: Record<string, unknown>): unknown {
  switch (node.type) {
    case "number":
      return node.value;

    case "string":
      return node.value;

    case "column_ref": {
      if (!(node.name in row)) return null;
      return row[node.name];
    }

    case "unary_op": {
      const operand = evaluate(node.operand, row);
      if (node.op === "-") {
        return -toNumber(operand);
      }
      if (node.op === "NOT") {
        return !isTruthy(operand);
      }
      throw new Error(`Unknown unary operator: ${node.op}`);
    }

    case "binary_op": {
      const left = evaluate(node.left, row);
      const right = evaluate(node.right, row);

      // Ampersand: always string concatenation
      if (node.op === "&") {
        return toString(left) + toString(right);
      }

      // Arithmetic operators: coerce to numbers
      const lNum = toNumber(left);
      const rNum = toNumber(right);

      switch (node.op) {
        case "+":
          // If both are coercible to number, do arithmetic
          if (!isNaN(lNum) && !isNaN(rNum)) {
            return lNum + rNum;
          }
          // Fallback: string concatenation
          return toString(left) + toString(right);

        case "-":
          return isNaN(lNum) || isNaN(rNum) ? null : lNum - rNum;

        case "*":
          return isNaN(lNum) || isNaN(rNum) ? null : lNum * rNum;

        case "/":
          if (isNaN(lNum) || isNaN(rNum) || rNum === 0) return null;
          return lNum / rNum;

        case "%":
          if (isNaN(lNum) || isNaN(rNum) || rNum === 0) return null;
          return lNum % rNum;

        default:
          throw new Error(`Unknown binary operator: ${node.op}`);
      }
    }

    case "comparison": {
      const left = evaluate(node.left, row);
      const right = evaluate(node.right, row);

      // Try numeric comparison first
      const lNum = toNumber(left);
      const rNum = toNumber(right);
      const bothNumeric = !isNaN(lNum) && !isNaN(rNum);

      switch (node.op) {
        case "=":
          if (bothNumeric) return lNum === rNum;
          return toString(left) === toString(right);

        case "!=":
          if (bothNumeric) return lNum !== rNum;
          return toString(left) !== toString(right);

        case ">":
          if (bothNumeric) return lNum > rNum;
          return toString(left) > toString(right);

        case "<":
          if (bothNumeric) return lNum < rNum;
          return toString(left) < toString(right);

        case ">=":
          if (bothNumeric) return lNum >= rNum;
          return toString(left) >= toString(right);

        case "<=":
          if (bothNumeric) return lNum <= rNum;
          return toString(left) <= toString(right);

        default:
          throw new Error(`Unknown comparison operator: ${node.op}`);
      }
    }

    case "function_call":
      return evaluateFunction(node.name, node.args, row);

    default: {
      // Exhaustive check: this should never happen with well-formed ASTs
      const _exhaustive: never = node;
      throw new Error(`Unknown AST node type: ${(_exhaustive as AstNode).type}`);
    }
  }
}

// ─── Function Evaluation ────────────────────────────

/**
 * Evaluate a built-in function call.
 */
function evaluateFunction(
  name: string,
  args: AstNode[],
  row: Record<string, unknown>
): unknown {
  switch (name) {
    case "CONCAT": {
      return args.map((a) => toString(evaluate(a, row))).join("");
    }

    case "UPPER": {
      if (args.length < 1) throw new Error("UPPER requires 1 argument");
      return toString(evaluate(args[0], row)).toUpperCase();
    }

    case "LOWER": {
      if (args.length < 1) throw new Error("LOWER requires 1 argument");
      return toString(evaluate(args[0], row)).toLowerCase();
    }

    case "TRIM": {
      if (args.length < 1) throw new Error("TRIM requires 1 argument");
      return toString(evaluate(args[0], row)).trim();
    }

    case "LEFT": {
      if (args.length < 2) throw new Error("LEFT requires 2 arguments");
      const str = toString(evaluate(args[0], row));
      const n = toNumber(evaluate(args[1], row));
      return str.substring(0, n);
    }

    case "RIGHT": {
      if (args.length < 2) throw new Error("RIGHT requires 2 arguments");
      const str = toString(evaluate(args[0], row));
      const n = toNumber(evaluate(args[1], row));
      return str.substring(Math.max(0, str.length - n));
    }

    case "LEN": {
      if (args.length < 1) throw new Error("LEN requires 1 argument");
      return toString(evaluate(args[0], row)).length;
    }

    case "IF": {
      if (args.length < 3) throw new Error("IF requires 3 arguments");
      const condition = evaluate(args[0], row);
      if (isTruthy(condition)) {
        return evaluate(args[1], row);
      }
      return evaluate(args[2], row);
    }

    case "AND": {
      if (args.length < 2) throw new Error("AND requires at least 2 arguments");
      return args.every((a) => isTruthy(evaluate(a, row)));
    }

    case "OR": {
      if (args.length < 2) throw new Error("OR requires at least 2 arguments");
      return args.some((a) => isTruthy(evaluate(a, row)));
    }

    case "NOT": {
      if (args.length < 1) throw new Error("NOT requires 1 argument");
      return !isTruthy(evaluate(args[0], row));
    }

    case "ROUND": {
      if (args.length < 1) throw new Error("ROUND requires at least 1 argument");
      const num = toNumber(evaluate(args[0], row));
      const decimals = args.length >= 2 ? toNumber(evaluate(args[1], row)) : 0;
      const factor = Math.pow(10, decimals);
      return Math.round(num * factor) / factor;
    }

    case "ROUNDUP": {
      // ROUNDUP(number, num_digits) — rounds away from zero
      if (args.length < 1) throw new Error("ROUNDUP requires at least 1 argument");
      const num = toNumber(evaluate(args[0], row));
      const digits = args.length >= 2 ? toNumber(evaluate(args[1], row)) : 0;
      const factor = Math.pow(10, digits);
      return num >= 0
        ? Math.ceil(num * factor) / factor
        : Math.floor(num * factor) / factor;
    }

    case "ROUNDDOWN": {
      // ROUNDDOWN(number, num_digits) — rounds toward zero
      if (args.length < 1) throw new Error("ROUNDDOWN requires at least 1 argument");
      const num = toNumber(evaluate(args[0], row));
      const digits = args.length >= 2 ? toNumber(evaluate(args[1], row)) : 0;
      const factor = Math.pow(10, digits);
      return num >= 0
        ? Math.floor(num * factor) / factor
        : Math.ceil(num * factor) / factor;
    }

    case "ABS": {
      if (args.length < 1) throw new Error("ABS requires 1 argument");
      return Math.abs(toNumber(evaluate(args[0], row)));
    }

    case "MIN": {
      if (args.length < 1) throw new Error("MIN requires at least 1 argument");
      const values = args.map((a) => toNumber(evaluate(a, row))).filter((n) => !isNaN(n));
      if (values.length === 0) return null;
      return values.reduce((a, b) => (a < b ? a : b), values[0]);
    }

    case "MAX": {
      if (args.length < 1) throw new Error("MAX requires at least 1 argument");
      const values = args.map((a) => toNumber(evaluate(a, row))).filter((n) => !isNaN(n));
      if (values.length === 0) return null;
      return values.reduce((a, b) => (a > b ? a : b), values[0]);
    }

    // ─── Issue #15: 9 additional functions ─────────

    case "SUBSTITUTE": {
      // SUBSTITUTE(text, old_text, new_text)
      if (args.length < 3) throw new Error("SUBSTITUTE requires 3 arguments");
      const text = toString(evaluate(args[0], row));
      const oldText = toString(evaluate(args[1], row));
      const newText = toString(evaluate(args[2], row));
      return text.split(oldText).join(newText);
    }

    case "REPLACE": {
      // REPLACE(text, start_pos, num_chars, new_text)
      if (args.length < 4) throw new Error("REPLACE requires 4 arguments");
      const text = toString(evaluate(args[0], row));
      const startPos = toNumber(evaluate(args[1], row));
      const numChars = toNumber(evaluate(args[2], row));
      const newText = toString(evaluate(args[3], row));
      // 1-based index (Excel convention)
      const idx = Math.max(0, startPos - 1);
      return text.substring(0, idx) + newText + text.substring(idx + numChars);
    }

    case "FIND": {
      // FIND(find_text, within_text, [start_pos])
      if (args.length < 2) throw new Error("FIND requires at least 2 arguments");
      const findText = toString(evaluate(args[0], row));
      const withinText = toString(evaluate(args[1], row));
      const startPos = args.length >= 3 ? toNumber(evaluate(args[2], row)) : 1;
      // 1-based index, case-sensitive
      const idx = withinText.indexOf(findText, Math.max(0, startPos - 1));
      return idx === -1 ? null : idx + 1; // return 1-based position or null if not found
    }

    case "INT": {
      if (args.length < 1) throw new Error("INT requires 1 argument");
      return Math.floor(toNumber(evaluate(args[0], row)));
    }

    case "CEILING": {
      if (args.length < 1) throw new Error("CEILING requires at least 1 argument");
      const num = toNumber(evaluate(args[0], row));
      const significance = args.length >= 2 ? toNumber(evaluate(args[1], row)) : 1;
      if (significance === 0) return 0;
      return Math.ceil(num / significance) * significance;
    }

    case "FLOOR": {
      if (args.length < 1) throw new Error("FLOOR requires at least 1 argument");
      const num = toNumber(evaluate(args[0], row));
      const significance = args.length >= 2 ? toNumber(evaluate(args[1], row)) : 1;
      if (significance === 0) return 0;
      return Math.floor(num / significance) * significance;
    }

    case "TEXT": {
      // TEXT(value, format) — simplified: just converts to string
      if (args.length < 1) throw new Error("TEXT requires at least 1 argument");
      const val = evaluate(args[0], row);
      if (args.length >= 2) {
        const fmt = toString(evaluate(args[1], row));
        // Handle common number formats
        if (fmt === "0" || fmt === "#") return String(Math.round(toNumber(val)));
        if (fmt === "0.00" || fmt === "#.##") return toNumber(val).toFixed(2);
        if (fmt === "0.0") return toNumber(val).toFixed(1);
      }
      return toString(val);
    }

    case "VALUE": {
      // VALUE(text) — converts text to number
      if (args.length < 1) throw new Error("VALUE requires 1 argument");
      const text = toString(evaluate(args[0], row));
      const num = Number(text.trim().replace(/,/g, ""));
      return isNaN(num) ? null : num;
    }

    case "ISNULL": {
      // ISNULL(value) — returns true if null/undefined/empty
      if (args.length < 1) throw new Error("ISNULL requires 1 argument");
      const val = evaluate(args[0], row);
      return val === null || val === undefined || val === "";
    }

    case "IFERROR": {
      // IFERROR(value, value_if_error) — returns value_if_error if value is an error/null
      if (args.length < 2) throw new Error("IFERROR requires 2 arguments");
      try {
        const val = evaluate(args[0], row);
        // Treat null (e.g. division by zero) as an error
        if (val === null || val === undefined || (typeof val === "number" && isNaN(val))) {
          return evaluate(args[1], row);
        }
        return val;
      } catch {
        return evaluate(args[1], row);
      }
    }

    case "SUM": {
      // SUM(value1, value2, ...) — sum of all arguments
      if (args.length < 1) throw new Error("SUM requires at least 1 argument");
      let sum = 0;
      for (const a of args) {
        const v = toNumber(evaluate(a, row));
        if (!isNaN(v)) sum += v;
      }
      return sum;
    }

    case "AVERAGE": {
      // AVERAGE(value1, value2, ...) — average of all arguments
      if (args.length < 1) throw new Error("AVERAGE requires at least 1 argument");
      let sum = 0;
      let count = 0;
      for (const a of args) {
        const v = toNumber(evaluate(a, row));
        if (!isNaN(v)) { sum += v; count++; }
      }
      return count > 0 ? sum / count : null;
    }

    case "SUMPRODUCT": {
      // SUMPRODUCT(array1, array2) — simplified: multiply corresponding args pairwise
      // In Mjolnir context, args are individual values, so just multiply them and sum
      if (args.length < 2) throw new Error("SUMPRODUCT requires at least 2 arguments");
      let result = 0;
      for (let i = 0; i < args.length; i += 2) {
        if (i + 1 < args.length) {
          const a = toNumber(evaluate(args[i], row));
          const b = toNumber(evaluate(args[i + 1], row));
          if (!isNaN(a) && !isNaN(b)) result += a * b;
        }
      }
      return result;
    }

    case "MOD": {
      if (args.length < 2) throw new Error("MOD requires 2 arguments");
      const num = toNumber(evaluate(args[0], row));
      const divisor = toNumber(evaluate(args[1], row));
      if (divisor === 0) return null;
      return num - divisor * Math.floor(num / divisor);
    }

    case "POWER": {
      if (args.length < 2) throw new Error("POWER requires 2 arguments");
      return Math.pow(toNumber(evaluate(args[0], row)), toNumber(evaluate(args[1], row)));
    }

    case "SQRT": {
      if (args.length < 1) throw new Error("SQRT requires 1 argument");
      const num = toNumber(evaluate(args[0], row));
      return num < 0 ? null : Math.sqrt(num);
    }

    case "COUNTA": {
      // COUNTA(values...) — count non-null/non-empty values
      let count = 0;
      for (const a of args) {
        const v = evaluate(a, row);
        if (v !== null && v !== undefined && v !== "") count++;
      }
      return count;
    }

    case "COUNTBLANK": {
      let count = 0;
      for (const a of args) {
        const v = evaluate(a, row);
        if (v === null || v === undefined || v === "") count++;
      }
      return count;
    }

    case "PROPER": {
      // PROPER(text) — capitalize first letter of each word (lowercase rest)
      if (args.length < 1) throw new Error("PROPER requires 1 argument");
      const text = toString(evaluate(args[0], row));
      return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    case "MID": {
      // MID(text, start_pos, num_chars) — 1-based
      if (args.length < 3) throw new Error("MID requires 3 arguments");
      const text = toString(evaluate(args[0], row));
      const start = toNumber(evaluate(args[1], row));
      const len = toNumber(evaluate(args[2], row));
      return text.substring(Math.max(0, start - 1), Math.max(0, start - 1) + len);
    }

    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

// ─── Main Entry Point ───────────────────────────────

/**
 * Evaluate a formula expression against a data row.
 *
 * This is the primary entry point — tokenizes, parses, and evaluates
 * in a single call. Column references use {Column Name} syntax.
 *
 * @param expression - The formula string (e.g., `{Price} * {Quantity}`)
 * @param row - The data row as a key-value record
 * @returns The computed value
 */
/**
 * Parse a formula string into an AST without evaluating.
 * Use this to parse once, then evaluate many times with different rows.
 */
export function parseFormula(expression: string): AstNode {
  const expr = expression.startsWith("=") ? expression.slice(1) : expression;
  const tokens = tokenize(expr);
  return parse(tokens);
}

export function evaluateExpression(
  expression: string,
  row: Record<string, unknown>
): unknown {
  const ast = parseFormula(expression);
  return evaluate(ast, row);
}

import { describe, it, expect } from "vitest";
import {
  tokenize,
  parse,
  evaluate,
  evaluateExpression,
} from "@/lib/mjolnir/engine/expression-parser";

// ─── Tokenizer ──────────────────────────────────────

describe("tokenize", () => {
  it("tokenizes numbers, strings, column refs, operators, and functions", () => {
    const tokens = tokenize('{Price} * 2 + ROUND({Tax}, 2) & " USD"');
    const types = tokens.map((t) => t.type);

    expect(types).toEqual([
      "COLUMN_REF",   // {Price}
      "OPERATOR",     // *
      "NUMBER",       // 2
      "OPERATOR",     // +
      "FUNCTION",     // ROUND
      "LPAREN",       // (
      "COLUMN_REF",   // {Tax}
      "COMMA",        // ,
      "NUMBER",       // 2
      "RPAREN",       // )
      "AMPERSAND",    // &
      "STRING",       // " USD"
      "EOF",
    ]);
  });

  it("tokenizes comparison operators correctly", () => {
    const tokens = tokenize("{A} >= 10");
    expect(tokens[0]).toEqual({ type: "COLUMN_REF", value: "A" });
    expect(tokens[1]).toEqual({ type: "COMPARISON", value: ">=" });
    expect(tokens[2]).toEqual({ type: "NUMBER", value: "10" });
    expect(tokens[3]).toEqual({ type: "EOF", value: "" });
  });
});

// ─── Parser ─────────────────────────────────────────

describe("parse", () => {
  it("parses simple arithmetic: 1 + 2", () => {
    const tokens = tokenize("1 + 2");
    const ast = parse(tokens);
    expect(ast).toEqual({
      type: "binary_op",
      op: "+",
      left: { type: "number", value: 1 },
      right: { type: "number", value: 2 },
    });
  });

  it("parses nested: (1 + 2) * 3", () => {
    const tokens = tokenize("(1 + 2) * 3");
    const ast = parse(tokens);
    expect(ast).toEqual({
      type: "binary_op",
      op: "*",
      left: {
        type: "binary_op",
        op: "+",
        left: { type: "number", value: 1 },
        right: { type: "number", value: 2 },
      },
      right: { type: "number", value: 3 },
    });
  });
});

// ─── Evaluator — Arithmetic ─────────────────────────

describe("evaluate — arithmetic", () => {
  it("evaluates column arithmetic: {Price} * {Quantity}", () => {
    const result = evaluateExpression(
      "{Price} * {Quantity}",
      { Price: 25, Quantity: 4 }
    );
    expect(result).toBe(100);
  });

  it("evaluates modulo operator", () => {
    expect(evaluateExpression("10 % 3", {})).toBe(1);
  });

  it("handles division by zero gracefully", () => {
    expect(evaluateExpression("{A} / 0", { A: 10 })).toBeNull();
  });
});

// ─── Evaluator — String Concatenation ───────────────

describe("evaluate — string concatenation", () => {
  it("evaluates ampersand concatenation: {First} & \" \" & {Last}", () => {
    const result = evaluateExpression(
      '{First} & " " & {Last}',
      { First: "John", Last: "Doe" }
    );
    expect(result).toBe("John Doe");
  });

  it("evaluates CONCAT function: CONCAT({A}, \"-\", {B})", () => {
    const result = evaluateExpression(
      'CONCAT({A}, "-", {B})',
      { A: "foo", B: "bar" }
    );
    expect(result).toBe("foo-bar");
  });
});

// ─── Evaluator — String Functions ───────────────────

describe("evaluate — string functions", () => {
  it("evaluates UPPER", () => {
    expect(evaluateExpression("UPPER({Name})", { Name: "hello" })).toBe("HELLO");
  });

  it("evaluates LOWER", () => {
    expect(evaluateExpression("LOWER({Name})", { Name: "HELLO" })).toBe("hello");
  });

  it("evaluates TRIM", () => {
    expect(evaluateExpression("TRIM({Name})", { Name: "  hello  " })).toBe("hello");
  });

  it("evaluates LEFT and RIGHT", () => {
    expect(evaluateExpression("LEFT({S}, 3)", { S: "abcdef" })).toBe("abc");
    expect(evaluateExpression("RIGHT({S}, 3)", { S: "abcdef" })).toBe("def");
  });

  it("evaluates LEN", () => {
    expect(evaluateExpression("LEN({S})", { S: "hello" })).toBe(5);
  });
});

// ─── Evaluator — Conditional / Logic ────────────────

describe("evaluate — conditional and logic", () => {
  it("evaluates IF: IF({Score} > 50, \"Pass\", \"Fail\")", () => {
    expect(
      evaluateExpression('IF({Score} > 50, "Pass", "Fail")', { Score: 75 })
    ).toBe("Pass");
    expect(
      evaluateExpression('IF({Score} > 50, "Pass", "Fail")', { Score: 30 })
    ).toBe("Fail");
  });

  it("evaluates nested IF", () => {
    const expr = 'IF({Score} > 90, "A", IF({Score} > 70, "B", "C"))';
    expect(evaluateExpression(expr, { Score: 95 })).toBe("A");
    expect(evaluateExpression(expr, { Score: 80 })).toBe("B");
    expect(evaluateExpression(expr, { Score: 50 })).toBe("C");
  });

  it("evaluates AND and OR", () => {
    expect(evaluateExpression("AND({A} > 0, {B} > 0)", { A: 1, B: 2 })).toBe(true);
    expect(evaluateExpression("AND({A} > 0, {B} > 0)", { A: 1, B: -1 })).toBe(false);
    expect(evaluateExpression("OR({A} > 0, {B} > 0)", { A: -1, B: 2 })).toBe(true);
    expect(evaluateExpression("OR({A} > 0, {B} > 0)", { A: -1, B: -1 })).toBe(false);
  });

  it("evaluates NOT", () => {
    expect(evaluateExpression("NOT({Flag})", { Flag: true })).toBe(false);
    expect(evaluateExpression("NOT({Flag})", { Flag: false })).toBe(true);
  });
});

// ─── Evaluator — Math Functions ─────────────────────

describe("evaluate — math functions", () => {
  it("evaluates ROUND and ABS", () => {
    expect(evaluateExpression("ROUND(3.14159, 2)", {})).toBe(3.14);
    expect(evaluateExpression("ROUND(3.5)", {})).toBe(4);
    expect(evaluateExpression("ABS(-42)", {})).toBe(42);
  });

  it("evaluates MIN and MAX with multiple args", () => {
    expect(evaluateExpression("MIN({A}, {B}, {C})", { A: 10, B: 3, C: 7 })).toBe(3);
    expect(evaluateExpression("MAX({A}, {B}, {C})", { A: 10, B: 3, C: 7 })).toBe(10);
  });
});

// ─── Evaluator — Comparisons ────────────────────────

describe("evaluate — comparison operators", () => {
  it("evaluates all comparison operators", () => {
    const row = { A: 10, B: 20 };
    expect(evaluateExpression("{A} = 10", row)).toBe(true);
    expect(evaluateExpression("{A} != {B}", row)).toBe(true);
    expect(evaluateExpression("{A} > {B}", row)).toBe(false);
    expect(evaluateExpression("{A} < {B}", row)).toBe(true);
    expect(evaluateExpression("{A} >= 10", row)).toBe(true);
    expect(evaluateExpression("{B} <= 20", row)).toBe(true);
  });
});

// ─── Evaluator — Edge Cases ─────────────────────────

describe("evaluate — edge cases", () => {
  it("handles missing column reference (returns null)", () => {
    expect(evaluateExpression("{Missing}", { Other: 1 })).toBeNull();
  });

  it("handles type coercion: string number + number", () => {
    expect(evaluateExpression("{A} + {B}", { A: "5", B: 3 })).toBe(8);
  });

  it("handles unary minus: -{Value}", () => {
    expect(evaluateExpression("-{Value}", { Value: 42 })).toBe(-42);
  });

  it("handles special characters in column names (Issue #14)", () => {
    expect(
      evaluateExpression("{WHAT'S SPOKEN FOR?}", { "WHAT'S SPOKEN FOR?": 42 })
    ).toBe(42);
    expect(
      evaluateExpression("{Column (1)}", { "Column (1)": "hello" })
    ).toBe("hello");
    expect(
      evaluateExpression("{Sales $}", { "Sales $": 100 })
    ).toBe(100);
  });
});

// ─── Issue #15: New Functions ─────────────────────────

describe("evaluate — new functions (Issue #15)", () => {
  it("evaluates SUBSTITUTE", () => {
    expect(
      evaluateExpression('SUBSTITUTE({S}, "o", "0")', { S: "hello world" })
    ).toBe("hell0 w0rld");
  });

  it("evaluates REPLACE (1-based index)", () => {
    expect(
      evaluateExpression('REPLACE({S}, 2, 3, "XYZ")', { S: "abcdefg" })
    ).toBe("aXYZefg");
  });

  it("evaluates FIND (1-based, case-sensitive)", () => {
    expect(evaluateExpression('FIND("cd", {S})', { S: "abcdef" })).toBe(3);
    expect(evaluateExpression('FIND("XY", {S})', { S: "abcdef" })).toBeNull();
  });

  it("evaluates INT (floor)", () => {
    expect(evaluateExpression("INT(3.9)", {})).toBe(3);
    expect(evaluateExpression("INT(-2.1)", {})).toBe(-3);
  });

  it("evaluates CEILING and FLOOR with significance", () => {
    expect(evaluateExpression("CEILING(4.3, 1)", {})).toBe(5);
    expect(evaluateExpression("CEILING(4.3, 0.5)", {})).toBe(4.5);
    expect(evaluateExpression("FLOOR(4.7, 1)", {})).toBe(4);
    expect(evaluateExpression("FLOOR(4.7, 0.5)", {})).toBe(4.5);
  });

  it("evaluates TEXT for number formatting", () => {
    expect(evaluateExpression('TEXT(3.14159, "0.00")', {})).toBe("3.14");
    expect(evaluateExpression('TEXT(42, "0")', {})).toBe("42");
  });

  it("evaluates VALUE (text to number)", () => {
    expect(evaluateExpression('VALUE("42.5")', {})).toBe(42.5);
    expect(evaluateExpression('VALUE("  100  ")', {})).toBe(100);
    expect(evaluateExpression('VALUE("not a number")', {})).toBeNull();
  });

  it("evaluates ISNULL", () => {
    expect(evaluateExpression("ISNULL({A})", { A: null })).toBe(true);
    expect(evaluateExpression("ISNULL({A})", { A: "" })).toBe(true);
    expect(evaluateExpression("ISNULL({A})", { A: 0 })).toBe(false);
    expect(evaluateExpression("ISNULL({Missing})", {})).toBe(true);
  });

  it("strips leading '=' from Excel-style formulas", () => {
    // File parser formulas may have '=' prefix
    expect(evaluateExpression("={A}+{B}", { A: 10, B: 20 })).toBe(30);
    expect(evaluateExpression("=ROUND({Price}, 2)", { Price: 3.14159 })).toBe(3.14);
    expect(evaluateExpression("=IF({A}>0, {A}, 0)", { A: 5 })).toBe(5);
    // Without '=' should still work
    expect(evaluateExpression("{A}+{B}", { A: 10, B: 20 })).toBe(30);
  });
});

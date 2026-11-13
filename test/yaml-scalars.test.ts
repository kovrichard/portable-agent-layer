import { describe, expect, test } from "bun:test";
import { parseScalar, parseStringArray } from "../src/tools/knowledge/yaml-scalars";

describe("parseScalar", () => {
  test.each<[string, unknown]>([
    ["   ", ""],
    [" true ", true],
    ["false", false],
    ["42", 42],
    ["-3.5", -3.5],
    ["1.25", 1.25],
    ["1.", "1."],
    ["v1", "v1"],
    ["1a", "1a"],
    ['"a\\nb"', "a\nb"],
    ['"bad\\x"', "bad\\x"],
    ['"', ""],
    ['a"', 'a"'],
    ['"a', '"a'],
    ["  padded  ", "padded"],
  ])("%p reads as %p", (raw, expected) => {
    expect(parseScalar(raw)).toEqual(expected);
  });
});

describe("parseStringArray", () => {
  test.each<[string, string[]]>([
    ["[]", []],
    [" [ ] ", []],
    ["a, b", []],
    ["[ab", []],
    ["ab]", []],
    ['[a, "b, c", 3]', ["a", "b, c", "3"]],
    ['["x\\"y", z]', ['x"y', "z"]],
    ['["a\\",b"]', ['a",b']],
    ["[a\\,b]", ["a\\", "b"]],
    ["[a,,b]", ["a", "", "b"]],
    ["[a, ]", ["a"]],
  ])("%p reads as %p", (raw, expected) => {
    expect(parseStringArray(raw)).toEqual(expected);
  });
});

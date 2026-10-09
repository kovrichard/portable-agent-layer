import { describe, expect, test } from "bun:test";
import {
  buildNameIndex,
  findMentions,
  lookupName,
  type NamedEntity,
  proseOnly,
} from "../src/hooks/lib/entity-names";

function person(slug: string, title: string, aliases: string[] = []): NamedEntity {
  return { slug, domain: "People", title, aliases };
}

function company(slug: string, title: string, domainName?: string): NamedEntity {
  return { slug, domain: "Companies", title, aliases: [], domainName };
}

const ENTITIES = [
  person("tovar-zsofia", "Tóvár Zsófia"),
  person("zsofia-berek", "Zsófia Berek"),
  person("pip", "Pip", ["Pip Lanter", "pipster"]),
  person("quill-ostrander", "Quill Ostrander", ["Quilly"]),
  person("odo-ostrander", "Odo Ostrander"),
  company("brightmoor-io", "Brightmoor Kft.", "brightmoor.io"),
];

const index = buildNameIndex(ENTITIES, ["Quilly", "Jarvis"]);

function slugsIn(text: string): string[][] {
  return findMentions(text, index).map((m) => m.entities.map((e) => e.slug).sort());
}

describe("findMentions", () => {
  test("a full name finds its person regardless of accents and order", () => {
    expect(slugsIn("I talked to Zsofia Tovar today")).toEqual([["tovar-zsofia"]]);
  });

  test("an alias finds its person, lowercase included", () => {
    expect(slugsIn("ask pipster about the invoice")).toEqual([["pip"]]);
  });

  test("a possessive still names the person", () => {
    expect(slugsIn("Pip's token expired")).toEqual([["pip"]]);
  });

  test("a shared given name lists every candidate as one mention", () => {
    expect(slugsIn("Zsófia will call back")).toEqual([["tovar-zsofia", "zsofia-berek"]]);
  });

  test("a given name next to an unknown surname is someone else", () => {
    expect(slugsIn("I read what Zsófia Kertész wrote")).toEqual([]);
  });

  test("a sentence-initial word before the given name does not block it", () => {
    expect(slugsIn("Thanks. Ask Zsófia tomorrow")).toEqual([
      ["tovar-zsofia", "zsofia-berek"],
    ]);
  });

  test("a company is found by its name without the legal suffix and by its site", () => {
    expect(slugsIn("Brightmoor wants a quote")).toEqual([["brightmoor-io"]]);
    expect(slugsIn("the brightmoor team replied")).toEqual([["brightmoor-io"]]);
  });

  test("names inside URLs, emails and code are not mentions", () => {
    const text = "see https://brightmoor.io/x and pip@brightmoor.io and `Pip Lanter`";
    expect(slugsIn(text)).toEqual([]);
  });

  test("the user is never reported, and their full name does not leak into a namesake", () => {
    expect(slugsIn("Quill Ostrander signed it")).toEqual([]);
    expect(slugsIn("Odo Ostrander signed it")).toEqual([["odo-ostrander"]]);
  });
});

describe("lookupName", () => {
  test("a full name is exact; a lone given name is not", () => {
    expect(lookupName("Zsófia Berek", index)).toMatchObject({ exact: true });
    expect(lookupName("Zsófia", index).exact).toBe(false);
    expect(lookupName("Zsófia", index).entities).toHaveLength(2);
  });
});

describe("proseOnly", () => {
  test("drops fenced code and paths", () => {
    expect(proseOnly("hi ```Pip``` src/Pip/x.ts").includes("Pip")).toBe(false);
  });
});

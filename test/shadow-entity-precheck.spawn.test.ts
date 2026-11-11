import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { extractSessionEntities } from "../src/hooks/handlers/entity-extraction";
import { unseenUserText } from "../src/hooks/lib/entity-extraction";
import { parseMessages } from "../src/hooks/lib/transcript";
import {
  eventsOf,
  fakeAdapter,
  modelHome,
  setSystemOne,
  shadowOn,
} from "./lib/shadow-judgments";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const entity = (over: Record<string, unknown>) => ({
  kind: "person",
  name: "",
  existing: "",
  aliases: [],
  role: "",
  organization: "",
  relation: "",
  fact: "",
  ...over,
});

const ONE_PERSON = JSON.stringify({
  entities: [entity({ name: "Odo Vance", relation: "client" })],
});
const NONE = JSON.stringify({ entities: [] });

const TURN = JSON.stringify([
  { role: "user", content: "we met Odo Vance from Northwind yesterday", id: "u1" },
  { role: "assistant", content: "noted", id: "a1" },
]);

let home: string;

/** `null` makes the fake `claude` fail. */
function start(reply: string | null = ONE_PERSON) {
  home = modelHome(import.meta.file, reply ?? undefined);
}

beforeEach(() => start());

function personFile(): boolean {
  return existsSync(resolve(home, "memory", "knowledge", "People", "odo-vance.md"));
}

describe("criterion 2: one judge() call, off by default", () => {
  test("stores the person, logs one medium inference_call and one off judge_call", async () => {
    await extractSessionEntities(TURN, "sess-off");
    expect(personFile()).toBe(true);
    const inferred = eventsOf(home, "inference_call");
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({ caller: "entity-extraction", tier: "medium" });
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "entity-precheck",
      mode: "off",
      route: "fallback",
      fallbackAnswers: { names_entity: { noul: true } },
    });
  });

  test("an extraction without entities answers false and stores nothing", async () => {
    start(NONE);
    await extractSessionEntities(TURN, "sess-none");
    expect(personFile()).toBe(false);
    expect(eventsOf(home, "judge_call")[0]?.fallbackAnswers).toEqual({
      names_entity: { noul: false },
    });
  });

  test("a reply that is not JSON gives no answers and stores nothing", async () => {
    start("nope");
    await extractSessionEntities(TURN, "sess-bad");
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.fallbackAnswers).toBeUndefined();
    expect(personFile()).toBe(false);
  });

  test("a failed model call still writes the event and stores nothing", async () => {
    start(null);
    await extractSessionEntities(TURN, "sess-fail");
    expect(eventsOf(home, "judge_call")).toHaveLength(1);
    expect(personFile()).toBe(false);
  });

  test("a second run on the same transcript adds no call, no event and changes nothing", async () => {
    await extractSessionEntities(TURN, "sess-twice");
    await extractSessionEntities(TURN, "sess-twice");
    expect(eventsOf(home, "judge_call")).toHaveLength(1);
    expect(eventsOf(home, "inference_call")).toHaveLength(1);
    expect(personFile()).toBe(true);
  });

  test("text worth no extraction makes no model call and no judge_call", async () => {
    const quiet = JSON.stringify([
      { role: "user", content: "ok", id: "u1" },
      { role: "assistant", content: "fine", id: "a1" },
    ]);
    await extractSessionEntities(quiet, "sess-quiet");
    expect(eventsOf(home, "judge_call")).toEqual([]);
    expect(eventsOf(home, "inference_call")).toEqual([]);
  });
});

describe("criterion 4: caller missing from systemOne.callers", () => {
  test("mode off and System One is never asked", async () => {
    const adapter = fakeAdapter({ names_entity: { noul: false } });
    setSystemOne(home, { provider: "fake", callers: { reaction: "shadow" } });
    await extractSessionEntities(TURN, "sess-missing");
    expect(adapter.asked).toHaveLength(0);
    expect(eventsOf(home, "judge_call")).toMatchObject([
      { caller: "entity-precheck", mode: "off", route: "fallback" },
    ]);
    expect(personFile()).toBe(true);
  });
});

describe("criteria 5 and 6: shadow", () => {
  test("stores the same result, logs both answers, and sends exactly the state and question", async () => {
    const adapter = fakeAdapter({ names_entity: { noul: false } });
    shadowOn(home, "entity-precheck");
    await extractSessionEntities(TURN, "sess-shadow");

    expect(personFile()).toBe(true);
    const judged = eventsOf(home, "judge_call");
    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({
      caller: "entity-precheck",
      mode: "shadow",
      route: "fallback",
      systemOneAnswers: { names_entity: { noul: false } },
      fallbackAnswers: { names_entity: { noul: true } },
    });
    expect(eventsOf(home, "inference_call")).toHaveLength(1);

    expect(adapter.asked).toHaveLength(1);
    const asked = adapter.asked[0];
    const { text } = unseenUserText(parseMessages(TURN), undefined);
    expect(asked?.state).toEqual({ messages: text });
    expect(asked?.questions).toEqual({
      names_entity: {
        type: "noul",
        instructions: "Does `messages` name a person or a company?",
        criteria: {
          true: "at least one individual or one organisation is mentioned by name",
          false:
            "no person or company is named; names of tools, products, programming languages and places do not count",
        },
      },
    });
  });
});

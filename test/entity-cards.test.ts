import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPromptContext } from "../src/hooks/handlers/inject-retrieval";
import {
  entityReminder,
  latestNote,
  loadKnownEntities,
} from "../src/hooks/lib/entity-cards";
import { reload } from "../src/hooks/lib/settings";
import { ingestEntities } from "../src/tools/knowledge/ingest";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);

function writeSettings(settings: object): void {
  writeFileSync(resolve(HOME, "memory", "pal-settings.json"), JSON.stringify(settings));
  reload();
}

beforeEach(() => {
  process.env.PAL_HOME = HOME;
  removeOnceReleased(HOME);
  mkdirSync(resolve(HOME, "memory"), { recursive: true });
  writeSettings({ identity: { principal: { name: "Quill" }, ai: { name: "Jarvis" } } });
  ingestEntities(
    {
      people: [
        {
          name: "Pip Lanter",
          title: "Co-founder",
          company: "Brightmoor Kft.",
          relation: "partner",
          context: "Runs the delivery side; prefers calls to email.",
        },
        { name: "Quill Ostrander", aliases: ["Quill"], context: "The user." },
      ],
      companies: [
        { name: "Brightmoor Kft.", domain: "brightmoor.io", relation: "own company" },
      ],
    },
    "fixture"
  );
});

describe("entityReminder", () => {
  test("a known person gets a card with role, company, relation and the latest note", () => {
    const reminder = entityReminder("can you ask Pip Lanter?", loadKnownEntities());
    expect(reminder).toContain("**Pip Lanter**: Co-founder, Brightmoor Kft., partner.");
    expect(reminder).toContain("prefers calls to email");
  });

  test("the user gets no card", () => {
    expect(entityReminder("Quill Ostrander here", loadKnownEntities())).toBeNull();
  });

  test("a prompt naming nobody known adds nothing", () => {
    expect(entityReminder("refactor the parser", loadKnownEntities())).toBeNull();
  });

  test("the prompt context carries the card, and the setting turns it off", async () => {
    expect(await getPromptContext("is Brightmoor billing on time?")).toContain(
      "**Brightmoor Kft.**"
    );
    writeSettings({ dynamicContext: { entityCards: false } });
    expect(await getPromptContext("is Brightmoor billing on time?")).not.toContain(
      "Brightmoor Kft."
    );
  });
});

describe("latestNote", () => {
  test("takes the newest source section without its header, marker or attributes", () => {
    const body = [
      "### 2026-01-01 — a",
      "<!-- src:a -->",
      "old note",
      "",
      "### 2026-02-01 — b",
      "<!-- src:b -->",
      "role: subject · importance: primary",
      "",
      "**new** note",
    ].join("\n");
    expect(latestNote(body)).toBe("new note");
  });
});

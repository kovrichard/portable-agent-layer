import { beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkBashCommand, checkFilePath } from "../src/safety/security";

beforeEach(() => {
  process.env.PAL_HOME = join(homedir(), ".pal");
});

describe("a shell command that only reads the PAL home", () => {
  test.each([
    "cd ~/.pal/work/projects/portable-agent-layer && ls",
    "jq -r '.alpha' ~/.pal/bindings.json",
    "sed -n 1,20p ~/.pal/telos/GOALS.md",
    "awk '{print $1}' ~/.pal/memory/state/progress/tree.json",
    "F=~/.pal/work/projects/x/tickets.jsonl; jq -R . $F",
    "grep -h blocked ~/.pal/records/bronze/event-text/2026-11.jsonl | python3 -c 'import sys; print(len(sys.stdin.read()))'",
    "cat ~/.pal/bindings.json 2>/dev/null > /tmp/copy.json",
    "cp ~/.pal/bindings.json /tmp/bindings.json",
    `python3 -c "import json; print(json.load(open('${join(homedir(), ".pal", "bindings.json")}')))"`,
    "cd ~/.pal/memory && bun -e 'console.log((await Bun.file(\"x.json\").text()).length)'",
  ])("passes: %s", (command) => {
    expect(checkBashCommand(command)).toBeNull();
  });
});

describe("a shell command that writes the PAL home", () => {
  test.each([
    "echo '{}' > ~/.pal/bindings.json",
    "echo x >> ~/.pal/telos/GOALS.md",
    "sed -i 's/a/b/' ~/.pal/telos/GOALS.md",
    "rm ~/.pal/state/sync/account.key",
    "mv ~/.pal/bindings.json /tmp/b.json",
    "cp /tmp/b.json ~/.pal/bindings.json",
    "jq . x | tee ~/.pal/bindings.json",
    "rm 2>/dev/null ~/.pal/bindings.json",
    "cd ~/.pal/work/projects && rm -rf portable-agent-layer",
    "ls ~/.pal/memory | xargs rm",
    "find ~/.pal/memory -name '*.tmp' -delete",
    'python3 -c \'open("/x/.pal/a","w")\' ~/.pal/bindings.json',
    "rm -rf ~/.pal",
    `python3 - <<'PY'\np="${join(homedir(), ".pal", "memory", "relationship", "n.md")}"\ns=open(p).read()\nopen(p,"w").write(s.replace("a","b"))\nPY`,
    'cd ~/.pal/memory && bun -e \'await Bun.write("x.json", "{}")\'',
  ])("is refused: %s", (command) => {
    expect(checkBashCommand(command)).toMatch(/PAL's own data|managed by 'pal install'/);
  });
});

describe("what is still written by hand", () => {
  test("a personal skill and a subagent", () => {
    expect(
      checkFilePath(join(homedir(), ".pal", "skills", "mine", "SKILL.md"))
    ).toBeNull();
    expect(checkFilePath(join(homedir(), ".pal", "agents", "helper.md"))).toBeNull();
    expect(checkBashCommand("echo x > ~/.pal/skills/mine/notes.md")).toBeNull();
    expect(checkBashCommand("cd ~/.pal/skills/mine && rm old.md")).toBeNull();
  });

  test("anything outside the PAL home", () => {
    expect(checkBashCommand("cd /tmp && rm -rf build")).toBeNull();
    expect(checkBashCommand("echo x > ./notes.md")).toBeNull();
  });
});

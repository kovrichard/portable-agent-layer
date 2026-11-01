#!/usr/bin/env bun

// presentation skill — set up a brand template.
// Interactive Q&A by default; flag-driven for non-interactive use (Claude / scripts).
//
// Usage:
//   bun setup-template.ts                                    # interactive
//   bun setup-template.ts --name <slug> --logo <path> --primary "#0E1335" [--accent "#..."] \
//     [--footer "..."] [--logo-placement footer] [--fonts system] [--aspect 16:9] \
//     [--showcase] [--yes]

import { spawn } from "node:child_process";
import { constants as fsConst } from "node:fs";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { TEMPLATES_ROOT } from "./lib/paths";
import { type Aspect, type LogoPlacement, registerTemplate } from "./lib/registry";

type Args = Partial<{
  name: string;
  path: string;
  logo: string;
  primary: string;
  accent: string;
  footer: string;
  logoPlacement: LogoPlacement;
  fonts: string;
  aspect: Aspect;
  showcase: boolean;
  yes: boolean;
}>;

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    const next = argv[i + 1];
    switch (cur) {
      case "--name":
        a.name = next;
        i++;
        break;
      case "--path":
        a.path = next;
        i++;
        break;
      case "--logo":
        a.logo = next;
        i++;
        break;
      case "--primary":
        a.primary = next;
        i++;
        break;
      case "--accent":
        a.accent = next;
        i++;
        break;
      case "--footer":
        a.footer = next;
        i++;
        break;
      case "--logo-placement":
        a.logoPlacement = next as LogoPlacement;
        i++;
        break;
      case "--fonts":
        a.fonts = next;
        i++;
        break;
      case "--aspect":
        a.aspect = next as Aspect;
        i++;
        break;
      case "--showcase":
        a.showcase = true;
        break;
      case "--yes":
      case "-y":
        a.yes = true;
        break;
    }
  }
  return a;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

// HSL hue rotation by 180° → suggested complementary; brighten lightness for dark primaries
// so a deep navy gives a warm/light accent rather than another dark colour.
function hslOf(r: number, g: number, b: number): { H: number; S: number; L: number } {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let H = 0,
    S = 0;
  const L = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) H = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) H = (b - r) / d + 2;
    else H = (r - g) / d + 4;
    H *= 60;
  }
  return { H, S, L };
}

function hueSector(H: number, c: number, x: number): [number, number, number] {
  if (H < 60) return [c, x, 0];
  if (H < 120) return [x, c, 0];
  if (H < 180) return [0, c, x];
  if (H < 240) return [0, x, c];
  if (H < 300) return [x, 0, c];
  return [c, 0, x];
}

function complementary(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const hsl = hslOf(r, g, b);
  const H = (hsl.H + 180) % 360;
  const newL = Math.min(0.78, Math.max(0.5, hsl.L + 0.35));
  const newS = Math.max(hsl.S, 0.55);
  const c = (1 - Math.abs(2 * newL - 1)) * newS;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = newL - c / 2;
  const [rr, gg, bb] = hueSector(H, c, x);
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
}

async function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
  const p = def ? `${q} [${def}] ` : `${q} `;
  const ans = (await rl.question(p)).trim();
  return ans || def || "";
}

type Prompter = readline.Interface | null;

interface TemplateSettings {
  name: string;
  tplPath: string;
  logo: string;
  primary: string;
  accent: string;
  footer: string;
  logoPlacement: LogoPlacement;
  fonts: string;
  aspect: Aspect;
  showcase: boolean | undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function askUntilValid(
  rl: readline.Interface,
  question: string,
  isValid: (answer: string) => boolean | Promise<boolean>,
  errorFor: (answer: string) => string
): Promise<string> {
  while (true) {
    const answer = await ask(rl, question);
    if (await isValid(answer)) return answer;
    console.error(errorFor(answer));
  }
}

async function askOr(
  given: string | undefined,
  rl: Prompter,
  question: string,
  def: string
): Promise<string> {
  return given ?? (rl ? await ask(rl, question, def) : def);
}

async function resolveChoice<T extends string>(
  given: T | undefined,
  rl: Prompter,
  question: string,
  options: readonly T[],
  fallback: T
): Promise<T> {
  if (given || !rl) return given ?? fallback;
  const answer = await ask(rl, question, fallback);
  return (options as readonly string[]).includes(answer) ? (answer as T) : fallback;
}

async function resolveName(args: Args, rl: Prompter): Promise<string> {
  const name =
    args.name ||
    (rl
      ? await askUntilValid(
          rl,
          "Template name (slug, e.g. 'my-company'):",
          (s) => /^[a-z0-9][a-z0-9-]*$/.test(s),
          () => "  ✘ name must be lowercase alphanumerics + dashes"
        )
      : "");
  if (!name) fail("--name required");
  return name;
}

async function resolveTemplatePath(args: Args, rl: Prompter, name: string) {
  const defaultPath = join(TEMPLATES_ROOT, name);
  if (args.path) return resolve(args.path);
  if (rl) return resolve(await ask(rl, "Storage path:", defaultPath));
  return defaultPath;
}

async function resolveLogo(args: Args, rl: Prompter): Promise<string> {
  const given =
    args.logo ||
    (rl
      ? await askUntilValid(
          rl,
          "Logo file path (.svg preferred, .png ok):",
          async (s) => s !== "" && (await exists(resolve(s))),
          (s) => `  ✘ file not found: ${s}`
        )
      : "");
  if (!given) fail("--logo required");
  const logo = resolve(given);
  if (!(await exists(logo))) fail(`logo not found: ${logo}`);
  return logo;
}

async function resolvePrimary(args: Args, rl: Prompter): Promise<string> {
  const primary =
    args.primary ||
    (rl
      ? await askUntilValid(
          rl,
          "Primary brand color (hex, e.g. #0E1335):",
          isHex,
          () => "  ✘ must be 6-digit hex like #0E1335"
        )
      : "");
  if (!primary || !isHex(primary)) fail("--primary must be hex like #0E1335");
  return primary;
}

async function resolveAccent(args: Args, rl: Prompter, primary: string) {
  const suggested = complementary(primary);
  const accent =
    args.accent ||
    (rl ? await ask(rl, `Accent color (hex) [derived: ${suggested}]:`, suggested) : "");
  return accent && isHex(accent) ? accent : suggested;
}

async function resolveShowcase(args: Args, rl: Prompter) {
  if (args.showcase !== undefined || !rl) return args.showcase;
  const answer = await ask(
    rl,
    "Generate showcase deck demonstrating every layout? (y/n):",
    "n"
  );
  return answer.toLowerCase().startsWith("y");
}

async function collectSettings(args: Args, rl: Prompter): Promise<TemplateSettings> {
  const name = await resolveName(args, rl);
  const tplPath = await resolveTemplatePath(args, rl, name);
  const logo = await resolveLogo(args, rl);
  const primary = await resolvePrimary(args, rl);
  const accent = await resolveAccent(args, rl, primary);
  const footer = await askOr(args.footer, rl, "Footer text (blank for none):", "");
  const logoPlacement = await resolveChoice<LogoPlacement>(
    args.logoPlacement,
    rl,
    "Logo placement [cover-only / footer / both / none]:",
    ["cover-only", "footer", "both", "none"],
    "footer"
  );
  const fonts = await askOr(
    args.fonts,
    rl,
    "Fonts ['system' or Google Fonts URL]:",
    "system"
  );
  const aspect = await resolveChoice<Aspect>(
    args.aspect,
    rl,
    "Aspect ratio [16:9 / 4:3 / 16:10]:",
    ["16:9", "4:3", "16:10"],
    "16:9"
  );
  const showcase = await resolveShowcase(args, rl);
  return {
    name,
    tplPath,
    logo,
    primary,
    accent,
    footer,
    logoPlacement,
    fonts,
    aspect,
    showcase,
  };
}

function printSummary(s: TemplateSettings): void {
  console.log("\nSummary:");
  console.log(`  name           ${s.name}`);
  console.log(`  path           ${s.tplPath}`);
  console.log(`  logo           ${s.logo}`);
  console.log(`  primary        ${s.primary}`);
  console.log(`  accent         ${s.accent}`);
  console.log(`  footer         ${s.footer || "(none)"}`);
  console.log(`  logoPlacement  ${s.logoPlacement}`);
  console.log(`  fonts          ${s.fonts}`);
  console.log(`  aspect         ${s.aspect}`);
  console.log(`  showcase       ${s.showcase ? "yes" : "no"}`);
}

async function confirmWrite(rl: readline.Interface): Promise<void> {
  const ok = (await rl.question("\nWrite template? (y/n) [y]: ")).trim().toLowerCase();
  if (ok && !ok.startsWith("y")) {
    console.log("aborted");
    rl.close();
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = !(args.name && args.logo && args.primary);
  const rl = interactive ? readline.createInterface({ input, output }) : null;
  const settings = await collectSettings(args, rl);

  if (rl) {
    printSummary(settings);
    if (!args.yes) await confirmWrite(rl);
    rl.close();
  }

  await writeTemplate(settings);
  const { name, tplPath, showcase } = settings;
  console.log(`\n✓ template "${name}" registered`);
  console.log(`  path: ${tplPath}`);

  if (showcase) await createShowcaseDeck(tplPath, name);

  console.log(
    `\nNext: pal cli skill run presentation new-deck <deck-dir> --template ${name}`
  );
}

async function writeTemplate(settings: TemplateSettings): Promise<void> {
  const { name, tplPath, logo, primary, accent, footer, logoPlacement, fonts, aspect } =
    settings;
  await mkdir(tplPath, { recursive: true });
  const ext = extname(logo).toLowerCase() || ".svg";
  await copyFile(logo, join(tplPath, `logo${ext}`));

  // template.css
  const css = `/* template: ${name} — generated by setup-template.ts */
:root {
  --brand-primary: ${primary};
  --brand-accent:  ${accent};
}
`;
  await writeFile(join(tplPath, "template.css"), css, "utf8");

  // template.yml
  const yml = `# template: ${name}
primary: "${primary}"
accent: "${accent}"
footer: ${JSON.stringify(footer)}
logoPlacement: ${logoPlacement}
logo: "logo${ext}"
fonts: ${JSON.stringify(fonts)}
aspect: "${aspect}"
`;
  await writeFile(join(tplPath, "template.yml"), yml, "utf8");

  // Register
  await registerTemplate({
    name,
    path: tplPath,
    meta: { primary, accent, footer, logoPlacement, fonts, aspect },
  });
}

async function createShowcaseDeck(tplPath: string, name: string): Promise<void> {
  const showcaseDir = join(tplPath, "showcase-deck");
  const newDeckScript = fileURLToPath(new URL("./new-deck.ts", import.meta.url));
  await new Promise<void>((res, rej) => {
    const p = spawn(
      "bun",
      [
        newDeckScript,
        showcaseDir,
        "--template",
        name,
        "--showcase",
        "--title",
        `${name} — showcase`,
      ],
      { stdio: "inherit" }
    );
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`new-deck exited ${code}`))
    );
  });
  console.log(`\n  showcase deck: ${showcaseDir}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

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
function complementary(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
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
  H = (H + 180) % 360;
  const newL = Math.min(0.78, Math.max(0.5, L + 0.35));
  const newS = Math.max(S, 0.55);
  const c = (1 - Math.abs(2 * newL - 1)) * newS;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = newL - c / 2;
  let [rr, gg, bb] = [0, 0, 0];
  if (H < 60) [rr, gg, bb] = [c, x, 0];
  else if (H < 120) [rr, gg, bb] = [x, c, 0];
  else if (H < 180) [rr, gg, bb] = [0, c, x];
  else if (H < 240) [rr, gg, bb] = [0, x, c];
  else if (H < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = !(args.name && args.logo && args.primary);
  const rl = interactive ? readline.createInterface({ input, output }) : null;

  // 1. Name
  let name = args.name;
  if (!name && rl) {
    while (true) {
      name = await ask(rl, "Template name (slug, e.g. 'my-company'):");
      if (/^[a-z0-9][a-z0-9-]*$/.test(name)) break;
      console.error("  ✘ name must be lowercase alphanumerics + dashes");
    }
  }
  if (!name) {
    console.error("--name required");
    process.exit(1);
  }

  // 2. Path
  const defaultPath = join(TEMPLATES_ROOT, name);
  const tplPath = args.path
    ? resolve(args.path)
    : rl
      ? resolve(await ask(rl, "Storage path:", defaultPath))
      : defaultPath;

  // 3. Logo
  let logo = args.logo;
  if (!logo && rl) {
    while (true) {
      logo = (await rl.question("Logo file path (.svg preferred, .png ok): ")).trim();
      if (logo && (await exists(resolve(logo)))) break;
      console.error(`  ✘ file not found: ${logo}`);
    }
  }
  if (!logo) {
    console.error("--logo required");
    process.exit(1);
  }
  logo = resolve(logo);
  if (!(await exists(logo))) {
    console.error(`logo not found: ${logo}`);
    process.exit(1);
  }

  // 4. Primary
  let primary = args.primary;
  if (!primary && rl) {
    while (true) {
      primary = (await rl.question("Primary brand color (hex, e.g. #0E1335): ")).trim();
      if (isHex(primary)) break;
      console.error("  ✘ must be 6-digit hex like #0E1335");
    }
  }
  if (!primary || !isHex(primary)) {
    console.error("--primary must be hex like #0E1335");
    process.exit(1);
  }

  // 5. Accent — default = derived complementary
  const suggested = complementary(primary);
  let accent = args.accent;
  if (!accent && rl) {
    accent = await ask(rl, `Accent color (hex) [derived: ${suggested}]:`, suggested);
    if (!isHex(accent)) accent = suggested;
  }
  if (!accent || !isHex(accent)) accent = suggested;

  // 6. Footer
  const footer =
    args.footer ?? (rl ? await ask(rl, "Footer text (blank for none):", "") : "");

  // 7. Logo placement
  let logoPlacement = args.logoPlacement;
  if (!logoPlacement && rl) {
    const a = await ask(
      rl,
      "Logo placement [cover-only / footer / both / none]:",
      "footer"
    );
    logoPlacement = (
      ["cover-only", "footer", "both", "none"].includes(a) ? a : "footer"
    ) as LogoPlacement;
  }
  if (!logoPlacement) logoPlacement = "footer";

  // 8. Fonts
  const fonts =
    args.fonts ??
    (rl ? await ask(rl, "Fonts ['system' or Google Fonts URL]:", "system") : "system");

  // 9. Aspect
  let aspect = args.aspect;
  if (!aspect && rl) {
    const a = await ask(rl, "Aspect ratio [16:9 / 4:3 / 16:10]:", "16:9");
    aspect = (["16:9", "4:3", "16:10"].includes(a) ? a : "16:9") as Aspect;
  }
  if (!aspect) aspect = "16:9";

  // 10. Showcase deck?
  let showcase = args.showcase;
  if (showcase === undefined && rl) {
    const a = (
      await ask(rl, "Generate showcase deck demonstrating every layout? (y/n):", "n")
    ).toLowerCase();
    showcase = a.startsWith("y");
  }

  if (rl) {
    console.log("\nSummary:");
    console.log(`  name           ${name}`);
    console.log(`  path           ${tplPath}`);
    console.log(`  logo           ${logo}`);
    console.log(`  primary        ${primary}`);
    console.log(`  accent         ${accent}`);
    console.log(`  footer         ${footer || "(none)"}`);
    console.log(`  logoPlacement  ${logoPlacement}`);
    console.log(`  fonts          ${fonts}`);
    console.log(`  aspect         ${aspect}`);
    console.log(`  showcase       ${showcase ? "yes" : "no"}`);
    if (!args.yes) {
      const ok = (await rl.question("\nWrite template? (y/n) [y]: "))
        .trim()
        .toLowerCase();
      if (ok && !ok.startsWith("y")) {
        console.log("aborted");
        rl.close();
        process.exit(1);
      }
    }
    rl.close();
  }

  // Write template files
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

  console.log(`\n✓ template "${name}" registered`);
  console.log(`  path: ${tplPath}`);

  if (showcase) {
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

  console.log(
    `\nNext: bun ~/.pal/skills/presentation/tools/new-deck.ts <deck-dir> --template ${name}`
  );
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

/**
 * The check a report passes before it can leave the machine. It blocks rather
 * than strips: a found identifier names its line, so the text is rewritten and
 * the user sees why.
 */

import { spawnSync } from "node:child_process";
import { homedir, hostname, userInfo } from "node:os";
import { basename } from "node:path";
import { normalizeRemote, PAL_REPO_URL } from "../core/remote";
import { raw } from "../core/settings";
import { list } from "../knowledge/lib";
import { readAllProjects } from "../progress/projects";

export interface Identifiers {
  home: string;
  words: { kind: string; value: string }[];
}

export interface Leak {
  line: number;
  kind: string;
  found: string;
}

const PAL_REMOTE = normalizeRemote(PAL_REPO_URL);
const MIN_WORD = 3;

const SECRET_SHAPES: [string, RegExp][] = [
  ["secret", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ["secret", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["secret", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["secret", /\bAKIA[0-9A-Z]{16}\b/],
  ["secret", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["secret", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["secret", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PLACEHOLDER_EMAIL = /@(?:example\.(?:com|org)|users\.noreply\.github\.com)$/i;

/** A name generic enough to be an ordinary word ("health", "lab") would block every report. */
function isDistinctive(name: string): boolean {
  return /[-_.\d]/.test(name) || name.length >= 8;
}

function gitConfig(key: string): string {
  const res = spawnSync("git", ["config", "--global", key], { encoding: "utf-8" });

  return res.status === 0 ? res.stdout.trim() : "";
}

function projectWords(): { kind: string; value: string }[] {
  return readAllProjects()
    .filter((project) => project.remote !== PAL_REMOTE)
    .flatMap((project) => [
      ...(isDistinctive(project.name) ? [{ kind: "project", value: project.name }] : []),
      ...(project.path ? [{ kind: "project", value: basename(project.path) }] : []),
      ...(project.remote ? [{ kind: "remote", value: project.remote }] : []),
    ])
    .filter((word) => isDistinctive(word.value));
}

function knownPeopleAndCompanies(): { kind: string; value: string }[] {
  return [...list("People"), ...list("Companies")].map((entity) => ({
    kind: "person-or-company",
    value: entity.frontmatter.title,
  }));
}

export function machineIdentifiers(
  gitConfigOf: (key: string) => string = gitConfig
): Identifiers {
  const people = [raw().identity?.principal?.name ?? "", gitConfigOf("user.name")];

  return {
    home: homedir(),
    words: [
      { kind: "user-name", value: userInfo().username },
      { kind: "host-name", value: hostname() },
      ...people.map((value) => ({ kind: "user-name", value })),
      { kind: "email", value: gitConfigOf("user.email") },
      ...projectWords(),
      ...knownPeopleAndCompanies(),
    ].filter((word) => word.value.length >= MIN_WORD),
  };
}

export function withHomeAsTilde(text: string, home: string): string {
  return home ? text.split(home).join("~") : text;
}

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordFound(line: string, value: string): boolean {
  return new RegExp(String.raw`(?<![\w-])${escaped(value)}(?![\w-])`, "i").test(line);
}

function leaksInLine(line: string, ids: Identifiers): { kind: string; found: string }[] {
  const words = ids.words.filter((word) => wordFound(line, word.value));
  const email = EMAIL.exec(line)?.[0];
  const emails =
    email && !PLACEHOLDER_EMAIL.test(email) ? [{ kind: "email", value: email }] : [];
  const secrets = SECRET_SHAPES.filter(([, shape]) => shape.test(line)).map(([kind]) => ({
    kind,
    value: "a token",
  }));
  const home =
    ids.home && line.includes(ids.home) ? [{ kind: "home-path", value: ids.home }] : [];

  return [...home, ...words, ...emails, ...secrets].map((hit) => ({
    kind: hit.kind,
    found: hit.value,
  }));
}

function oncePerLine(leaks: Leak[]): Leak[] {
  const seen = new Set<string>();

  return leaks.filter((leak) => {
    const key = `${leak.line}|${leak.found.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

export function findLeaks(text: string, ids: Identifiers): Leak[] {
  return oncePerLine(
    text
      .split("\n")
      .flatMap((line, index) =>
        leaksInLine(line, ids).map((hit) => ({ line: index + 1, ...hit }))
      )
  );
}

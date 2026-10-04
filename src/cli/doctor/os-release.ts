import { readFileSync } from "node:fs";

export type LinuxFamily = "debian" | "fedora" | "arch" | "alpine" | "suse";

export function osReleaseField(osRelease: string, key: string): string {
  return osRelease.match(new RegExp(String.raw`^${key}="?([^"\n]*)"?$`, "m"))?.[1] ?? "";
}

export function linuxFamily(osRelease: string): LinuxFamily | null {
  const ids = `${osReleaseField(osRelease, "ID")} ${osReleaseField(osRelease, "ID_LIKE")}`
    .split(/\s+/)
    .filter(Boolean);
  const families: [LinuxFamily, string[]][] = [
    ["debian", ["debian", "ubuntu"]],
    ["fedora", ["fedora", "rhel", "centos"]],
    ["arch", ["arch"]],
    ["alpine", ["alpine"]],
    ["suse", ["suse", "opensuse"]],
  ];
  return families.find(([, names]) => names.some((n) => ids.includes(n)))?.[0] ?? null;
}

export function readOsRelease(): string {
  if (process.platform !== "linux") return "";
  try {
    return readFileSync("/etc/os-release", "utf-8");
  } catch {
    return "";
  }
}

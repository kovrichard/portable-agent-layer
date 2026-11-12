import {
  type Domain,
  getOrCreate,
  RELATION_TYPES,
  type Related,
  type RelationType,
  STATUSES,
  type Status,
} from "../tools/knowledge/lib";
import { UsageError } from "../tools/lib/command";

interface AddFlags {
  tags: string[];
  related: Related[];
  quality?: number;
  status?: Status;
  type?: string;
  body?: string;
}

interface AddFlagValues {
  tags?: string;
  related?: string[];
  quality?: string;
  status?: string;
  type?: string;
  body?: string;
}

function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

function isRelationType(s: string): s is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(s);
}

function parseRelatedFlag(value: string): Related {
  const [slug, type] = value.split(":");
  if (!slug || !type) {
    throw new UsageError(`--related must be slug:type, got "${value}"`);
  }

  if (!isRelationType(type)) {
    throw new UsageError(
      `--related type must be one of: ${RELATION_TYPES.join(", ")} (got "${type}")`
    );
  }

  return { slug, type };
}

function parseQuality(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 0 || quality > 10) {
    throw new UsageError("--quality must be an integer 0-10");
  }

  return quality;
}

function parseStatus(value: string | undefined): Status | undefined {
  if (value === undefined) return undefined;

  if (!isStatus(value))
    throw new UsageError(`--status must be one of: ${STATUSES.join(", ")}`);

  return value;
}

export function parseAddFlags(values: AddFlagValues): AddFlags {
  const tags = (values.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    tags,
    related: (values.related ?? []).map(parseRelatedFlag),
    quality: parseQuality(values.quality),
    status: parseStatus(values.status),
    type: values.type,
    body: values.body,
  };
}

export async function cmdAdd(
  domain: Domain,
  name: string,
  given: AddFlags,
  anyFlagGiven: boolean
): Promise<number> {
  let flags = given;

  if (!anyFlagGiven && process.stdin.isTTY) {
    const enriched = await runInteractiveAdd(flags);
    if (enriched === null) return 1;
    flags = enriched;
  }

  const entity = getOrCreate({
    domain,
    name,
    tags: flags.tags,
    related: flags.related,
    quality: flags.quality,
    status: flags.status,
    type: flags.type,
    body: flags.body,
  });
  console.log(`✓ ${entity.domain}/${entity.slug} — "${entity.frontmatter.title}"`);

  return 0;
}

async function runInteractiveAdd(prefilled: AddFlags): Promise<AddFlags | null> {
  const clack = await import("@clack/prompts");
  clack.intro("Add knowledge entry");
  const tagsInput = await clack.text({
    message: "Tags (comma-separated, optional):",
    placeholder: "ai, research",
  });
  if (clack.isCancel(tagsInput)) {
    clack.cancel("Cancelled");

    return null;
  }

  const tags = String(tagsInput || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const statusSel = await clack.select({
    message: "Status:",
    options: STATUSES.map((s) => ({ value: s, label: s })),
    initialValue: prefilled.status ?? "seedling",
  });
  if (clack.isCancel(statusSel)) {
    clack.cancel("Cancelled");

    return null;
  }

  const qualityInput = await clack.text({
    message: "Quality (0-10):",
    placeholder: "5",
    initialValue: String(prefilled.quality ?? 5),
  });
  if (clack.isCancel(qualityInput)) {
    clack.cancel("Cancelled");

    return null;
  }

  clack.outro("Saved");

  return {
    ...prefilled,
    tags: prefilled.tags.length ? prefilled.tags : tags,
    status: statusSel as Status,
    quality: Number(qualityInput),
  };
}

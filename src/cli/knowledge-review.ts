import type { ReviewItem } from "../hooks/lib/entity-extraction";
import { renderProfile } from "../hooks/lib/entity-research";
import {
  type AcceptChoice,
  acceptReview,
  pendingReviews,
  rejectReview,
} from "../hooks/lib/entity-review";
import { group, leaf, UsageError } from "../tools/lib/command";

export const reviewCommand = group({
  summary: "People and companies the background extractor would not guess",
  fallback: "list",
  commands: {
    list: leaf({ summary: "Show what waits for an answer", run: cmdReviewList }),
    accept: leaf({
      summary: "Write an item, to an existing entry (--as) or a new one",
      args: "<id>",
      options: {
        as: {
          type: "string",
          value: "<slug>",
          description: "Existing entry to update",
        },
        name: {
          type: "string",
          value: "<name>",
          description: "Name for a new entry (default: as extracted)",
        },
      },
      run: ({ positionals, values }) =>
        cmdReviewAccept(positionals[0], { as: values.as, name: values.name }),
    }),
    reject: leaf({
      summary: "Drop an item without writing it",
      args: "<id>",
      run: ({ positionals }) => cmdReviewReject(positionals[0]),
    }),
  },
});

function reviewReason(reason: ReviewItem["reason"]): string {
  const reasons: Record<ReviewItem["reason"], string> = {
    ambiguous: "could be more than one known entry",
    "unknown-existing": "named an entry the store does not have",
    "first-name-only": "first name only",
    "web-profile": "found on the web",
  };

  return reasons[reason];
}

function reviewDetails(item: ReviewItem): string[] {
  if (item.profile)
    return [
      item.entity.existing ? `for ${item.entity.existing}` : "as a new entry",
      ...renderProfile(item.profile).split("\n"),
    ];
  const candidates =
    item.candidates.length > 0 ? [`could be: ${item.candidates.join(", ")}`] : [];

  return [item.entity.fact, ...candidates, `from ${item.source}`];
}

function reviewLines(item: ReviewItem): string[] {
  const { kind, name } = item.entity;

  return [
    `  ${item.id}  ${kind} "${name}" — ${reviewReason(item.reason)}`,
    ...reviewDetails(item)
      .filter(Boolean)
      .map((line) => `            ${line}`),
  ];
}

function cmdReviewList(): number {
  const items = pendingReviews();
  if (items.length === 0) {
    console.log("Nothing waits for review.");

    return 0;
  }

  console.log(`\n${items.length} waiting for review\n`);

  for (const item of items) console.log(reviewLines(item).join("\n"));
  console.log(
    "\nAccept: pal cli knowledge review accept <id> [--as <slug>] [--name <name>]\nReject: pal cli knowledge review reject <id>\n"
  );

  return 0;
}

function acceptOrExplain(id: string, choice: AcceptChoice) {
  try {
    return acceptReview(id, choice);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}

function cmdReviewAccept(id: string, choice: AcceptChoice): number {
  const accepted = acceptOrExplain(id, choice);
  if (!accepted) throw new UsageError(`no review item "${id}"`);
  const verb = accepted.created ? "Created" : "Updated";
  console.log(`${verb} ${accepted.slug} from "${accepted.item.entity.name}".`);

  return 0;
}

function cmdReviewReject(id: string): number {
  const rejected = rejectReview(id);
  if (!rejected) throw new UsageError(`no review item "${id}"`);
  console.log(`Dropped "${rejected.entity.name}".`);

  return 0;
}

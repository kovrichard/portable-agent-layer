import { storeMoveMigration } from "./store-move";

export const v15WorkStores = storeMoveMigration(
  "v15-work-stores",
  "Move projects, the progress tree, unbound history, task ISAs and schedules to work/",
  ["project-history", "unbound-history", "progress-tree", "task-isas", "schedules"]
);

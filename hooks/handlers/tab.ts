/**
 * Stop handler: resets terminal tab title to default.
 */

import { setTabTitle } from "../lib/notify";

export async function resetTab(): Promise<void> {
  setTabTitle("claude");
}

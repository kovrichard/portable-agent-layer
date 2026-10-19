/**
 * Official company registers, routed by country. A company is looked up only in the
 * register of the country its name places it in; any other name goes to web search
 * alone. To add a country, implement CompanyRegister in its own module and add it to
 * REGISTERS.
 */

import type { CompanyRegister, Fetch, RegisterEntry } from "./company-register";
import { hungarianRegister } from "./hungarian-registry";

const REGISTERS: CompanyRegister[] = [hungarianRegister];

/** Null when no register recognizes the name, and when its register has no exact match. */
export async function lookupCompanyRegister(
  name: string,
  fetchImpl: Fetch = fetch,
  registers: CompanyRegister[] = REGISTERS
): Promise<RegisterEntry | null> {
  const wanted = name.trim();
  const register = registers.find((r) => r.recognizes(wanted));
  if (!register) return null;
  const company = await register.lookup(wanted, fetchImpl);
  return company && { ...company, country: register.country };
}

/** What a country's company register implements to join the routing table in company-register-router.ts. */

export interface RegisteredCompany {
  name: string;
  fullName: string;
  number: string;
  taxNumber: string;
  seat: string;
  status: string;
  activity: string;
  founded: string;
  managers: string[];
  url: string;
  sources: string[];
}

export type RegisterEntry = RegisteredCompany & { country: string };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CompanyRegister {
  country: string;
  recognizes: (name: string) => boolean;
  lookup: (name: string, fetchImpl: Fetch) => Promise<RegisteredCompany | null>;
}

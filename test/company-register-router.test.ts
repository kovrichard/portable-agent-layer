import { describe, expect, test } from "bun:test";
import type {
  CompanyRegister,
  RegisteredCompany,
} from "../src/hooks/lib/company-register";
import { lookupCompanyRegister } from "../src/hooks/lib/company-register-router";

const COMPANY: RegisteredCompany = {
  name: "Brightmoor Lighting Oy",
  fullName: "",
  number: "0000000-0",
  taxNumber: "",
  seat: "",
  status: "",
  activity: "",
  founded: "",
  managers: [],
  url: "https://register.example/0000000-0",
  sources: [],
};

function register(
  country: string,
  suffix: string,
  found: RegisteredCompany | null = COMPANY
) {
  const asked: string[] = [];
  const row: CompanyRegister = {
    country,
    recognizes: (name) => name.endsWith(suffix),
    lookup: async (name) => {
      asked.push(name);
      return found;
    },
  };
  return { row, asked };
}

const noFetch = async () => {
  throw new Error("a register row does its own fetching");
};

describe("routing a company to its country's register", () => {
  test("the first register that recognizes the name looks it up, and its country is stamped", async () => {
    const finland = register("Finland", " Oy");
    const anyOy = register("Elsewhere", "Oy");
    expect(
      await lookupCompanyRegister("Brightmoor Lighting Oy", noFetch, [
        finland.row,
        anyOy.row,
      ])
    ).toEqual({ ...COMPANY, country: "Finland" });
    expect(finland.asked).toEqual(["Brightmoor Lighting Oy"]);
    expect(anyOy.asked).toEqual([]);
  });

  test("a name no register recognizes is looked up nowhere", async () => {
    const finland = register("Finland", " Oy");
    expect(
      await lookupCompanyRegister("Brightmoor Ltd.", noFetch, [finland.row])
    ).toBeNull();
    expect(finland.asked).toEqual([]);
  });

  test("a register with no exact match is no entry", async () => {
    const finland = register("Finland", " Oy", null);
    expect(
      await lookupCompanyRegister("Brightmoor Lighting Oy", noFetch, [finland.row])
    ).toBeNull();
  });

  test("the name is trimmed before it is recognized and looked up", async () => {
    const finland = register("Finland", " Oy");
    await lookupCompanyRegister("  Brightmoor Lighting Oy ", noFetch, [finland.row]);
    expect(finland.asked).toEqual(["Brightmoor Lighting Oy"]);
  });

  test("Hungary is a row in the shipped table", async () => {
    expect(await lookupCompanyRegister("Brightmoor GmbH", noFetch)).toBeNull();
    await expect(lookupCompanyRegister("Brightmoor Kft.", noFetch)).rejects.toThrow(
      "a register row does its own fetching"
    );
  });
});

import { describe, expect, test } from "bun:test";
import {
  isHungarianCompanyName,
  lookupHungarianCompany,
} from "../src/hooks/lib/hungarian-registry";

const HOME = `<form action="https://ceginfo.hu/cegkereso/rapid" method="post">
<input type="hidden" name="ceginfo_csrf_token" value="tok123"></form>`;

const hit = (slug: string, number: string, name: string) => `
<div class="talat my-3">
  <a href="https://ceginfo.hu//ceg-adatlap/${slug}-${number}.html">
    <div class="col"><h2 class="s-title heading ">${name}<small>2019</small></h2>
    <p class="text my-2">4024 Debrecen, Példa utca 1.</p></div>
  </a>
</div>`;

const RECORD = `<h6>Rövidített név</h6>
<p class="fw-bold m-0">Brightmoor Világítás Kft.</p>
<h6 class="mb-0 mt-4">Teljes név</h6>
<p class="fw-bold m-0">Brightmoor Világítás Korlátolt Felelősségű Társaság</p>
<h6 class="mt-4 mb-0">Alapítás éve</h6>
<p class="fw-bold m-0">2019</p>
<h6 class="mt-4 mb-0">Adószám</h6>
<p class="fw-bold m-0">00000000-2-09</p>
<h6 class="mt-4 mb-0">Főtevékenység</h6>
<p class="fw-bold m-0">2740 Villamos világítóeszköz gyártása</p>
<h6 class="mt-4 mb-0">székhely</h6>
<p class="fw-bold m-0">4024 Debrecen, Példa utca 1.</p>
<h3 class="h6 card-title">Cégjegyzésre jogosultak</h3>
<ul class="list-unstyled small">
  <li><span><strong class="me-3"> Pratt Odo </strong>
  (an: Minta Anna) ügyvezető (vezető tisztségviselő) 4025 Debrecen, Otthon utca 2.</span></li>
</ul>
<h3 class="h6 card-title">üzletkötési javaslat</h3>
<p class="small">A lekérdezett cég jelenleg nem áll felszámolási/végelszámolási/csőd-/törlési eljárás alatt.</p>`;

const RECORD_URL = "https://www.nemzeticegtar.hu/brightmoor-vilagitas-kft-e10000000.html";

interface Seen {
  url: string;
  method: string;
  cookie: string;
  body: string;
}

function registrySites(results: string) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      method: init?.method ?? "GET",
      cookie: headers.get("cookie") ?? "",
      body: String(init?.body ?? ""),
    });
    if (url === "https://ceginfo.hu/")
      return new Response(HOME, { headers: { "set-cookie": "ci_session=abc; path=/" } });
    if (url.endsWith("/cegkereso/rapid"))
      return new Response(null, {
        status: 303,
        headers: { location: "https://ceginfo.hu/ceglista/cegek" },
      });
    if (url === "https://ceginfo.hu/ceglista/cegek") return new Response(results);
    if (url.startsWith("https://www.nemzeticegtar.hu/brightmoor-vilagitas-kft-c"))
      return new Response(null, { status: 301, headers: { location: RECORD_URL } });
    if (url === RECORD_URL) return new Response(RECORD);
    return new Response("not found", { status: 404 });
  };
  return { seen, fetchImpl };
}

const ONE_HIT = hit(
  "brightmoor-vilagitas-kft",
  "0909000000",
  "Brightmoor Világítás Kft."
);

describe("which names are Hungarian companies", () => {
  test.each([
    "Brightmoor Világítás Kft.",
    "Brightmoor Kft",
    "Corran Zrt.",
    "Alder Nyrt.",
    "Birch Bt.",
    "Cedar Kkt.",
    "Brightmoor Világítás Korlátolt Felelősségű Társaság",
    "Corran Zártkörűen Működő Részvénytársaság",
  ])("%s is", (name) => {
    expect(isHungarianCompanyName(name)).toBe(true);
  });

  test.each([
    "Brightmoor",
    "Brightmoor Ltd.",
    "Brightmoor GmbH",
    "Brightmoor Inc.",
    "Kft Analytics",
    "Brightmoorkft",
  ])("%s is not", (name) => {
    expect(isHungarianCompanyName(name)).toBe(false);
  });
});

describe("looking a company up in the Hungarian register", () => {
  test("a non-Hungarian name is never looked up", async () => {
    const { seen, fetchImpl } = registrySites(ONE_HIT);
    expect(await lookupHungarianCompany("Brightmoor Ltd.", fetchImpl)).toBeNull();
    expect(seen).toEqual([]);
  });

  test("the exact name resolves to its number, and the record fills in the rest", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    expect(await lookupHungarianCompany("Brightmoor Világítás Kft.", fetchImpl)).toEqual({
      name: "Brightmoor Világítás Kft.",
      fullName: "Brightmoor Világítás Korlátolt Felelősségű Társaság",
      number: "09-09-000000",
      taxNumber: "00000000-2-09",
      seat: "4024 Debrecen, Példa utca 1.",
      status:
        "A lekérdezett cég jelenleg nem áll felszámolási/végelszámolási/csőd-/törlési eljárás alatt.",
      activity: "2740 Villamos világítóeszköz gyártása",
      founded: "2019",
      managers: ["Pratt Odo"],
      url: RECORD_URL,
      sources: [
        "https://ceginfo.hu/ceg-adatlap/brightmoor-vilagitas-kft-0909000000.html",
        RECORD_URL,
      ],
    });
  });

  test("an officer's mother's name and home address are not kept", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    const entry = await lookupHungarianCompany("Brightmoor Világítás Kft.", fetchImpl);
    const kept = JSON.stringify(entry);
    expect(kept).not.toContain("Minta Anna");
    expect(kept).not.toContain("Otthon utca");
  });

  test("the spelled-out legal form matches the short one", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    const entry = await lookupHungarianCompany(
      "Brightmoor Világítás Korlátolt Felelősségű Társaság",
      fetchImpl
    );
    expect(entry?.number).toBe("09-09-000000");
  });

  test("the search is posted with its token, inside the session the home page opened", async () => {
    const { seen, fetchImpl } = registrySites(ONE_HIT);
    await lookupHungarianCompany("Brightmoor Világítás Kft.", fetchImpl);
    const search = seen.find((s) => s.url.endsWith("/cegkereso/rapid"));
    expect(search).toMatchObject({ method: "POST", cookie: "ci_session=abc" });
    expect(search?.body).toContain("ceginfo_csrf_token=tok123");
    expect(seen.find((s) => s.url.endsWith("/ceglista/cegek"))?.cookie).toBe(
      "ci_session=abc"
    );
  });

  test("a similar name is not taken for the company", async () => {
    const { fetchImpl } = registrySites(
      hit(
        "brightmoor-vilagitas-plusz-kft",
        "0909000001",
        "Brightmoor Világítás Plusz Kft."
      )
    );
    expect(
      await lookupHungarianCompany("Brightmoor Világítás Kft.", fetchImpl)
    ).toBeNull();
  });

  test("no hit is no entry", async () => {
    const { fetchImpl } = registrySites("<div class='talalatok'></div>");
    expect(
      await lookupHungarianCompany("Brightmoor Világítás Kft.", fetchImpl)
    ).toBeNull();
  });

  test("a site that is down fails loudly rather than reading as no company", async () => {
    const down = async () => new Response("busy", { status: 503 });
    await expect(
      lookupHungarianCompany("Brightmoor Világítás Kft.", down)
    ).rejects.toThrow("HTTP 503");
  });
});

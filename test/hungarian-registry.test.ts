import { describe, expect, test } from "bun:test";
import { lookupCompanyRegister } from "../src/hooks/lib/company-register-router";
import { hungarianRegister } from "../src/hooks/lib/hungarian-registry";

const HOME = `<form action="https://ceginfo.hu/cegkereso/rapid" method="post">
<input type="hidden" name="ceginfo_csrf_token" value="tok123"></form>`;

const hit = (slug: string, number: string, name: string) => `
<div class="talat my-3">
  <a href="https://ceginfo.hu//ceg-adatlap/${slug}-${number}.html" class="talat-link">
    <div class="col"><h2 class="s-title heading ">${name}<small class="ms-2">2019</small></h2>
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
<p class="fw-bold m-0">2740 Villamos vil&#225;g&#xED;t&#243;eszk&#246;z gy&#225;rt&#225;sa</p>
<h6 class="mt-4 mb-0">székhely</h6>
<p class="fw-bold m-0"><span>4024 Debrecen,</span>
      Példa utca 1.</p>
<h3 class="h6 card-title">Cégjegyzésre jogosultak</h3>
<ul class="list-unstyled small">
  <li><span><strong class="me-3"> Pratt Odo </strong>
  (an: Minta Anna) ügyvezető (vezető tisztségviselő) 4025 Debrecen, Otthon utca 2.</span></li>
</ul>
<h3 class="h6 card-title">üzletkötési javaslat</h3>
<p class="small">A lekérdezett cég jelenleg nem áll felszámolási/végelszámolási/csőd-/törlési eljárás alatt.</p>`;

const RECORD_URL = "https://www.nemzeticegtar.hu/brightmoor-vilagitas-kft-e10000000.html";
const RECORD_BY_NUMBER_RE =
  /^https:\/\/www\.nemzeticegtar\.hu\/[a-z0-9-]+-c\d{10}\.html$/;

interface Seen {
  url: string;
  method: string;
  cookie: string;
  body: string;
}

function registrySites(results: string, home = HOME, record = RECORD) {
  const seen: Seen[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.redirect !== "manual")
      throw new Error("redirects must be followed by hand");
    const headers = new Headers(init.headers);
    seen.push({
      url,
      method: init.method ?? "",
      cookie: headers.get("cookie") ?? "",
      body: String(init.body ?? ""),
    });
    if (url === "https://ceginfo.hu/")
      return new Response(home, {
        headers: [
          ["set-cookie", "ci_session=abc; path=/"],
          ["set-cookie", "lang=hu; path=/"],
        ],
      });
    if (url.endsWith("/cegkereso/rapid"))
      return new Response(null, {
        status: 303,
        headers: { location: "/ceglista/cegek" },
      });
    if (url === "https://ceginfo.hu/ceglista/cegek") return new Response(results);
    if (RECORD_BY_NUMBER_RE.test(url))
      return new Response(null, { status: 301, headers: { location: RECORD_URL } });
    if (url === RECORD_URL) return new Response(record);
    return new Response("not found", { status: 404 });
  };
  return { seen, fetchImpl };
}

const NAME = "Brightmoor Világítás Kft.";
const ONE_HIT = hit("brightmoor-vilagitas-kft", "0909000000", NAME);

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
    expect(hungarianRegister.recognizes(name)).toBe(true);
  });

  test.each([
    "Brightmoor",
    "Brightmoor Ltd.",
    "Brightmoor GmbH",
    "Brightmoor Inc.",
    "Kft Analytics",
    "Brightmoorkft",
    "Korlátolt Felelősségű Társaság Partners",
    "Zártkörűen Működő Részvénytársaság Group",
    "Nyilvánosan Működő Részvénytársaság Fund",
    "Betéti Társaság Partners",
    "Közkereseti Társaság Studio",
  ])("%s is not", (name) => {
    expect(hungarianRegister.recognizes(name)).toBe(false);
  });
});

describe("looking a company up in the Hungarian register", () => {
  test("a non-Hungarian name is never looked up", async () => {
    const { seen, fetchImpl } = registrySites(ONE_HIT);
    expect(await lookupCompanyRegister("Brightmoor Ltd.", fetchImpl)).toBeNull();
    expect(seen).toEqual([]);
  });

  test("the exact name resolves to its number, and the record fills in the rest", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    expect(await lookupCompanyRegister(NAME, fetchImpl)).toEqual({
      country: "Hungary",
      name: NAME,
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

  test("a name with spaces around it still resolves", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    expect((await lookupCompanyRegister(`  ${NAME} `, fetchImpl))?.number).toBe(
      "09-09-000000"
    );
  });

  test("an officer's mother's name and home address are not kept", async () => {
    const { fetchImpl } = registrySites(ONE_HIT);
    const kept = JSON.stringify(await lookupCompanyRegister(NAME, fetchImpl));
    expect(kept).not.toContain("Minta Anna");
    expect(kept).not.toContain("Otthon utca");
  });

  test.each([
    ["Korlátolt Felelősségű Társaság", "Kft."],
    ["Zártkörűen Működő Részvénytársaság", "Zrt."],
    ["Nyilvánosan Működő Részvénytársaság", "Nyrt."],
    ["Betéti Társaság", "Bt."],
    ["Közkereseti Társaság", "Kkt."],
  ])("the spelled-out %s matches %s", async (long, short) => {
    const { fetchImpl } = registrySites(
      hit("brightmoor-vilagitas", "0909000000", `Brightmoor Világítás ${short}`)
    );
    const entry = await lookupCompanyRegister(`Brightmoor Világítás ${long}`, fetchImpl);
    expect(entry?.number).toBe("09-09-000000");
  });

  test("entities in a listed name are read as the characters they stand for", async () => {
    const listed = "Brightmoor &amp; Társa &quot;Fény&quot;&nbsp;Kft.";
    const { fetchImpl } = registrySites(hit("brightmoor-es-tarsa", "0909000002", listed));
    const entry = await lookupCompanyRegister(
      'Brightmoor & Társa "Fény" Kft.',
      fetchImpl
    );
    expect(entry?.name).toBe('Brightmoor & Társa "Fény" Kft.');
  });

  test("the search is posted with its token, inside the session the home page opened", async () => {
    const { seen, fetchImpl } = registrySites(ONE_HIT);
    await lookupCompanyRegister(NAME, fetchImpl);
    expect(seen.map((s) => s.method)).toEqual(["GET", "POST", "GET", "GET", "GET"]);
    const search = seen[1];
    expect(search.cookie).toBe("ci_session=abc; lang=hu");
    expect(search.body).toContain("ceginfo_csrf_token=tok123");
    expect(seen[2]).toMatchObject({
      url: "https://ceginfo.hu/ceglista/cegek",
      cookie: "ci_session=abc; lang=hu",
    });
  });

  test("a home page with no search token is an error, not an empty result", async () => {
    const { fetchImpl } = registrySites(ONE_HIT, "<form></form>");
    await expect(lookupCompanyRegister(NAME, fetchImpl)).rejects.toThrow(
      "ceginfo.hu: the search form has no token"
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
    expect(await lookupCompanyRegister(NAME, fetchImpl)).toBeNull();
  });

  test("two companies listed under the exact name are not told apart by guessing", async () => {
    const { fetchImpl } = registrySites(
      ONE_HIT + hit("brightmoor-vilagitas-kft", "1309000003", NAME)
    );
    expect(await lookupCompanyRegister(NAME, fetchImpl)).toBeNull();
  });

  test("no hit is no entry", async () => {
    const { fetchImpl } = registrySites("<div class='talalatok'></div>");
    expect(await lookupCompanyRegister(NAME, fetchImpl)).toBeNull();
  });

  test("a record missing fields leaves them empty", async () => {
    const sparse = `<h6>Teljes név</h6><p>Brightmoor Világítás Korlátolt Felelősségű Társaság</p>`;
    const { fetchImpl } = registrySites(ONE_HIT, HOME, sparse);
    expect(await lookupCompanyRegister(NAME, fetchImpl)).toMatchObject({
      taxNumber: "",
      seat: "",
      status: "",
      activity: "",
      founded: "",
      managers: [],
    });
  });

  test("a site that is down fails loudly rather than reading as no company", async () => {
    const down = async () => new Response("busy", { status: 503 });
    await expect(lookupCompanyRegister(NAME, down)).rejects.toThrow("HTTP 503");
  });

  test("a redirect that never ends is cut off after five hops", async () => {
    let requests = 0;
    const loop = async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location: "/again" } });
    };
    await expect(lookupCompanyRegister(NAME, loop)).rejects.toThrow(
      "https://ceginfo.hu/: too many redirects"
    );
    expect(requests).toBe(6);
  });

  test("only a redirect status is followed, whatever headers a page carries", async () => {
    const urls: string[] = [];
    const located = (status: number) => async (url: string) => {
      urls.push(url);
      return new Response(HOME, { status, headers: { location: "/elsewhere" } });
    };
    await expect(lookupCompanyRegister(NAME, located(404))).rejects.toThrow("HTTP 404");
    urls.length = 0;
    expect(await lookupCompanyRegister(NAME, located(200))).toBeNull();
    expect(urls).toEqual(["https://ceginfo.hu/", "https://ceginfo.hu/cegkereso/rapid"]);
  });
});

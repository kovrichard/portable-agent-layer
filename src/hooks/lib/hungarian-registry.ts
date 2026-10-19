/**
 * The Hungarian company register, read directly. Web search does not index it, so a
 * young or small Kft. is invisible to a search-only lookup. Only a name ending in a
 * Hungarian legal form is looked up: ceginfo.hu resolves the exact name to its
 * registration number, nemzeticegtar.hu shows the record for free.
 */

export interface HungarianRegistryEntry {
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

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Page {
  url: string;
  html: string;
}

const CEGINFO = "https://ceginfo.hu/";
const NEMZETICEGTAR = "https://www.nemzeticegtar.hu/";
const USER_AGENT = "Mozilla/5.0 (compatible; PAL knowledge research)";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const SEARCH_TOKEN_RE = /name="ceginfo_csrf_token" value="([^"]+)"/;
const OFFICERS_RE = /Cégjegyzésre jogosultak<\/h3>([\s\S]*?)<\/ul>/;
const PROCEEDINGS_RE = /<p[^>]*>([^<]*(?:felszámolási|végelszámolási)[^<]*)<\/p>/;

const LONG_FORMS: Array<[RegExp, string]> = [
  [/korlátolt felelősségű társaság$/i, "kft"],
  [/zártkörűen működő részvénytársaság$/i, "zrt"],
  [/nyilvánosan működő részvénytársaság$/i, "nyrt"],
  [/betéti társaság$/i, "bt"],
  [/közkereseti társaság$/i, "kkt"],
];
const SHORT_FORM_RE = /(?:^|\s)(?:kft|zrt|nyrt|bt|kkt|rt)\.?$/i;

export function isHungarianCompanyName(name: string): boolean {
  const trimmed = name.trim();
  return SHORT_FORM_RE.test(trimmed) || LONG_FORMS.some(([re]) => re.test(trimmed));
}

function comparable(name: string): string {
  const short = LONG_FORMS.reduce((n, [re, form]) => n.replace(re, form), name.trim());
  return short.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

function decoded(html: string): string {
  return html.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith("#x"))
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function plainText(html: string): string {
  return decoded(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function remember(response: Response, jar: Map<string, string>): void {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
}

/** One browsing session: cookies carried across requests and redirects followed by hand,
 *  because a search result lives in the session the search was posted from. */
function session(fetchImpl: Fetch) {
  const jar = new Map<string, string>();
  return async (url: string, form?: URLSearchParams): Promise<Page> => {
    let current = url;
    let body = form;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchImpl(current, {
        method: body ? "POST" : "GET",
        body,
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      remember(response, jar);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).href;
        body = undefined;
        continue;
      }
      if (!response.ok) throw new Error(`${current}: HTTP ${response.status}`);
      return { url: current, html: await response.text() };
    }
    throw new Error(`${url}: too many redirects`);
  };
}

interface Hit {
  name: string;
  number: string;
  slug: string;
  url: string;
}

function searchHits(html: string): Hit[] {
  const results = html.matchAll(
    /<a href="([^"]*\/ceg-adatlap\/([a-z0-9-]+)-(\d{10})\.html)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g
  );
  return Array.from(results, ([, url, slug, number, title]) => ({
    name: plainText(title.replace(/<small[\s\S]*?<\/small>/g, "")),
    number,
    slug,
    url: url.replace(/(?<!:)\/\//g, "/"),
  }));
}

async function findRegistered(
  name: string,
  browse: ReturnType<typeof session>
): Promise<Hit | null> {
  const home = await browse(CEGINFO);
  const token = SEARCH_TOKEN_RE.exec(home.html)?.[1];
  if (!token) throw new Error("ceginfo.hu: the search form has no token");
  const results = await browse(
    `${CEGINFO}cegkereso/rapid`,
    new URLSearchParams({ ceginfo_csrf_token: token, rapid: name })
  );
  const exact = searchHits(results.html).filter(
    (hit) => comparable(hit.name) === comparable(name)
  );
  return exact.length === 1 ? exact[0] : null;
}

function field(html: string, label: string): string {
  const value = new RegExp(
    String.raw`<h6[^>]*>\s*${label}\s*</h6>\s*<p[^>]*>([\s\S]*?)</p>`,
    "i"
  ).exec(html)?.[1];
  return value ? plainText(value) : "";
}

/** Names only: the register also prints each officer's mother's name and home address. */
function managers(html: string): string[] {
  const block = OFFICERS_RE.exec(html)?.[1] ?? "";
  return Array.from(block.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g), ([, n]) =>
    plainText(n)
  ).filter(Boolean);
}

function proceedings(html: string): string {
  const sentence = PROCEEDINGS_RE.exec(html)?.[1];
  return sentence ? plainText(sentence) : "";
}

function formattedNumber(digits: string): string {
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

function entryFrom(hit: Hit, record: Page): HungarianRegistryEntry {
  const html = record.html;
  return {
    name: field(html, "Rövidített név") || hit.name,
    fullName: field(html, "Teljes név"),
    number: formattedNumber(hit.number),
    taxNumber: field(html, "Adószám"),
    seat: field(html, "székhely"),
    status: proceedings(html),
    activity: field(html, "Főtevékenység"),
    founded: field(html, "Alapítás éve"),
    managers: managers(html),
    url: record.url,
    sources: [hit.url, record.url],
  };
}

/** Null for a name without a Hungarian legal form, and for anything but one exact match. */
export async function lookupHungarianCompany(
  name: string,
  fetchImpl: Fetch = fetch
): Promise<HungarianRegistryEntry | null> {
  if (!isHungarianCompanyName(name)) return null;
  const browse = session(fetchImpl);
  const hit = await findRegistered(name, browse);
  if (!hit) return null;
  const record = await browse(`${NEMZETICEGTAR}${hit.slug}-c${hit.number}.html`);
  return entryFrom(hit, record);
}

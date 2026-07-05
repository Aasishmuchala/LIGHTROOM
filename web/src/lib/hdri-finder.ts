// HDRI finder (2026-07-05) — turns the recipe's `hdri_mood` line into concrete,
// real assets instead of leaving the user to browse. Poly Haven's public API
// (https://api.polyhaven.com/assets?t=hdris — CORS-open, verified from this app's
// origin) provides ~1000 HDRIs with names/categories/tags; matching happens HERE,
// deterministically, against the mood keywords — the model never invents asset
// names, so a suggestion can't 404. Poliigon has no public API, so it gets a
// prefilled search link only.
//
// The scorer is pure (node-testable); only fetchHdriIndex touches the network, is
// module-cached for the session, and fails SOFT (null) — the recipe renders fine
// without suggestions.

export interface HdriAsset {
  slug: string;
  name: string;
  categories: string[];
  tags: string[];
}

export interface HdriMatch {
  slug: string;
  name: string;
  url: string;
  score: number;
  matched: string[];
}

// Words in a mood line that carry no search signal.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "like", "for", "to", "in", "on",
  "hdri", "hdr", "sky", "environment", "env", "map", "texture", "light", "lighting",
  "look", "mood", "reach", "something", "very", "slightly", "soft", "strong",
]);

// Synonym folding so the mood vocabulary meets Poly Haven's tag vocabulary.
const SYNONYMS: Record<string, string[]> = {
  "golden": ["sunset", "sunrise", "golden hour", "evening"],
  "dusk": ["sunset", "twilight", "evening", "sunrise-sunset"],
  "dawn": ["sunrise", "morning", "sunrise-sunset"],
  "afternoon": ["morning-afternoon", "midday", "day"],
  "noon": ["midday", "morning-afternoon", "day"],
  "day": ["midday", "morning-afternoon"],
  "night": ["night", "moonlit", "stars"],
  "overcast": ["overcast", "cloudy", "grey"],
  "cloudy": ["partly cloudy", "overcast", "clouds"],
  "clouds": ["partly cloudy", "clouds"],
  "clear": ["clear", "sunny", "blue sky"],
  "sunny": ["clear", "sunny", "sun"],
  "warm": ["sunset", "sunrise", "golden hour"],
  "cool": ["blue", "overcast", "midday"],
  "interior": ["indoor"],
  "indoor": ["indoor"],
  "exterior": ["outdoor"],
  "outdoor": ["outdoor"],
  "studio": ["studio"],
  "city": ["urban", "city"],
  "urban": ["urban"],
  "rural": ["nature", "field", "countryside"],
  "nature": ["nature"],
  "haze": ["hazy", "mist", "fog"],
  "hazy": ["hazy", "mist"],
  "foggy": ["fog", "mist"],
  "storm": ["stormy", "dramatic"],
};

/** Lowercased, deduped search tokens from a mood line (stopwords dropped, synonyms folded in). */
export function tokenizeMood(mood: string): string[] {
  const base = String(mood || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const out = new Set<string>(base);
  for (const w of base) for (const syn of SYNONYMS[w] || []) out.add(syn);
  return [...out];
}

// -- scoreHdriAssets(assets, tokens): pure ranking. Category/tag hits count double a
//    plain name hit (curated labels beat name coincidences); an asset scores only if
//    at least two distinct tokens hit (one shared word is a coincidence, not a match).
export function scoreHdriAssets(
  assets: HdriAsset[],
  tokens: string[],
  limit = 5
): HdriMatch[] {
  if (!tokens.length) return [];
  const scored: HdriMatch[] = [];
  for (const a of assets) {
    const name = (a.name || "").toLowerCase();
    const cats = (a.categories || []).map((c) => c.toLowerCase());
    const tags = (a.tags || []).map((t) => t.toLowerCase());
    let score = 0;
    const matched: string[] = [];
    for (const tok of tokens) {
      let hit = 0;
      if (cats.some((c) => c.includes(tok))) hit = Math.max(hit, 2);
      if (tags.some((t) => t.includes(tok))) hit = Math.max(hit, 2);
      if (name.includes(tok)) hit = Math.max(hit, 1);
      if (hit) {
        score += hit;
        matched.push(tok);
      }
    }
    if (matched.length >= 2) {
      scored.push({ slug: a.slug, name: a.name, url: `https://polyhaven.com/a/${a.slug}`, score, matched });
    }
  }
  scored.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  return scored.slice(0, limit);
}

// -- prefilled library-search links (work even when the API is unreachable). --------
export function polyhavenSearchUrl(mood: string): string {
  return `https://polyhaven.com/hdris?s=${encodeURIComponent(tokenizeMood(mood).slice(0, 4).join(" ") || mood)}`;
}
export function poliigonSearchUrl(mood: string): string {
  return `https://www.poliigon.com/search?query=${encodeURIComponent(tokenizeMood(mood).slice(0, 4).join(" ") || mood)}`;
}

// -- fetchHdriIndex(): the Poly Haven catalogue, fetched once per session and cached
//    (~1MB, ~1s). Browser-only; returns null on ANY failure so callers fail soft. ---
let indexPromise: Promise<HdriAsset[] | null> | null = null;
export function fetchHdriIndex(fetchImpl?: typeof fetch): Promise<HdriAsset[] | null> {
  if (!indexPromise) {
    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    indexPromise = (async () => {
      if (!doFetch) return null;
      try {
        const res = await doFetch("https://api.polyhaven.com/assets?t=hdris");
        if (!res.ok) return null;
        const data = (await res.json()) as Record<
          string,
          { name?: string; categories?: string[]; tags?: string[] }
        >;
        return Object.entries(data).map(([slug, a]) => ({
          slug,
          name: a.name || slug,
          categories: Array.isArray(a.categories) ? a.categories : [],
          tags: Array.isArray(a.tags) ? a.tags : [],
        }));
      } catch {
        return null;
      }
    })();
    // A failed fetch must not poison the session — allow a retry on the next recipe.
    indexPromise.then((r) => {
      if (r === null) indexPromise = null;
    });
  }
  return indexPromise;
}

// -- findHdris(mood): fetch + tokenize + rank. [] whenever anything is unavailable. -
export async function findHdris(mood: string, limit = 5): Promise<HdriMatch[]> {
  const assets = await fetchHdriIndex();
  if (!assets) return [];
  return scoreHdriAssets(assets, tokenizeMood(mood), limit);
}

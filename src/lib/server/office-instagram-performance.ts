import "server-only";
import { instagramConnection, instagramGraph, InstagramError } from "./instagram-graph";
import { verifyOfficeInstagramIdentity } from "./office-instagram-graph";

const accountName = "tarotcelestialof";
const sampleLimit = 12;
const hour = 3_600_000;
const minAgeHours = 48;
const maxAgeDays = 90;

export type OfficeInstagramPerformancePost = {
  id: string;
  caption: string;
  permalink: string | null;
  format: string;
  published_at: string;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  interactions: number | null;
  score: number | null;
  rank: number | null;
};

export type OfficeInstagramPerformance = {
  account: string;
  checked_at: string;
  basis: "per_reach" | "interactions" | null;
  sample_limit: number;
  min_age_hours: number;
  max_age_days: number;
  posts: OfficeInstagramPerformancePost[];
  variant_source: OfficeInstagramPerformancePost | null;
};

type Account = Awaited<ReturnType<typeof instagramConnection>>;
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function postUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([\w-]+)\/?(?:[?#].*)?$/.exec(value);
  return match ? "https://www.instagram.com/" + match[1] + "/" + match[2] + "/" : null;
}

type ReadStage = "connection" | "identity" | "media" | "metrics";

const safeCodes = new Set(["NOT_CONNECTED","WRONG_ACCOUNT","WRONG_TYPE","TOKEN_EXPIRED","TOKEN_MISSING","CONNECTION_CHANGED",
  "META_OBJECT_UNAVAILABLE","META_PERMISSION","META_RATE_LIMIT","META_REJECTED","META_UNAVAILABLE","INVALID_RESPONSE"]);

export class InstagramPerformanceError extends Error {
  constructor(readonly stage: ReadStage, readonly code: string) {
    super(stage + " · " + code);
  }
}

async function readStage<T>(stage: ReadStage, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && safeCodes.has(error.code)
      ? error.code : "UNAVAILABLE";
    throw new InstagramPerformanceError(stage, code);
  }
}

const canReduceFields = (error: unknown) => error instanceof InstagramError &&
  ["META_OBJECT_UNAVAILABLE", "META_PERMISSION", "META_REJECTED"].includes(error.code);

async function ownMedia(account: Account, ids: string[], deadline: number) {
  // A verified user's /media edge establishes ownership even when the per-media username is unavailable.
  // Older grants can read the listing but reject an optional field for the entire edge.
  const primary = ids[0];
  const core = "id,caption,permalink,timestamp";
  const counters = core + ",media_type,like_count,comments_count";
  const requests = [
    { id: primary, fields: counters + ",media_product_type,username" },
    { id: primary, fields: counters },
    { id: primary, fields: core },
    ...ids.slice(1, 2).map(id => ({id,fields:counters})),
    { id: "me", fields: core },
  ];
  let last: unknown;
  for (const {id, fields} of requests) {
    if (Date.now() >= deadline) break;
    try {
      const page = await instagramGraph(account, id + "/media", {fields,limit:String(sampleLimit)}, undefined, deadline);
      if (!Array.isArray(page.data)) throw new InstagramError("INVALID_RESPONSE", "Formato de publicaciones inesperado.");
      return page.data;
    } catch (error) {
      if (!canReduceFields(error)) throw error;
      last = error;
    }
  }
  throw last || new InstagramError("META_UNAVAILABLE", "Tiempo de lectura agotado.");
}

async function optionalMetrics(account: Account, path: string, params: Record<string, string>, deadline: number) {
  if (Date.now() >= deadline) return null;
  try {
    return await instagramGraph(account, path, params, undefined, deadline);
  } catch (error) {
    if (error instanceof InstagramError && error.code === "TOKEN_EXPIRED") throw error;
    return null;
  }
}

async function readPost(account: Account, row: Record<string, unknown>, deadline: number): Promise<OfficeInstagramPerformancePost> {
  const id = String(row.id);
  let likes = count(row.like_count);
  let comments = count(row.comments_count);
  // Meta's per-media reach defaults to lifetime. The period parameter belongs to the account-level insight query.
  const insights = await optionalMetrics(account, id + "/insights", { metric: "reach" }, deadline);
  const metric = Array.isArray(insights?.data) && insights.data.find(item => item?.name === "reach" && (!item.period || item.period === "lifetime"));
  const reach = count(metric?.values?.[0]?.value ?? metric?.total_value?.value);
  if (likes === null || comments === null) {
    const fields = ["id", ...(likes === null ? ["like_count"] : []), ...(comments === null ? ["comments_count"] : [])];
    const detail = await optionalMetrics(account, id, {fields:fields.join(",")}, deadline);
    if (detail?.id === id) {
      likes ??= count(detail.like_count);
      comments ??= count(detail.comments_count);
    }
  }
  return {
    id, caption: typeof row.caption === "string" ? row.caption.slice(0, 2200) : "",
    permalink: postUrl(row.permalink),
    format: row.media_product_type === "REELS" ? "REELS" : String(row.media_type || "FEED"),
    published_at: new Date(String(row.timestamp)).toISOString(), likes, comments, reach,
    interactions: likes !== null && comments !== null ? likes + comments : null, score: null, rank: null,
  };
}

export async function readOfficeInstagramPerformance(): Promise<OfficeInstagramPerformance> {
  const account = await readStage("connection", () => instagramConnection());
  const identity = await readStage("identity", () => verifyOfficeInstagramIdentity(account));
  const now = Date.now();
  const deadline = now + 16_000;
  const media = await readStage("media", () => ownMedia(account, identity.ids, deadline));
  const seen = new Set<string>();
  const own = media.slice(0, sampleLimit).filter(row => {
    if (!row || typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id) || seen.has(row.id) ||
      (row.username != null && String(row.username).toLowerCase() !== accountName) || row.media_product_type === "STORY" ||
      !Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp) > now) return false;
    seen.add(row.id);
    return true;
  });
  const posts: OfficeInstagramPerformancePost[] = [];
  for (let start = 0; start < own.length; start += 4) {
    const batch = own.slice(start, start + 4);
    posts.push(...await readStage("metrics", () => Promise.all(batch.map(row => readPost(account, row, deadline)))));
  }
  // Compare the same two measured interactions on every ranked item. Recent
  // posts remain visible while Meta's lifetime insights may still be arriving.
  const mature = posts.filter(post => {
    const age = now - Date.parse(post.published_at);
    return post.interactions !== null && age >= minAgeHours * hour && age <= maxAgeDays * 24 * hour;
  });
  const reached = mature.filter(post => post.reach !== null && post.reach > 0);
  const basis = reached.length >= 2 ? "per_reach" : mature.length >= 2 ? "interactions" : null;
  const comparable = basis === "per_reach" ? reached : basis === "interactions" ? mature : [];
  for (const post of comparable) {
    post.score = basis === "per_reach" ? 100 * post.interactions! / post.reach! : post.interactions;
  }
  comparable.sort((a,b) => b.score! - a.score! || b.interactions! - a.interactions! || b.published_at.localeCompare(a.published_at));
  comparable.forEach((post, index) => {
    post.rank = index && post.score === comparable[index - 1].score ? comparable[index - 1].rank : index + 1;
  });
  posts.sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.published_at.localeCompare(a.published_at));
  const leader = comparable[0];
  const variant = leader && leader.score! > 0 && leader.score !== comparable[1]?.score && leader.caption.trim() ? leader : null;
  return { account: accountName, checked_at: new Date(now).toISOString(), basis, posts, variant_source: variant,
    sample_limit: sampleLimit, min_age_hours: minAgeHours, max_age_days: maxAgeDays };
}

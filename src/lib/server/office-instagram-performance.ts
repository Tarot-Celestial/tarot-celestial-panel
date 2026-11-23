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

async function ownMedia(account: Account, ids: string[], deadline: number) {
  for (const id of ids) {
    try {
      const page = await instagramGraph(account, id + "/media", {
        fields: "id,username,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
        limit: String(sampleLimit),
      }, undefined, deadline);
      if (!Array.isArray(page.data)) throw new Error("Instagram no devolvió la lista de publicaciones.");
      return page.data;
    } catch (error) {
      // Instagram Login can return two verified representations of the same account.
      if (id === ids[ids.length - 1] || !(error instanceof InstagramError) ||
        !["META_OBJECT_UNAVAILABLE", "META_REJECTED"].includes(error.code)) throw error;
    }
  }
  throw new Error("Instagram no devolvió la cuenta profesional.");
}

async function readPost(account: Account, row: Record<string, unknown>, deadline: number): Promise<OfficeInstagramPerformancePost> {
  const id = String(row.id);
  const likes = count(row.like_count);
  const comments = count(row.comments_count);
  let reach: number | null = null;
  try {
    const insights = await instagramGraph(account, id + "/insights", { metric: "reach", period: "lifetime" }, undefined, deadline);
    const metric = Array.isArray(insights.data) && insights.data.find(item => item?.name === "reach" && (!item.period || item.period === "lifetime"));
    reach = count(metric?.values?.[0]?.value ?? metric?.total_value?.value);
  } catch (error) {
    // Insights has its own permission. A failed reach read cannot erase actual
    // likes and comments. An invalid credential does invalidate the report.
    if (!(error instanceof InstagramError) || error.code === "TOKEN_EXPIRED") throw error;
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
  const account = await instagramConnection();
  const identity = await verifyOfficeInstagramIdentity(account);
  const now = Date.now();
  const deadline = now + 16_000;
  const media = await ownMedia(account, identity.ids, deadline);
  const seen = new Set<string>();
  const own = media.slice(0, sampleLimit).filter(row => {
    if (!row || typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id) || seen.has(row.id) ||
      String(row.username || "").toLowerCase() !== accountName || row.media_product_type === "STORY" ||
      !Number.isFinite(Date.parse(row.timestamp)) || Date.parse(row.timestamp) > now) return false;
    seen.add(row.id);
    return true;
  });
  const posts: OfficeInstagramPerformancePost[] = [];
  for (let start = 0; start < own.length; start += 4) {
    posts.push(...await Promise.all(own.slice(start, start + 4).map(row => readPost(account, row, deadline))));
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

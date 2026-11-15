// Parses the csst.at HTMX answer for one player into a LeetifyProfile.
//
// Pure JS with no native or Electron dependencies: it runs in the app and inside the Hero sidecar
// (hero-runtime/, started with its own Node 22), so keep it free of imports other than types.

import type { LeetifyProfile } from "./leetify";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the end index (`>`) of an HTML tag starting at `start` (`html[start] === "<"`),
 * respecting single- and double-quoted attribute values in linear time (no regex backtracking).
 */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Everything between the opening and closing tag of the element with this id, markup included. Elements of the same
 * name inside it are skipped when looking for where it ends. null when there is no such element.
 */
function innerHtmlOf(html: string, id: string): string | null {
  const idAttr = `id="${id}"`;
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const idPos = html.indexOf(idAttr, searchFrom);
    if (idPos === -1) return null;
    const tagStart = html.lastIndexOf("<", idPos);
    if (tagStart === -1) {
      searchFrom = idPos + idAttr.length;
      continue;
    }
    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1 || idPos > tagEnd) {
      searchFrom = idPos + idAttr.length;
      continue;
    }
    const openTag = html.slice(tagStart, tagEnd + 1);
    const nameMatch = /^<([A-Za-z][\w-]*)\b/.exec(openTag);
    if (!nameMatch) {
      searchFrom = tagEnd + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    const contentStart = tagEnd + 1;
    let depth = 1;
    let pos = contentStart;
    while (pos < html.length) {
      const lt = html.indexOf("<", pos);
      if (lt === -1) return null;
      const gt = findTagEnd(html, lt);
      if (gt === -1) return null;
      const rawTag = html.slice(lt + 1, gt);
      const isClose = rawTag.startsWith("/");
      const candidate = (isClose ? rawTag.slice(1) : rawTag).match(/^([A-Za-z][\w-]*)\b/)?.[1]?.toLowerCase();
      if (candidate === tag) {
        if (isClose) depth--;
        else if (!rawTag.endsWith("/")) depth++;
        if (depth === 0) return html.slice(contentStart, lt);
      }
      pos = gt + 1;
    }
    return null;
  }
  return null;
}

/**
 * The visible text of the element with this id: its tags and their attributes are dropped, so a number that is markup
 * rather than a stat is never read as one (csst.at wraps some stats in a "compare with pros" button that holds an icon
 * with `stroke-width="1.75"` and a data-pro-distribution attribute full of numbers).
 */
function textOf(html: string, id: string): string | null {
  const inner = innerHtmlOf(html, id);
  if (inner === null) return null;
  let out = "";
  let pos = 0;
  while (pos < inner.length) {
    const lt = inner.indexOf("<", pos);
    if (lt === -1) {
      out += inner.slice(pos);
      break;
    }
    out += inner.slice(pos, lt);
    const gt = findTagEnd(inner, lt);
    if (gt === -1) {
      out += inner.slice(lt);
      break;
    }
    out += " ";
    pos = gt + 1;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Parse csst.at HTMX HTML response into a LeetifyProfile.
 * Pure JS function — no native dependencies, works in any Node version.
 */
export function parseCsstAtHtml(html: string, steamId: string): LeetifyProfile | null {
  if (!html || !steamId) return null;

  const textFor = (key: string) => textOf(html, `leetify-${key}-${steamId}`);

  /** The last number of the element's text ("585ms" is 585, "8.58°" is 8.58). */
  const getValue = (key: string): number | null => {
    const numbers = textFor(key)?.match(/[-+]?\d*\.?\d+/g);
    return numbers?.length ? parseFloat(numbers[numbers.length - 1]) : null;
  };

  /** The last percentage of the element's text ("HS kills 41.4%" is 41.4). */
  const getPercent = (key: string): number | null => {
    const pcts = textFor(key)?.match(/[\d.]+%/g);
    return pcts?.length ? parseFloat(pcts[pcts.length - 1]) : null;
  };

  /**
   * A percentage from the tooltip inside the element, found by its label so the order doesn't matter:
   * `data-tip="Spotted enemy: 29.9% / Head: 15.6%"`. null when the label isn't there.
   */
  const getLabelled = (key: string, label: string): number | null => {
    const inner = innerHtmlOf(html, `leetify-${key}-${steamId}`);
    const m = inner && new RegExp(`(?:^|[^\\w])${escapeRegExp(label)}:\\s*([\\d.]+)\\s*%`, "i").exec(inner);
    return m ? parseFloat(m[1]) : null;
  };

  const getGames = (): number | null => {
    const n = parseInt(textFor("games") ?? "", 10);
    return Number.isFinite(n) ? n : null;
  };

  const aim = getValue("aim");
  const utility = getValue("utility");
  const rating = getValue("rating");
  const preaim = getValue("preaim");
  const reactionTime = getValue("reaction-time");
  const headshots = getPercent("headshots");
  const accuracy = getPercent("accuracy");
  // The accuracy element's tooltip carries the other two accuracy stats under Leetify's own names.
  const spottedAccuracy = getLabelled("accuracy", "Spotted enemy");
  const headAccuracy = getLabelled("accuracy", "Head");
  const counterStrafing = getPercent("counter-strafing");
  const games = getGames();
  // csst.at shows a percentage; the API's win rate (and PlayerMetrics.winrate) is a 0-1 fraction.
  const winPercent = getPercent("winrate");
  const winrate = winPercent === null ? null : Number((winPercent / 100).toFixed(4));

  const anyValue = [aim, utility, rating, preaim, reactionTime, headshots, accuracy, spottedAccuracy, headAccuracy, counterStrafing, games, winrate]
    .some((v) => v !== null);
  if (!anyValue) return null;

  // ranks.leetify is in website units (assess.ts: ~6.55 is a very strong player), the same units csst.at shows,
  // so it is passed through unchanged. Only ct_leetify / t_leetify and per-match ratings are fractions.
  const ranksLeetify = rating;

  return {
    steam64_id: steamId,
    name: null,
    privacy_mode: "private",
    source: "csst.at",
    total_matches: games,
    winrate,
    ranks: { leetify: ranksLeetify },
    rating: { aim, utility },
    stats: {
      preaim,
      reaction_time_ms: reactionTime,
      // csst.at's "HS kills" is the share of kills that were headshots, not Leetify's accuracy_head (the share of
      // shots that hit the head, which is the tooltip's "Head"). Stored apart, so HS kills is never shown or scored
      // as headshot accuracy.
      headshot_kill_percentage: headshots,
      accuracy_head: headAccuracy,
      accuracy_enemy_spotted: spottedAccuracy,
      spray_accuracy: accuracy,
      counter_strafing_good_shots_ratio: counterStrafing,
    },
  };
}

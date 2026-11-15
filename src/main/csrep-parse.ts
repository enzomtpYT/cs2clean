// Pure HTML parser for https://csrep.gg/player/<steamId> server-side rendered pages.

export interface CsrepProfile {
  steamId: string;
  trustScore: number | null;
  bansCount: number;
  flagsCount: number;
  cs2Hours: number | null;
  inventoryUsd: number | null;
  reactionMs: number | null;
  preaim: number | null;
  aimAccuracy: number | null;
  headAccuracy: number | null;
  statisticalTrust: number | null;
  accountFlagsScore: number | null;
  anomaliesScore: number | null;
  accountBonusPct: number | null;
  kdRatio: number | null;
  adr: number | null;
  hltvRating: number | null;
  kastPct: number | null;
  wallbangKillPct: number | null;
  smokeKillPct: number | null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Parses a rendered csrep.gg/player/<steamId> HTML document into a CsrepProfile, or null if unusable. */
export function parseCsrepHtml(html: string, steamId: string): CsrepProfile | null {
  if (!html || html.includes("_cf_chl_opt") || html.includes("challenges.cloudflare.com")) return null;
  const text = htmlToText(html);
  if (!text || /player not found/i.test(text)) return null;

  // Allow tooltip/icon text (e.g. "Trust Score ? 99 %") between the label and percentage.
  const trustMatch = text.match(/Trust Score\b[\s\S]{0,40}?(\d{1,3})\s*%/i);
  const trustScore = trustMatch ? parseNum(trustMatch[1]) : null;

  const statTrustMatch = text.match(/Statistical Trust\s+(\d{1,3})\b/i);
  const statisticalTrust = parseNum(statTrustMatch?.[1]);

  const acctFlagsMatch = text.match(/Account Flags\s+(\d{1,3})\b/i);
  const accountFlagsScore = parseNum(acctFlagsMatch?.[1]);

  const anomaliesMatch = text.match(/Anomalies\s+(\d{1,3})\b/i);
  const anomaliesScore = parseNum(anomaliesMatch?.[1]);

  const bonusMatch = text.match(/Account Bonus\s+\+?(-?\d{1,3})\s*%/i);
  const accountBonusPct = parseNum(bonusMatch?.[1]);

  // Header buttons appear before Stats Overview (e.g. "1 Ban 0 Flags 0 Bans").
  const overviewIdx = text.search(/Stats Overview/i);
  const headerSlice = overviewIdx > 0 ? text.slice(0, overviewIdx) : text.slice(0, 1200);
  const banMatches = Array.from(headerSlice.matchAll(/\b(\d+)\s+Bans?\b/gi), (m) => Number(m[1]));
  const bansCount = banMatches.length > 0 ? Math.max(...banMatches) : 0;

  const flagMatch = headerSlice.match(/\b(\d+)\s+Flags?\b/i);
  const flagsCount = flagMatch ? Number(flagMatch[1]) : 0;

  const playtimeMatch = text.match(/Playtime\s+([\d,]+(?:\.\d+)?)\s*h\b/i);
  const cs2Hours = parseNum(playtimeMatch?.[1]);

  const invMatch = text.match(/Inventory\s+\$([\d,]+(?:\.\d+)?)/i);
  const inventoryUsd = parseNum(invMatch?.[1]);

  const ttdMatch = text.match(/Time to Damage\s+(\d+)\s*ms/i);
  const reactionMs = parseNum(ttdMatch?.[1]) ?? parseNum(text.match(/Reaction Time\s+(\d+)\s*ms/i)?.[1]);

  const preaimMatch = text.match(/Preaim\s+([\d.]+)\s*°/i);
  const preaim = parseNum(preaimMatch?.[1]) ?? parseNum(text.match(/Crosshair Placement\s+([\d.]+)\s*°/i)?.[1]);

  const aimMatch = text.match(/Aim Accuracy\s+([\d.]+)\s*%/i);
  const aimAccuracy = parseNum(aimMatch?.[1]);

  const headMatch = text.match(/Head Accuracy\s+([\d.]+)\s*%/i);
  const headAccuracy = parseNum(headMatch?.[1]);

  const kdRatio = parseNum(text.match(/K\/D Ratio\s+([\d.]+)/i)?.[1]);
  const adr = parseNum(text.match(/\bADR\s+([\d.]+)/i)?.[1]);
  const hltvRating = parseNum(text.match(/HLTV Rating(?:\s*2\.0)?\s+([\d.]+)/i)?.[1]);
  const kastPct = parseNum(text.match(/\bKAST\s+([\d.]+)\s*%/i)?.[1]);
  const wallbangKillPct = parseNum(text.match(/Wallbang Kill\s*%\s+([\d.]+)\s*%/i)?.[1]);
  const smokeKillPct = parseNum(text.match(/Smoke Kill\s*%\s+([\d.]+)\s*%/i)?.[1]);

  const hasSignal =
    trustScore !== null ||
    cs2Hours !== null ||
    inventoryUsd !== null ||
    reactionMs !== null ||
    kdRatio !== null ||
    hltvRating !== null ||
    banMatches.length > 0 ||
    flagMatch !== null;
  if (!hasSignal) return null;

  return {
    steamId,
    trustScore,
    bansCount,
    flagsCount,
    cs2Hours,
    inventoryUsd,
    reactionMs,
    preaim,
    aimAccuracy,
    headAccuracy,
    statisticalTrust,
    accountFlagsScore,
    anomaliesScore,
    accountBonusPct,
    kdRatio,
    adr,
    hltvRating,
    kastPct,
    wallbangKillPct,
    smokeKillPct,
  };
}

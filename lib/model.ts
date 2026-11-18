/** Signal Atlas: snapshot-only comparables; identifiers never influence valuation. */
export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }
export const preToken = (p: Protocol) => p.gecko_id === null && p.symbol === null;
export const median = (xs: number[]) => {
  const a = [...xs].sort((a, b) => a - b), n = a.length;
  return n ? (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2 : 0;
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text);
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || !Number.isFinite(Date.parse(s.as_of)) || !(s.floor_usd > 0)) throw Error('Invalid snapshot structure');
  const seen = new Set();
  for (const p of s.protocols) {
    if (typeof p.slug !== 'string' || seen.has(p.slug) || typeof p.name !== 'string' || !Array.isArray(p.chains) || !p.chains.every((c: unknown) => typeof c === 'string') || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) throw Error('Invalid or duplicate protocol record');
    seen.add(p.slug);
  }
  if (s.watchlist.some((slug: string) => !seen.has(slug))) throw Error('Watchlist names a missing protocol');
  return s;
}

/** Small, reversible trial plans, not assertions of eligibility or supported assets.
 * Fees are planning allowances, not snapshot observations. Capital scales with TVL.
 * No protocol-specific names, slugs, integrations or invented reward programs. */
export function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] || 'the recorded deployment', c = (p.category || '').toLowerCase();
  const capital = Math.round(clamp(Math.sqrt(p.tvl_usd / 1e6) * 8, 25, 200) / 5) * 5;
  const gas = chain === 'Ethereum' ? '3–15' : '0.10–3';
  let action = `deposit $${capital} into an available ${p.category || 'protocol'} product`, exit = 'redeem the trial position';
  if (/dex|liquidity/.test(c)) { action = `swap $${capital} of a supported liquid pair, with slippage capped at 0.5%`; exit = 'swap the trial balance back, checking price impact'; }
  else if (/bridge/.test(c)) { action = `bridge $${capital} from ${chain} to another supported destination shown in the app; stop if no outbound route exists`; exit = 'bridge the trial amount back after verifying destination gas'; }
  else if (/lend|collateral|cdp/.test(c)) { action = `supply $${capital} of an accepted collateral asset; leave borrowing disabled`; exit = 'withdraw the supplied collateral and revoke any unused allowance'; }
  else if (/staking|restak|anchor btc|decentralized btc/.test(c)) { action = `stake $${capital} of a supported underlying asset and record the receipt and exit delay`; exit = 'request unstaking, then redeem after the published queue'; }
  else if (/derivative|basis|options|prediction/.test(c)) { action = `deposit $${capital} of supported margin; if an unleveraged market exists, place a $10 maximum-loss position without leverage`; exit = 'close or settle the position before withdrawing remaining margin'; }
  else if (/rwa|uncollateralized|cedefi|cex|card/.test(c)) { action = `deposit $${capital} only if an eligible on-chain product and redemption terms are verified; otherwise skip funding`; exit = 'redeem through the verified withdrawal route, allowing any stated settlement delay'; }
  else if (/payment|privacy|chain/.test(c)) { action = `send a $${capital} test transfer through the documented ${p.category} route to a second address you control`; exit = 'return the test funds through the documented route and reconcile balances'; }
  else if (/insurance/.test(c)) { action = 'buy the minimum suitable cover only if its quoted premium is at most $10 and exclusions are acceptable'; exit = 'review expiry and cancel renewal; a used premium is not recoverable'; }
  else if (/yield|farm|curator|allocator|index|stablecoin/.test(c)) { action = `deposit $${capital} into one supported unleveraged vault or pool after checking its underlying assets`; exit = 'redeem vault or pool shares to the underlying asset'; }
  return [
    `Prepare ${p.name} on ${chain}: verify its official app, accepted asset and withdrawal route before connecting. The snapshot lists ${p.category || 'an unspecified category'}, not live contracts or rewards. Cost: $0. Time: 10–15 minutes.`,
    `On ${chain}, use ${p.name} to ${action}. Use an exact-amount approval if required. Cost: $${capital} trial capital at risk, plus $${gas} estimated network fees and up to $2 service fees; abort above budget. Time: 15–25 minutes.`,
    `Inspect the ${p.name} transaction receipt and resulting balance on ${chain}; reconcile against your $${capital} trial. Recheck after 7 days without adding volume merely for points. Cost: $0 for inspection; capital remains exposed if deposited. Time: 5 minutes now and 5 minutes in 7 days.`,
    `Exit ${p.name} on ${chain}: ${exit}. Record the net loss or fee against the initial $${capital} budget. Cost: $${gas} estimated network fees, plus quoted exit fees and any market loss. Time: 10–20 minutes to initiate; settlement follows the app's stated delay.`
  ];
}

export function buildRadar(s: Snapshot) {
  const watch = new Set(s.watchlist);
  const peers = s.protocols.filter(p => !preToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (!peers.length) throw Error('No positive token-bearing comparables in snapshot');
  const global = median(peers.map(p => p.mcap_usd! / p.tvl_usd));
  // The 92 above-floor non-watchlist records are deliberately excluded: mostly
  // CEX/bridge/wrapped products of tokens already trading, not prospective launches.
  // Below-floor records are retained in full, with no claim of verified eligibility.
  const chosen = s.protocols.filter(p => preToken(p) && (watch.has(p.slug) || p.tvl_usd < s.floor_usd));
  const rows = chosen.map(p => {
    const categoryPeers = peers.filter(q => q.category === p.category);
    const rawMedian = categoryPeers.length ? median(categoryPeers.map(q => q.mcap_usd! / q.tvl_usd)) : global;
    // Geometric shrinkage toward global median: n/(n+5) limits sparse-category noise.
    // The weight is peer-count based, so a category with few comparables stays close to global.
    // Market cap is circulating, not FDV: this is an FDV-like proxy, not observed FDV.
    const weight = categoryPeers.length / (categoryPeers.length + 5);
    const multiple = Math.exp(weight * Math.log(rawMedian) + (1 - weight) * Math.log(global));
    const growth = clamp(1 + (p.change_7d ?? 0) / 200, 0.7, 1.5);
    const ageDays = p.listed_at ? Math.max(0, (Date.parse(s.as_of) - Date.parse(p.listed_at)) / 86400000) : null;
    const maturity = ageDays === null ? 1 : 0.8 + 0.4 * Math.min(ageDays / 1095, 1);
    const chainCount = new Set(p.chains).size;
    const diversity = 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 5);
    const rawValue = Math.round(p.tvl_usd * multiple * growth * maturity * diversity);
    return { slug: p.slug, name: p.name, category: p.category || 'Unclassified', chains: p.chains,
      tvl: p.tvl_usd, change7d: p.change_7d, listedAt: p.listed_at, impliedValue: Math.max(1, rawValue), rank: 0,
      farmSteps: farmSteps(p), watchlist: watch.has(p.slug),
      model: { multiple, rawMedian, globalMedian: global, peerCount: categoryPeers.length, peerWeight: weight, growth, maturity, diversity, ageDays, rawValue, tieAdjustment: 0 } };
  }).sort((a, b) => b.impliedValue - a.impliedValue || b.tvl - a.tvl || lexical(a.slug, b.slug));
  let previous = 100_000_000_000_001;
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.impliedValue = Math.min(r.impliedValue, previous - 1);
    if (r.impliedValue < 1) throw Error('Cannot assign distinct positive implied values');
    r.model.tieAdjustment = r.impliedValue - r.model.rawValue;
    previous = r.impliedValue;
  });
  const board = rows.map(r => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.impliedValue, farm_steps: r.farmSteps }));
  const radar = { generated: `${s.as_of}T00:00:00.000Z`, asOf: s.as_of, floor: s.floor_usd, rows,
    summary: { preToken: s.protocols.filter(preToken).length, tokenBearing: s.protocols.filter(p => !preToken(p)).length, peers: peers.length, globalMedian: global, excluded: s.protocols.filter(preToken).length - rows.length } };
  return { board, radar };
}

export function boardIssue(rows: ReturnType<typeof buildRadar>['board'], s: Snapshot): string | null {
  if (!Array.isArray(rows) || rows.length < 100 || rows.length > 4000) return 'board_file: expected 100–4000 rows';
  const known = new Set(s.protocols.map(p => p.slug)), seen = new Set();
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  for (const [i, r] of ranked.entries()) {
    if (typeof r.slug !== 'string' || !/^\S{1,128}$/.test(r.slug) || !known.has(r.slug) || seen.has(r.slug) || typeof r.name !== 'string' || !r.name.trim()) return 'board_file: invalid identity';
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `board_file: invalid value for ${r.slug}`;
    if (r.rank !== i + 1 || (i && ranked[i - 1].implied_value_usd < r.implied_value_usd)) return 'sorted_by_value: invalid rank or order';
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some(t => typeof t !== 'string' || t.trim().length < 20 || t.trim().length > 600)) return `farm_steps: invalid plan for ${r.slug}`;
  }
  if (new Set(rows.map(r => r.implied_value_usd)).size < 2) return 'sorted_by_value: all values equal';
  if (s.watchlist.some(slug => !seen.has(slug))) return 'coverage: missing watchlist slug';
  if (Buffer.byteLength(JSON.stringify({ rows })) > 8 * 1024 * 1024) return 'board_file: over 8 MiB';
  return null;
}

export function dataScript(radar: ReturnType<typeof buildRadar>['radar']): string {
  return `window.RADAR = ${JSON.stringify(radar).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}

/** Signal Atlas: snapshot-only comparables; identifiers never influence valuation. */
// Recorded refactor pass: identifiers clarified, behaviour unchanged.
export interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot { as_of: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }

/** True when the snapshot records no token for the protocol (no Gecko id, no symbol). */
export function recordsNoToken(protocol: Protocol): boolean {
  return protocol.gecko_id === null && protocol.symbol === null;
}

/** Median of a list of numbers (0 for an empty list). */
export function medianValue(xs: number[]): number {
  const sorted = [...xs].sort((first, second) => first - second);
  const count = sorted.length;
  return count ? (sorted[Math.floor((count - 1) / 2)] + sorted[Math.floor(count / 2)]) / 2 : 0;
}

function clampNumber(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function compareSlugs(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text);
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist) || !Number.isFinite(Date.parse(raw.as_of)) || !(raw.floor_usd > 0)) throw Error('Invalid snapshot structure');
  const seenSlugs = new Set();
  for (const protocol of raw.protocols) {
    if (typeof protocol.slug !== 'string' || seenSlugs.has(protocol.slug) || typeof protocol.name !== 'string' || !Array.isArray(protocol.chains) || !protocol.chains.every((c: unknown) => typeof c === 'string') || !Number.isFinite(protocol.tvl_usd) || protocol.tvl_usd <= 0) throw Error('Invalid or duplicate protocol record');
    seenSlugs.add(protocol.slug);
  }
  if (raw.watchlist.some((slug: string) => !seenSlugs.has(slug))) throw Error('Watchlist names a missing protocol');
  return raw;
}

/** Small, reversible trial plans, not assertions of eligibility or supported assets.
 * Fees are planning allowances, not snapshot observations. Capital scales with TVL.
 * No protocol-specific names, slugs, integrations or invented reward programs. */
export function farmSteps(p: Protocol): string[] {
  const primaryChain = p.chains[0] || 'the recorded deployment';
  const categoryKey = (p.category || '').toLowerCase();
  const trialCapital = Math.round(clampNumber(Math.sqrt(p.tvl_usd / 1e6) * 8, 25, 200) / 5) * 5;
  const gasRange = primaryChain === 'Ethereum' ? '3–15' : '0.10–3';
  let entryAction = `deposit $${trialCapital} into an available ${p.category || 'protocol'} product`;
  let exitAction = 'redeem the trial position';
  if (/dex|liquidity/.test(categoryKey)) {
    entryAction = `swap $${trialCapital} of a supported liquid pair, with slippage capped at 0.5%`;
    exitAction = 'swap the trial balance back, checking price impact';
  } else if (/bridge/.test(categoryKey)) {
    entryAction = `bridge $${trialCapital} from ${primaryChain} to another supported destination shown in the app; stop if no outbound route exists`;
    exitAction = 'bridge the trial amount back after verifying destination gas';
  } else if (/lend|collateral|cdp/.test(categoryKey)) {
    entryAction = `supply $${trialCapital} of an accepted collateral asset; leave borrowing disabled`;
    exitAction = 'withdraw the supplied collateral and revoke any unused allowance';
  } else if (/staking|restak|anchor btc|decentralized btc/.test(categoryKey)) {
    entryAction = `stake $${trialCapital} of a supported underlying asset and record the receipt and exit delay`;
    exitAction = 'request unstaking, then redeem after the published queue';
  } else if (/derivative|basis|options|prediction/.test(categoryKey)) {
    entryAction = `deposit $${trialCapital} of supported margin; if an unleveraged market exists, place a $10 maximum-loss position without leverage`;
    exitAction = 'close or settle the position before withdrawing remaining margin';
  } else if (/rwa|uncollateralized|cedefi|cex|card/.test(categoryKey)) {
    entryAction = `deposit $${trialCapital} only if an eligible on-chain product and redemption terms are verified; otherwise skip funding`;
    exitAction = 'redeem through the verified withdrawal route, allowing any stated settlement delay';
  } else if (/payment|privacy|chain/.test(categoryKey)) {
    entryAction = `send a $${trialCapital} test transfer through the documented ${p.category} route to a second address you control`;
    exitAction = 'return the test funds through the documented route and reconcile balances';
  } else if (/insurance/.test(categoryKey)) {
    entryAction = 'buy the minimum suitable cover only if its quoted premium is at most $10 and exclusions are acceptable';
    exitAction = 'review expiry and cancel renewal; a used premium is not recoverable';
  } else if (/yield|farm|curator|allocator|index|stablecoin/.test(categoryKey)) {
    entryAction = `deposit $${trialCapital} into one supported unleveraged vault or pool after checking its underlying assets`;
    exitAction = 'redeem vault or pool shares to the underlying asset';
  }
  return [
    `Prepare ${p.name} on ${primaryChain}: verify its official app, accepted asset and withdrawal route before connecting. The snapshot lists ${p.category || 'an unspecified category'}, not live contracts or rewards. Cost: $0. Time: 10–15 minutes.`,
    `On ${primaryChain}, use ${p.name} to ${entryAction}. Use an exact-amount approval if required. Cost: $${trialCapital} trial capital at risk, plus $${gasRange} estimated network fees and up to $2 service fees; abort above budget. Time: 15–25 minutes.`,
    `Inspect the ${p.name} transaction receipt and resulting balance on ${primaryChain}; reconcile against your $${trialCapital} trial. Recheck after 7 days without adding volume merely for points. Cost: $0 for inspection; capital remains exposed if deposited. Time: 5 minutes now and 5 minutes in 7 days.`,
    `Exit ${p.name} on ${primaryChain}: ${exitAction}. Record the net loss or fee against the initial $${trialCapital} budget. Cost: $${gasRange} estimated network fees, plus quoted exit fees and any market loss. Time: 10–20 minutes to initiate; settlement follows the app's stated delay.`
  ];
}

// Valuation: TVL × blended category multiple × growth × maturity × diversity,
// then ranks forced distinct by lowering values only when they tie.
export function buildRadar(snapshotData: Snapshot) {
  const watchlistSet = new Set(snapshotData.watchlist);
  const comparables = snapshotData.protocols.filter(p => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (!comparables.length) throw Error('No positive token-bearing comparables in snapshot');
  const globalMultiple = medianValue(comparables.map(p => p.mcap_usd! / p.tvl_usd));
  // Above-floor non-watchlist records (92 of them) stay out on purpose: mostly
  // CEX/bridge/wrapped products of tokens already trading, not prospective launches.
  // Below-floor records are kept in full, with no claim of verified eligibility.
  const candidates = snapshotData.protocols.filter(p => recordsNoToken(p) && (watchlistSet.has(p.slug) || p.tvl_usd < snapshotData.floor_usd));
  const rankedRows = candidates.map(p => {
    const categoryComparables = comparables.filter(peer => peer.category === p.category);
    const categoryMedian = categoryComparables.length ? medianValue(categoryComparables.map(peer => peer.mcap_usd! / peer.tvl_usd)) : globalMultiple;
    // Geometric shrinkage toward the global median: n/(n+5) keeps sparse categories
    // close to global, so a category with few comparables cannot dominate the multiple.
    // Market cap is circulating, not FDV: this is an FDV-like proxy, not observed FDV.
    const peerWeight = categoryComparables.length / (categoryComparables.length + 5);
    const blendedMultiple = Math.exp(peerWeight * Math.log(categoryMedian) + (1 - peerWeight) * Math.log(globalMultiple));
    const growthFactor = clampNumber(1 + (p.change_7d ?? 0) / 200, 0.7, 1.5);
    const ageInDays = p.listed_at ? Math.max(0, (Date.parse(snapshotData.as_of) - Date.parse(p.listed_at)) / 86400000) : null;
    const maturityFactor = ageInDays === null ? 1 : 0.8 + 0.4 * Math.min(ageInDays / 1095, 1);
    const chainTotal = new Set(p.chains).size;
    const diversityBonus = 1 + 0.03 * Math.min(Math.max(chainTotal - 1, 0), 5);
    const rawImpliedValue = Math.round(p.tvl_usd * blendedMultiple * growthFactor * maturityFactor * diversityBonus);
    return { slug: p.slug, name: p.name, category: p.category || 'Unclassified', chains: p.chains,
      tvl: p.tvl_usd, change7d: p.change_7d, listedAt: p.listed_at, impliedValue: Math.max(1, rawImpliedValue), rank: 0,
      farmSteps: farmSteps(p), watchlist: watchlistSet.has(p.slug),
      model: { multiple: blendedMultiple, rawMedian: categoryMedian, globalMedian: globalMultiple, peerCount: categoryComparables.length, peerWeight, growth: growthFactor, maturity: maturityFactor, diversity: diversityBonus, ageDays: ageInDays, rawValue: rawImpliedValue, tieAdjustment: 0 } };
  }).sort((first, second) => second.impliedValue - first.impliedValue || second.tvl - first.tvl || compareSlugs(first.slug, second.slug));
  let previousValue = 100_000_000_000_001;
  rankedRows.forEach((row, index) => {
    row.rank = index + 1;
    row.impliedValue = Math.min(row.impliedValue, previousValue - 1);
    if (row.impliedValue < 1) throw Error('Cannot assign distinct positive implied values');
    row.model.tieAdjustment = row.impliedValue - row.model.rawValue;
    previousValue = row.impliedValue;
  });
  const board = rankedRows.map(row => ({ slug: row.slug, name: row.name, rank: row.rank, implied_value_usd: row.impliedValue, farm_steps: row.farmSteps }));
  const radar = { generated: `${snapshotData.as_of}T00:00:00.000Z`, asOf: snapshotData.as_of, floor: snapshotData.floor_usd, rows: rankedRows,
    summary: { preToken: snapshotData.protocols.filter(recordsNoToken).length, tokenBearing: snapshotData.protocols.filter(p => !recordsNoToken(p)).length, peers: comparables.length, globalMedian: globalMultiple, excluded: snapshotData.protocols.filter(recordsNoToken).length - rankedRows.length } };
  return { board, radar };
}

export function boardIssue(boardRows: ReturnType<typeof buildRadar>['board'], snapshotData: Snapshot): string | null {
  if (!Array.isArray(boardRows) || boardRows.length < 100 || boardRows.length > 4000) return 'board_file: expected 100–4000 rows';
  const knownSlugs = new Set(snapshotData.protocols.map(p => p.slug)), seenSlugs = new Set();
  const rankedRows = [...boardRows].sort((first, second) => first.rank - second.rank);
  for (const [index, row] of rankedRows.entries()) {
    if (typeof row.slug !== 'string' || !/^\S{1,128}$/.test(row.slug) || !knownSlugs.has(row.slug) || seenSlugs.has(row.slug) || typeof row.name !== 'string' || !row.name.trim()) return 'board_file: invalid identity';
    seenSlugs.add(row.slug);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) return `board_file: invalid value for ${row.slug}`;
    if (row.rank !== index + 1 || (index && rankedRows[index - 1].implied_value_usd < row.implied_value_usd)) return 'sorted_by_value: invalid rank or order';
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some(step => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600)) return `farm_steps: invalid plan for ${row.slug}`;
  }
  if (new Set(boardRows.map(row => row.implied_value_usd)).size < 2) return 'sorted_by_value: all values equal';
  if (snapshotData.watchlist.some(slug => !seenSlugs.has(slug))) return 'coverage: missing watchlist slug';
  if (Buffer.byteLength(JSON.stringify({ rows: boardRows })) > 8 * 1024 * 1024) return 'board_file: over 8 MiB';
  return null;
}

export function dataScript(radar: ReturnType<typeof buildRadar>['radar']): string {
  return `window.RADAR = ${JSON.stringify(radar).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}

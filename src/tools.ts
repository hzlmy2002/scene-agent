import {ApiError, type Row, type Transport, paths, safeError} from './api.js';
import {inputs, type ToolName, type Result, monthIndex, fromIndex, windowMonths} from './schema.js';
export const descriptions: Record<ToolName, string> = {
  AIsa_similar_sites: 'Find similar website candidates for one domain. Returns domain, affinity and rank; similarity is not proof of a business competitor. Requires the latest supported end_month; fetches exactly three months. Up to 20 candidates. Use traffic_engagement for subsequent comparison. Billed AIsa API call.',
  AIsa_traffic_engagement: 'Compare 1–5 domains over the SAME explicit monthly window (1–12 months), country and total web scope. Returns aligned visits, pages/visit, duration seconds, bounce-rate fractions, missing values and endpoint growth. Estimates, not first-party analytics. No cross-period averaging of rates. Billed once per domain.',
  AIsa_geography: 'Fetch latest available worldwide traffic geography for 1–5 domains, at most 10 countries per domain. Returns country shares, visits and reported dates. Dates may differ between domains; no historical or country filter. Use only when geography is requested. Billed once per domain.',
  AIsa_website_keywords: 'Read one website keyword sample for an explicit month, US or worldwide. At most 20 keywords with clicks, traffic share, position, intent and top URL when available. The API does not expose organic/nonbranded filters or volume/difficulty; do not infer them. For comparing sites use keyword_gap. Billed API call.',
  AIsa_keyword_gap: 'Compare one target and 1–3 competitors using same-month, same-country keyword samples (max 20/site). Returns per-site evidence and deterministic position classes. competitor_only_in_sample means absent from a successful target SAMPLE, not no rankings. No organic/nonbranded filter, volume or difficulty guarantee. Does not generate content strategy. Billed once per domain.',
};
const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null => typeof v === 'string' ? v : null;
function reportedScope(body?: Row): Row {
  const source = body?.meta?.request ?? body?.meta ?? {};
  return Object.fromEntries(['domain', 'country', 'start_date', 'end_date', 'granularity', 'web_source', 'main_domain_only', 'traffic_source', 'branded_type'].filter(k => ['string', 'boolean', 'number'].includes(typeof source[k])).map(k => [k, source[k]]));
}
function rows(body: Row): Row[] {
  if (!Array.isArray(body.data)) throw new ApiError('invalid_response', 'Expected an array of data rows.');
  const flat = body.data.flat();
  if (flat.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new ApiError('invalid_response', 'Invalid data row.');
  return flat;
}
function keywords(body: Row, limit: number): Row[] {
  const seen = new Set<string>();
  return rows(body).slice(0, limit).map(r => {
    if (typeof r.keyword !== 'string' || !r.keyword.trim()) throw new ApiError('invalid_response', 'Keyword row has no keyword.');
    const key = r.keyword.normalize('NFKC').trim().toLowerCase();
    if (seen.has(key)) throw new ApiError('invalid_response', 'Duplicate normalized keyword in sample.');
    seen.add(key);
    return {keyword: r.keyword, normalized_keyword: key, clicks: numeric(r.clicks), traffic_share: numeric(r.traffic_share), position: numeric(r.position), competition: numeric(r.competition), primary_intent: text(r.primary_intent), secondary_intent: text(r.secondary_intent), top_url: text(r.top_url)};
  });
}
const metrics: Record<string, string> = {visits: 'visits', pages_per_visit: 'pages_per_visit', average_visit_duration_seconds: 'average_visit_duration', bounce_rate: 'bounce_rate'};
export async function execute(name: ToolName, raw: unknown, api: Transport, signal?: AbortSignal): Promise<Result> {
  const parsed = inputs[name].safeParse(raw);
  if (!parsed.success) throw new ApiError('invalid_input', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const a = parsed.data as Row;
  if (name === 'AIsa_traffic_engagement' && (monthIndex(a.end_month) < monthIndex(a.start_month) || monthIndex(a.end_month) - monthIndex(a.start_month) >= 12)) throw new ApiError('invalid_input', 'Traffic window must cover 1–12 consecutive months.');
  const ds: string[] = a.domains ?? (a.target_domain ? [a.target_domain, ...a.competitor_domains] : [a.domain]);
  if (new Set(ds).size !== ds.length) throw new ApiError('invalid_input', 'Target and competitor domains must all be distinct.');
  const endpoint = name === 'AIsa_traffic_engagement' ? paths.traffic : name === 'AIsa_similar_sites' ? paths.similar : name === 'AIsa_geography' ? paths.geography : paths.keywords;
  const scope = {...a}; delete scope.max_price_usd;
  if (name === 'AIsa_geography') Object.assign(scope, {country: 'ww', time: 'latest_available_per_domain'});
  else Object.assign(scope, {web_source: 'total', granularity: 'monthly'});
  if (name === 'AIsa_similar_sites') scope.start_month = fromIndex(monthIndex(a.end_month) - 2);
  if (endpoint === paths.keywords) Object.assign(scope, {traffic_source: 'upstream_default', branded_type: 'upstream_default', sample_limit: a.limit ?? a.limit_per_domain});
  const result: Result = {schema_version: '1.0.0', scope, data: [], derived: [], completeness: {status: 'complete', requested_items: ds, returned_items: [], failures: []}, provenance: [], calculation: {}, warnings: []};
  // Divide the total ceiling into integer nanodollars, rounding DOWN. No retry can spend a second slice.
  const perCallCap = a.max_price_usd === undefined ? undefined : Math.floor(a.max_price_usd * 1e9 / ds.length) / 1e9;
  if (perCallCap !== undefined && perCallCap <= 0) throw new ApiError('cost_limit_exceeded', 'Budget is too small to divide across the requested domains.');
  const records = new Map<string, Row[]>();
  const outcomes: {body?: Row; data?: Row[]; error?: ApiError; at: string}[] = new Array(ds.length);
  let cursor = 0;
  const runSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  await Promise.all(Array.from({length: Math.min(3, ds.length)}, async () => {
    while (cursor < ds.length) {
      const i = cursor++; const d = ds[i]; const at = new Date().toISOString();
      try {
        runSignal.throwIfAborted();
        let query: Row = {domain: d, country: a.country, web_source: 'total', granularity: 'monthly'};
        if (endpoint === paths.traffic) Object.assign(query, {start_date: a.start_month, end_date: a.end_month, metrics: Object.values(metrics).join(','), main_domain_only: true});
        else if (endpoint === paths.similar) Object.assign(query, {start_date: scope.start_month, end_date: a.end_month, limit: a.limit});
        else if (endpoint === paths.keywords) Object.assign(query, {start_date: a.month, end_date: a.month, limit: a.limit ?? a.limit_per_domain});
        else query = {domain: d};
        const body = await api.get(endpoint, query, perCallCap, runSignal);
        const reported = body.meta?.request ?? body.meta ?? {};
        if (endpoint !== paths.geography) {
          for (const key of ['country', 'web_source', 'start_date', 'end_date']) {
            if (typeof reported[key] === 'string' && query[key] !== undefined && (key.endsWith('date') ? reported[key].slice(0, 7) : reported[key]) !== query[key]) throw new ApiError('scope_mismatch', 'Upstream returned a different scope than requested.');
          }
        }
        let data: Row[];
        if (endpoint === paths.keywords) data = keywords(body, a.limit ?? a.limit_per_domain);
        else if (endpoint === paths.geography) {
          if (!Array.isArray(body.data?.countries)) throw new ApiError('invalid_response', 'Expected a countries array.');
          data = body.data.countries.slice(0, 10).map((r: Row) => ({country_code: text(r.country_code), country_name: text(r.country_name), share: numeric(r.share), visits: numeric(r.visits)}));
        } else if (endpoint === paths.similar) data = rows(body).slice(0, a.limit).map(r => ({domain: text(r.domain), affinity: numeric(r.affinity), rank: numeric(r.rank), category: text(r.category)}));
        else {
          const source = rows(body); const byMonth = new Map<string, Row>();
          for (const r of source) {
            const m = typeof r.date === 'string' ? r.date.slice(0, 7) : '';
            if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(m) || byMonth.has(m) || m < a.start_month || m > a.end_month) throw new ApiError('invalid_response', 'Traffic periods are missing, duplicated or outside the requested window.');
            byMonth.set(m, r);
          }
          data = source.length ? windowMonths(a.start_month, a.end_month).map(period => ({period, ...Object.fromEntries(Object.entries(metrics).map(([out, upstream]) => [out, numeric(byMonth.get(period)?.[upstream])]))})) : [];
        }
        outcomes[i] = {body, data, at};
      } catch (error) { outcomes[i] = {error: runSignal.aborted ? new ApiError('cancelled', 'Tool deadline or cancellation interrupted the operation.') : safeError(error), at}; }
    }
  }));
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i], o = outcomes[i];
    result.provenance.push({domain: d, endpoint, retrieved_at: o.at, data_as_of: text(o.body?.meta?.last_updated ?? o.body?.meta?.data_as_of), reported_scope: reportedScope(o.body), status: o.error ? 'failed' : o.data?.length ? 'success' : 'empty'});
    if (o.body?.meta?.empty_reason === 'provider_no_data') result.warnings.push(`${d}: Similarweb has no data for the requested scope. This is not an unavailable API or invalid credential.`);
    if (o.error) result.completeness.failures.push({domain: d, code: o.error.code, message: o.error.message});
    else {
      records.set(d, o.data!);
      if (o.data!.length) result.completeness.returned_items.push(d);
      if (name !== 'AIsa_keyword_gap') result.data.push(...o.data!.map(r => endpoint === paths.similar ? {seed_domain: d, ...r} : {domain: d, ...r}));
    }
  }
  if (outcomes.every(o => o.error)) throw outcomes[0].error!;
  if (endpoint === paths.traffic) {
    result.scope.main_domain_only = true;
    for (const [d, rr] of records) {
      if (!rr.length) continue;
      for (const metric of Object.keys(metrics)) {
        const first = rr[0][metric], last = rr.at(-1)![metric];
        const missing = rr.filter(r => r[metric] === null).map(r => r.period);
        if (missing.length) result.warnings.push(`${d}: ${metric} missing in ${missing.join(', ')}.`);
        result.derived.push({domain: d, metric, start_period: a.start_month, end_period: a.end_month, start_value: first, end_value: last, absolute_change: first === null || last === null ? null : last - first, relative_change: first === null || last === null || first === 0 ? null : (last - first) / first});
        if (first === 0 || first === null) result.warnings.push(`${d}: ${metric} growth is null because the baseline is zero or unknown.`);
      }
    }
    result.calculation = {algorithm_version: 'traffic-derived-v1', relative_change: '(end_value-start_value)/start_value', rate_unit: 'fraction', duration_unit: 'seconds', aggregation: 'no cross-period averaging'};
  }
  if (endpoint === paths.keywords) result.warnings.push('Top-N sample only; organic/nonbranded filters and volume/difficulty are not supported by the current AIsa contract. Competition is preserved as reported, not renamed to difficulty.');
  if (name === 'AIsa_keyword_gap') {
    const keys = new Set<string>();
    for (const d of a.competitor_domains) for (const r of records.get(d) ?? []) keys.add(r.normalized_keyword);
    for (const key of [...keys].sort()) {
      const evidence = ds.map(d => ({domain: d, sample_status: records.has(d) ? (records.get(d)!.length ? 'returned' : 'empty') : 'failed', row: records.get(d)?.find(r => r.normalized_keyword === key) ?? null}));
      const target = evidence[0].row;
      const competitors = evidence.slice(1).flatMap(e => e.row ? [e.row] : []);
      const positions = competitors.map(r => r.position).filter((p): p is number => typeof p === 'number' && p > 0);
      const best = positions.length ? Math.min(...positions) : null;
      const delta = target && target.position > 0 && best !== null ? target.position - best : null;
      // A failed or empty target response is not evidence of target absence.
      const category = !records.get(a.target_domain)?.length ? 'insufficient_data' : !target ? 'competitor_only_in_sample' : delta === null ? 'insufficient_data' : delta >= 5 ? 'target_weaker' : delta <= -5 ? 'target_stronger' : 'similar_position';
      result.data.push({keyword: competitors[0].keyword, normalized_keyword: key, category, position_delta: delta, best_competitor_position: best, evidence, max_competitor_clicks: maxKnown(competitors.map(r => r.clicks))});
    }
    const order = ['competitor_only_in_sample', 'target_weaker', 'similar_position', 'target_stronger', 'insufficient_data'];
    result.data.sort((x: Row, y: Row) => order.indexOf(x.category) - order.indexOf(y.category) || (y.max_competitor_clicks ?? -1) - (x.max_competitor_clicks ?? -1) || (x.normalized_keyword < y.normalized_keyword ? -1 : x.normalized_keyword > y.normalized_keyword ? 1 : 0));
    const targetRows = records.get(a.target_domain) ?? [];
    result.calculation = {algorithm_version: 'keyword-gap-v1', position_threshold: 5, ranking: ['category', 'max_competitor_clicks_desc_null_last', 'normalized_keyword'], target_only_in_sample: targetRows.filter(r => !keys.has(r.normalized_keyword)).length};
  }
  if (endpoint === paths.geography) result.warnings.push('Latest available per-domain snapshots may cover different months. Inspect provenance before comparing.');
  const incomplete = result.completeness.failures.length > 0 || (result.completeness.returned_items.length > 0 && result.completeness.returned_items.length < ds.length) || (endpoint === paths.traffic && result.data.some(r => Object.keys(metrics).some(m => r[m] === null)));
  result.completeness.status = incomplete ? 'partial' : result.data.length ? 'complete' : 'empty';
  return result;
}
function maxKnown(values: unknown[]) { const ns = values.map(numeric).filter((n): n is number => n !== null); return ns.length ? Math.max(...ns) : null; }

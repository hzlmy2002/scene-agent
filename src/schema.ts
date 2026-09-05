import {z} from 'zod';
import {isIP} from 'node:net';
export const domain = z.string().max(2048).transform((input, ctx) => {
  try {
    const u = new URL(input.includes('://') ? input : `https://${input}`);
    const d = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || isIP(d) || d.startsWith('[') || !d.includes('.') || /\.(localhost|local|internal|test|invalid)$/.test(d) || d.length > 253 || !d.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))) throw Error();
    return d;
  } catch { ctx.addIssue({code: 'custom', message: 'Provide a public website domain or HTTP(S) URL without credentials or port.'}); return z.NEVER; }
});
export const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const domains = z.array(domain).min(1).max(5).refine(a => new Set(a).size === a.length, 'Domains must be unique after normalization.');
const country = z.enum(['us', 'ww']).default('ww');
const cap = z.number().finite().positive().max(1_000_000).optional().describe('Optional TOTAL USD ceiling for this tool invocation, split across its planned API calls.');
const common = {country, max_price_usd: cap};
export const inputs = {
  AIsa_similar_sites: z.object({domain, end_month: month.describe('Latest supported month for Similar Sites. Requests exactly this month and the two preceding months.'), limit: z.number().int().min(1).max(20).default(10), ...common}).strict(),
  AIsa_traffic_engagement: z.object({domains, start_month: month, end_month: month, ...common}).strict(),
  AIsa_geography: z.object({domains, max_price_usd: cap}).strict(),
  AIsa_website_keywords: z.object({domain, month, limit: z.number().int().min(1).max(20).default(20), ...common}).strict(),
  AIsa_keyword_gap: z.object({target_domain: domain, competitor_domains: z.array(domain).min(1).max(3), month, limit_per_domain: z.number().int().min(1).max(20).default(20), ...common}).strict(),
};
export type ToolName = keyof typeof inputs;
export const output = z.object({
  schema_version: z.literal('1.0.0'), scope: z.record(z.unknown()),
  data: z.array(z.record(z.unknown())), derived: z.array(z.record(z.unknown())),
  completeness: z.object({status: z.enum(['complete', 'partial', 'empty']), requested_items: z.array(z.string()), returned_items: z.array(z.string()), failures: z.array(z.object({domain: z.string(), code: z.string(), message: z.string()}))}),
  provenance: z.array(z.object({domain: z.string(), endpoint: z.string(), retrieved_at: z.string(), data_as_of: z.string().nullable(), reported_scope: z.record(z.unknown()), status: z.enum(['success', 'empty', 'failed'])})),
  calculation: z.record(z.unknown()), warnings: z.array(z.string()),
});
export type Result = z.infer<typeof output>;
export function monthIndex(m: string) { const [y, n] = m.split('-').map(Number); return y * 12 + n - 1; }
export function fromIndex(i: number) { return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`; }
export function windowMonths(start: string, end: string) { return Array.from({length: monthIndex(end) - monthIndex(start) + 1}, (_, i) => fromIndex(monthIndex(start) + i)); }

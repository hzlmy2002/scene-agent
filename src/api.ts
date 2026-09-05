export type Row = Record<string, any>;
export class ApiError extends Error {
  constructor(public code: string, message: string, public retryable = false, public status?: number) { super(message); }
}
export const paths = {
  traffic: '/similarweb/website/traffic-engagement',
  similar: '/similarweb/website/similar-sites',
  keywords: '/similarweb/search/website-keywords',
  geography: '/similarweb/website-top-geographies',
} as const;
export type Endpoint = typeof paths[keyof typeof paths];
export interface Transport { get(path: Endpoint, query: Row, cap?: number, signal?: AbortSignal): Promise<Row> }
export function safeError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError('internal_error', 'The operation could not be completed.');
}
export class ApiClient implements Transport {
  constructor(private key = process.env.AISA_API_KEY, private fetcher: typeof fetch = fetch) {}
  async get(path: Endpoint, query: Row, cap?: number, signal?: AbortSignal): Promise<Row> {
    if (!this.key?.trim()) throw new ApiError('missing_credentials', 'Set AISA_API_KEY in the MCP server environment and restart the server.');
    if (!Object.values(paths).includes(path)) throw new ApiError('invalid_input', 'Unsupported API operation.');
    const url = new URL('https://api.aisa.one/apis/v1' + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {Authorization: `Bearer ${this.key.trim()}`, Accept: 'application/json'};
    if (cap !== undefined) headers['X-AISA-Max-Price-USD'] = String(cap);
    try {
      // No automatic retries: a timed-out billable request may already have succeeded.
      const response = await this.fetcher(url, {headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)});
      if (!response.ok) {
        // Inspect only a bounded error body for known gateway identifiers.
        // Never forward arbitrary provider messages (they may contain secrets).
        let gatewayError: unknown;
        let errorBody: Row | undefined;
        const errorReader = response.body?.getReader();
        if (errorReader) {
          const chunks: Uint8Array[] = []; let bytes = 0;
          try {
            while (true) {
              const {done, value} = await errorReader.read(); if (done) break;
              bytes += value.byteLength;
              if (bytes > 16_384) { await errorReader.cancel(); break; }
              chunks.push(value);
            }
            if (bytes <= 16_384) {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              errorBody = body;
              gatewayError = typeof body?.error === 'string' ? body.error : body?.error?.code;
            }
          } catch { /* Keep HTTP classification when error JSON cannot be read. */ }
          finally { errorReader.releaseLock(); }
        }
        // Similarweb uses HTTP 404 + provider error_code 401 for an absent
        // dataset. Provider code 401 is NOT HTTP authentication failure.
        if (response.status === 404 && errorBody?.meta?.status === 'error'
          && errorBody.meta.error_code === 401 && errorBody.meta.error_message === 'Data not found'
          && errorBody.data === null) {
          return {
            meta: {...errorBody.meta, status: 'success', empty_reason: 'provider_no_data'},
            data: path === paths.geography ? {countries: []} : [],
          };
        }
        if (response.status === 402 && gatewayError === 'estimated_price_exceeds_max_price') {
          throw new ApiError('cost_limit_exceeded', 'The estimated request price exceeds max_price_usd. Increase the authorized budget or reduce scope; this error does not establish insufficient account credit.', false, 402);
        }
        if (response.status === 404 && gatewayError === 'api endpoint not found') {
          throw new ApiError('unavailable_operation', 'AIsa gateway could not resolve an enabled route for this API operation. Check endpoint and metering configuration; this does not establish an account-permission failure.', false, 404);
        }
        const codes: Record<number, [string, string, boolean]> = {
          400: ['invalid_input', 'AIsa rejected the query scope or parameters.', false],
          401: ['unauthorized', 'AIsa rejected the API key. Check AISA_API_KEY.', false],
          402: ['payment_required', 'AIsa requires sufficient credit and the appropriate subscription. Check your AIsa account.', false],
          403: ['forbidden', 'The account cannot access this data scope.', false],
          404: ['not_found', 'HTTP 404 returned by AIsa or its data provider. The response does not establish whether the route is unavailable or the requested resource/data was not found.', false],
          429: ['upstream_rate_limited', 'AIsa rate limited this request. Retry later.', true],
        };
        const [code, message, retryable] = codes[response.status] ?? ['upstream_unavailable', 'AIsa could not complete this request.', response.status >= 500];
        throw new ApiError(code, message, retryable, response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError('invalid_response', 'AIsa returned no response body.');
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new ApiError('response_too_large', 'AIsa response exceeded the 2 MB limit.'); }
        chunks.push(value);
      }
      let body: Row;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ApiError('invalid_response', 'AIsa returned invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('data' in body)) throw new ApiError('invalid_response', 'AIsa returned an unexpected data envelope.');
      if (body.error || (body.meta?.status && body.meta.status !== 'success')) throw new ApiError('upstream_error', 'The data source reported an error; no data was inferred.');
      return body;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(signal?.aborted ? 'cancelled' : 'network_error', 'Request interrupted or unavailable. It may have been billed; it was not automatically retried.', true);
    }
  }
}

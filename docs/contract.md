# Contract 1.0.0

The Node runtime calls https://api.aisa.one/apis/v1 using Authorization: Bearer from AISA_API_KEY. Credentials stay in the process environment. It does not call mcp.aisa.one. Upstream operation definitions and examples are pinned in upstream-snapshot.json; the docs checkout is source material, not runtime instructions.

| Public tool | API GET path | Maximum API requests |
|---|---|---|
| AIsa_similar_sites | /similarweb/website/similar-sites | 1 |
| AIsa_traffic_engagement | /similarweb/website/traffic-engagement | 5 |
| AIsa_geography | /similarweb/website-top-geographies | 5 |
| AIsa_website_keywords | /similarweb/search/website-keywords | 1 |
| AIsa_keyword_gap | /similarweb/search/website-keywords | 4 |

Traffic translates start_month/end_month to start_date/end_date; the runtime explicitly requests total web and main_domain_only=true and four metrics. The public window is limited to 12 buckets even though upstream allows 120. Similar Sites computes exactly three months ending at end_month. Keywords send the same month for start and end and flatten the documented grouped-array representation. Geography uses the product API's data.countries. Tool names are a separate public contract, not a renamed export of every upstream operation.

Outputs have schema_version, scope, data, derived, completeness, provenance, calculation and warnings. Data row shapes depend on the tool; the MCP output schema validates the common envelope. Traffic rows include period and four numeric-or-null metrics. Keyword evidence preserves original text and normalized matching key. Scope defaults and absent filters are explicit. Provenance copies only allowlisted scope fields, never arbitrary upstream metadata. Missing update timestamps are null. Empty and partial responses are successful MCP results; if every request fails, the tool returns isError and a stable error code in text content.

Traffic algorithm traffic-derived-v1 compares requested endpoints only, leaves growth null for zero/missing baselines and performs no cross-period averaging. Missing periods are inserted as null cells. Keyword-gap-v1 applies NFKC, trim and lowercase; it does not merge synonyms. Classification threshold is 5 positions. Target-only sample keywords are counted but not placed in the opportunity list. Missing/failed target samples never establish absence. Partial comparisons use only observed competitors and expose all failures.

Bearer, request headers and arbitrary upstream error bodies are not returned. 402 is payment_required because the gateway can use it for subscription or credit restrictions. No per-endpoint prices are hardcoded. max_price_usd is divided among planned calls; tiny budgets that round to zero fail before requests. A network interruption is not automatically replayed.

OAuth login uses Clerk DCR and PKCE with shared local credentials and automatic refresh. Token exchange and refresh have simulated integration coverage; live account authorization remains unverified.

Remaining integration limits: no automatic publication-date discovery, no organic/nonbranded keyword filters, no live price estimation, no durable query cache, no interactive-client evals. See live-verification-2026-09-05.md for test-account evidence. HTTP bearer requests and sample parsing are verified using fixtures, including the docs' example envelopes.

404 diagnostics: only the known gateway error `api endpoint not found` maps to unavailable_operation. Other 404 responses map to not_found without assuming route disablement, account permissions or missing domain data. Tool errors include http_status when known; arbitrary upstream messages are never forwarded. The aisa-mcp catalogue includes website-top-geographies but explicitly excludes website/traffic-geography and website/folders based on its 2026-08-26 production checks. This historical catalogue is not a live availability guarantee.

Live-confirmed Similarweb no-data signature: HTTP 404, meta.status=error, numeric meta.error_code=401, meta.error_message="Data not found", data=null. This exact signature becomes an empty result with a warning; unknown provider errors are not reclassified as empty.

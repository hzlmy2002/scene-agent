# Live API verification — 2026-09-05

User-authorized test-account calls, no price cap. Key was passed through stdin, retained only in process memory, and is absent from artifacts. Scope: the five Node tools and their four REST dependencies; not the full AIsa catalogue.

## Results

9 HTTP requests: 7 HTTP 200, 2 HTTP 404. No automatic retries. Actual charges were not queried or independently verified. The snapshot product API was used once to establish the published month (2026-07).

| Tool | Scope | Result |
|---|---|---|
| AIsa_geography | estk.me + wikipedia.org, latest | estk.me: provider Data not found; wikipedia.org: 10 countries |
| AIsa_traffic_engagement | same domains, worldwide, 2026-07 | estk.me: provider Data not found; wikipedia.org: four metrics |
| AIsa_similar_sites | wikipedia.org, 2026-05 through 2026-07 | 5 candidates |
| AIsa_website_keywords | wikipedia.org, worldwide, 2026-07, limit 5 | 5 keywords |
| AIsa_keyword_gap | wikipedia.org vs britannica.com, same month/country, 5 per domain | 5 competitor-only-in-sample rows |

## Root cause and fix

The geography endpoint is available for this test account. The failing domain returned HTTP 404 with `meta.status=error`, `meta.error_code=401`, `meta.error_message="Data not found"`, `data=null`. This provider code is not an HTTP 401 authentication failure. The control domain succeeded on the same endpoint. The same domain-specific no-data condition occurred on traffic. This establishes absence only for the requested dataset/scope, not that the site has no traffic.

The Node client now recognizes this exact error signature and produces an empty successful result with a no-data warning and the reported scope. Mixed-domain calls preserve usable results and report partial coverage. Unknown 404s remain not_found, and explicit gateway route errors remain unavailable_operation. No-data behavior is regression-tested by replaying the captured responses.

All fetched keyword positions were null. No ranking-delta comparison can be claimed from these samples. The returned traffic_source and branded_type were all; the samples cannot be described as organic/nonbranded-only.

## Request trace

| Path and query | HTTP | Request ID |
|---|---|---|
| `/similarweb/website-top-geographies?domain=estk.me` | 404 | `imc_664ccfae120ba90a9cb90cdb3edaa878f2d2624b8f1afdab60e0c4c502557be9` |
| `/similarweb/website-top-geographies?domain=wikipedia.org` | 200 | `imc_31c75e88d94e357b961cdadab9c6c9881a55d3a2f226bbb5d07d580b2b1e0607` |
| `/similarweb/website-traffic-snapshot?domain=wikipedia.org` | 200 | `imc_6f123b083918352aab0b1256be492ab0941718fc2f21801f6673733680c04902` |
| `/similarweb/website/traffic-engagement?domain=wikipedia.org&country=ww&web_source=total&granularity=monthly&start_date=2026-07&end_date=2026-07&metrics=visits%2Cpages_per_visit%2Caverage_visit_duration%2Cbounce_rate&main_domain_only=true` | 200 | `imc_ac10c6761a978fa96ac426ede97c811c48946e642a1700157b3a10797044da93` |
| `/similarweb/website/traffic-engagement?domain=estk.me&country=ww&web_source=total&granularity=monthly&start_date=2026-07&end_date=2026-07&metrics=visits%2Cpages_per_visit%2Caverage_visit_duration%2Cbounce_rate&main_domain_only=true` | 404 | `imc_1168e3e4c205968b222d4e4fc2eb8dd882ff3ea0ec7d4cb78fd914564d36abfe` |
| `/similarweb/website/similar-sites?domain=wikipedia.org&country=ww&web_source=total&granularity=monthly&start_date=2026-05&end_date=2026-07&limit=5` | 200 | `imc_7c18c6db3bede7494232833473246d68f77a51be798b5082ea4802ed4b0e19c6` |
| `/similarweb/search/website-keywords?domain=wikipedia.org&country=ww&web_source=total&granularity=monthly&start_date=2026-07&end_date=2026-07&limit=5` | 200 | `imc_ce3260cd2bd334600c3d48c8fdc1b6239cc6b7f264a819279ea4d5a271acb55b` |
| `/similarweb/search/website-keywords?domain=wikipedia.org&country=ww&web_source=total&granularity=monthly&start_date=2026-07&end_date=2026-07&limit=5` | 200 | `imc_3c2aedb4d04bf4322b4dcea810194e08a14c395d6e31917fcbac011d2e33d3e6` |
| `/similarweb/search/website-keywords?domain=britannica.com&country=ww&web_source=total&granularity=monthly&start_date=2026-07&end_date=2026-07&limit=5` | 200 | `imc_ec88005bbec5ed0b919c30fcd8d203ff662ca5354e0a052a1e0bc3d55ba4d0ec` |

Full public-data response fixtures and pre-fix tool outputs are in `tests/fixtures/live-2026-09-05.json`. Updated behavior is verified in `tests/live-regression.test.mjs`. No interactive Codex/Claude/Hermes UI eval was performed in this run.

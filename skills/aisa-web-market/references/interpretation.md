# Interpretation

Traffic uses total web, main-domain-only, monthly estimates. Visits are estimates; duration is seconds and bounce rate a fraction (0.42 = 42%). Compare identical country and month windows. Growth is null for a zero or unknown baseline. No cross-month average of ratios is provided. Missing cells are null and must remain unknown.

Keyword samples contain at most 20 rows/site. The current API exposes neither organic/nonbranded filters nor guaranteed volume/difficulty. `competition` is the upstream field and must not be renamed to difficulty. Scope includes upstream defaults, and provenance records reported scope when available.

Gap classification uses target position minus best available competitor position: >=5 target_weaker; <=-5 target_stronger; otherwise similar_position. Missing comparable positions means insufficient_data. A keyword absent from a nonempty, successfully returned target sample is competitor_only_in_sample. A failed or empty target response cannot establish absence. A sample gap is not proof of no ranking. Sorting uses class, maximum known competitor clicks, then normalized keyword. It does not measure business priority. Use intent, page evidence and the user's business when suggesting topics.

`completeness` describes retrieval, not full market coverage. Partial results preserve successful domains and list failures. Provenance exposes endpoint, retrieval timestamp, reported scope and upstream data update time if available. Latest geography snapshots can have different dates and are not automatically aligned.

Errors appear in the MCP error content. `payment_required` can mean credit or subscription access; do not label every 402 as insufficient funds. A network timeout may already have been billed. The runtime performs no automatic retries. Do not automatically retry authentication, access or unsupported-scope failures.

/** Representative Hunter Discover payload. Not a live response.
 *
 * Fields present on company rows in this fixture:
 *   organization, domain, emails_count (optional)
 * Meta: results, limit, offset
 *
 * Mapped by HunterCompanyDiscoveryProvider: organization, domain.
 * Discarded: emails_count, meta.
 */
export const HUNTER_DISCOVER_SUCCESS_FIXTURE = {
  data: [
    {
      domain: "siam-foods.example",
      organization: "Siam Foods Co",
      emails_count: { personal: 2, generic: 4, total: 6 },
    },
    {
      domain: "gulf-produce.example",
      organization: "Gulf Produce Trading",
    },
    {
      domain: "incomplete.example",
      // missing organization — parser must skip
    },
    {
      organization: "Nameless Org",
      // missing domain — parser must skip
    },
    {
      domain: "third-ok.example",
      organization: "Third Ok Imports",
    },
  ],
  meta: {
    results: 5,
    limit: 100,
    offset: 0,
  },
};

/** Representative Hunter Multi-Domain Search (masked) payload. Not a live response. */

export const HUNTER_MULTI_DOMAIN_SUCCESS_FIXTURE = {
  data: [
    {
      reveal_handle: "handle-procurement-same-domain",
      name: "Amina K.",
      position: "Head of Procurement",
      department: "finance",
      seniority: "senior",
      type: "personal",
      decision_maker: true,
      domain: "mahmoodsons.com",
      company_name: "Mahmood & Sons",
      full_name_exists: true,
      phone_number_exists: false,
      linkedin_exists: true,
      verification: { date: null, status: "valid" },
    },
    {
      reveal_handle: "handle-sales-same-domain",
      name: "Omar S.",
      position: "Sales Manager",
      department: "sales",
      seniority: "senior",
      type: "personal",
      decision_maker: false,
      domain: "mahmoodsons.com",
      company_name: "Mahmood & Sons",
      full_name_exists: true,
      phone_number_exists: true,
      linkedin_exists: false,
      verification: { date: null, status: "accept_all" },
    },
    {
      reveal_handle: "handle-other-domain",
      name: "Other Co Person",
      position: "Procurement Manager",
      department: "executive",
      seniority: "executive",
      type: "personal",
      decision_maker: true,
      domain: "other-company.example",
      company_name: "Other Co",
      full_name_exists: true,
      phone_number_exists: false,
      linkedin_exists: true,
    },
    {
      // missing reveal_handle — parser must skip
      name: "No Handle",
      position: "Buyer",
      domain: "mahmoodsons.com",
    },
    {
      reveal_handle: "handle-no-domain",
      name: "No Domain",
      position: "Owner",
    },
  ],
  meta: {
    results: 40,
    next_search_after: "cursor-token-not-to-be-followed",
    params: {
      company_name: ["Mahmood & Sons"],
      type: ["personal"],
    },
  },
};

/** Representative Hunter /v2/usage payloads. Not live responses. */

export const HUNTER_USAGE_UNIFIED_FIXTURE = {
  data: {
    reset_date: "2026-09-17",
    requests: {
      credits: { used: 8, available: 50, remaining: 42 },
    },
  },
};

export const HUNTER_USAGE_SPLIT_FIXTURE = {
  data: {
    reset_date: "2026-09-04",
    requests: {
      searches: { used: 10, available: 50, remaining: 40 },
      verifications: { used: 5, available: 50, remaining: 45 },
    },
  },
};

export const HUNTER_USAGE_EMPTY_REQUESTS_FIXTURE = {
  data: {
    reset_date: "2026-09-17",
    requests: {},
  },
};

export const HUNTER_USAGE_ZERO_AVAILABLE_FIXTURE = {
  data: {
    reset_date: "2026-09-17",
    requests: {
      credits: { used: 0, available: 0, remaining: 0 },
    },
  },
};

export const HUNTER_USAGE_OVER_ALLOCATION_FIXTURE = {
  data: {
    reset_date: "2026-09-17",
    requests: {
      credits: { used: 120, available: 100, remaining: 0 },
    },
  },
};

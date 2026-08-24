// Repository interface barrel.
//
// Production code MUST NOT construct repository instances here. Use
// `serverRepositories()` from `@/lib/repositories/server` inside server
// components, server actions, and route handlers — that helper enforces
// auth + membership before every request touches the database.
//
// The IndexedDB implementations under `./indexeddb` remain in-tree only
// for pre-cloud unit tests. They are never imported by production code.

export * from "./interfaces";

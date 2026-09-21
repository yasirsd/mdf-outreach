# BACI public sample compatibility

Verified public contracts for `baci-hs17`:

- `GET /api/datasets/baci-hs17` provides metadata and schema without authentication.
- `GET /api/datasets/baci-hs17/sample` provides a 100-row sample without authentication.
- `GET /api/datasets/baci-hs17/query` is the authenticated filtered-query endpoint and is outside public-sample verification.

The dataset slug and provider dataset contract establish HS 2017. The public
sample exposes a provider integer `hs_revision` value of `5`, while the public
schema describes that field as a revision year. No authoritative provider
mapping from integer `5` to HS 2017 has been established. The adapter therefore
validates and retains that integer only as `provider_hs_revision` metadata;
canonical MDF observations use `HS17` from the `baci-hs17` dataset identity.

The wire field is deliberately spelled `unit_abbrevation`. It is validated
before normalization. A non-null quantity is accepted as metric tonnes only
when that literal field is `mt`; missing quantity remains `null`. Raw numeric
values remain available as provider evidence, while normalized values pass
through the provider-local IEEE-754 decimal-noise stabilizer. The stabilizer
does not impose a currency or quantity scale.

# Typed uncertainty compiler diagnostic preparation

Status: offline preparation, paid HOLD. No provider, credential, quota, deployment, or migration action is part of this change.

The one approved diagnostic for app `6e12889944f2c1afd61da7c6403aae2109578e6c` / harness `36bc13c72b21352517210058e0be002d7a8dcdb3` sent payload `30acecb5f12bc8118f9044f3dc2daceeff55ba7987fc4b2b2c9383a30cd03187` and schema `1acd89496b1540b1e35f29e9d4612d892bd4cec4417054e4cdf19fbe7af23552`. Google returned HTTP400 `Schema state limit exceeded`. It stopped after one request. The settled account retains 47 UNKNOWN, $5.887027 conservatively retained, $4.112973 remaining under the cumulative $10 cap. These are local ledger exposure figures, not a provider billing quote.

## Narrow hypothesis

`factorGenerationUnions` preserves `kind`-discriminated objects, but previously merged all uncertainty field-code branches independently of their alternative values. The rejected grammar has one uncertainty item object, a global `fieldCode` domain, and a ten-way heterogeneous `alternatives[].value` union beneath two arrays. A single numeric field therefore admits date, time and QueryPeriod values, including mixed-type arrays. Strict decoding always refused these combinations; this is not evidence of canonical acceptance corruption.

The candidate applies the existing correlation rule to `fieldCode` as well as `kind`. It keeps field/reason/value languages in separate typed object branches. Identical shells can still share field codes; code identities, selected gaps, payload shape, strict schema, decoder and oracle stay unchanged. It does not add JSON-encoded strings, field padding, backend coercion, model fallback or extra provider requests.

This moves the ten-way choice from `uncertainties[].alternatives[].value` to the uncertainty item selected by `fieldCode`; each alternative value then uses only that field's language. Date fields retain their three DateOperand branches; queryRange retains its four QueryPeriod branches. The fully expanded uncertainty subtree has **more** union occurrences (10 before, 25 after), and the compact complete schema grows from 10,781 to 15,415 bytes. Neither count is Google's compiled state count. The experiment tests correlation placement, not byte size, reference packaging, nullability normalization or property ordering.

Only the expanded `$.properties.uncertainties.items` subtree changes. All other expanded schema nodes and all non-schema request fields remain identical to the rejected request. The frozen strict input-bound schema digest remains `0363d0b00e38f19c6cedc652eb97a2906b0129af7fce38e1ccd620adb5081f14` for R01; the canonical schema and oracle are unchanged.

## Evidence and limits

- Frozen rejected schema is checked against its actual paid-request digest.
- Regression witnesses: numeric field with date; mixed numeric/date alternatives; date field with number; time field with QueryPeriod; queryRange with time; title with date. The old grammar admits all six; the candidate refuses them. Hand-selected valid examples remain admitted.
- Bounded R01/R02 field/reason/value matrix checks that every strict-valid sample remains generation-valid; R02 unavailable field codes stay unavailable. Existing object transport, service, canonical and oracle tests continue to apply. The matrix is not an exhaustive proof over arbitrary strings/numbers/arrays.
- Cycles, optional-property subsets and misplaced `kind` discriminators were not found in the rejected schema. Accepted104 used string carriers at these typed positions, so it does not establish admission of any typed105 subtree.
- Google's compiler is unavailable offline. This change fixes the demonstrated correlation loss and prepares one falsifiable experiment; it does **not** establish the provider's root cause or successful compilation. Even a future HTTP200 would be request-level compiler admission evidence, separate from strict/oracle acceptance and Pilot credit.

Google documents that schema complexity can cause HTTP400 and mentions nested arrays and constrained properties, without publishing a reproducible compiler/state budget: [structured output considerations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output). That general guidance does not identify this request's specific failing structure.

## Next diagnostic boundary

Freeze new exact app/harness, request/schema hashes, 47-UNKNOWN inventory and lifecycle in a new preparation-only proposal. Use the already reviewed one-use compiler launcher unchanged. Do not create execution authority or read credentials during preparation. A future fresh approval may authorize exactly one synthetic R01/turn0 request on the same Gemini Flash Lite / google-vertex/eu route, retry0/fallbacknone, exposure $0.105472, cumulative cap $10, HOLD after any result. It gives no Formal Pilot credit and authorizes no Full or deployment.

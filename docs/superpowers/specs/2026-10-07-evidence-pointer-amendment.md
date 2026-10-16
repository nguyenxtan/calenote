# Narrow evidence pointer amendment

Owner approved autonomous specification, implementation, local review and bounded live continuation on 2026-10-07. This amends evidence transport only; semantic ownership is unchanged.

## Contract

The model selects `{"kind":"USER_TURN","turn":N}` or an existing `CONTEXT_FACT` source reference. It does not author source text. USER_TURN selects exactly one USER entry from the immutable validated ContextInput sent for that dispatch. The application materializes the entire unchanged entry text into canonical USER_QUOTE with the same turn and occurrence 1. No search, role substitution, clipping, normalization, fuzzy matching or evidence repair is permitted. Empty, non-NFC, malformed, oversized (>2000 code points), absent or ASSISTANT sources reject. Extra pointer keys reject.

Canonical USER_QUOTE and CONTEXT_FACT remain unchanged. Existing legacy quote transport remains supported for historical/local parity tests, but the current model prompt requests pointers exclusively. Pointer source selection is SEMANTIC_UNTRUSTED; exact materialization is APPLICATION_OWNED and confers no acceptance authority. All existing canonical, source-map, current-target, field/value, scope, negation and contextual checks still execute. A whole-source quote is not a proof that every proposed semantic value is entailed. Specialized semantic guards remain authoritative; no new general entailment claim is made.

## Boundary

Offline D06 regression proves that a whole USER turn containing a removed control cannot represent a valid adjacent correction. The narrow amendment therefore also permits `USER_SEGMENT {turn,segment}` selecting only an application-enumerated exact segment beside the existing CONTROL_PLACEHOLDER. The outbound user JSON includes `evidenceSources` only where such segments exist; canonical ContextInput/state stay unchanged. Segments are split at the exact existing placeholder, never trimmed or normalized. Materialization computes the exact canonical occurrence for the selected segment, rejecting any unrepresentable match rather than repairing it. No model-authored spans or text are accepted. Whole-turn crossing-gap rejection remains covered.

The current dispatch decoder rejects model-authored USER_QUOTE in every active evidence position. Legacy quote transport is available only to context-free historical/local parser entry points; a model cannot select compatibility mode.

Materialization occurs only at known semantic evidence carriers (target, changes, active query, uncertainty alternatives), before existing wire/canonical parsing. No model business value or advisory text is traversed or rewritten. The validated request snapshot is captured at gateway prepare time, not re-read from caller-owned state after dispatch. Missing context fails closed for a pointer; legacy references are not repaired.

## Verification and release limits

Tests cover exact text preservation, invalid roles/indexes/extra keys, immutable dispatch context, bounded source size, historical facts and quotes, mixed evidence, nested alternatives, current-target binding, source-map gaps, negation, unrelated numbers and semantic conflicts. Existing validators and oracle expectations do not change. Wire version advances; provider schema remains shallow (evidence JSON strings). Local full verification and independent C0/I0 precede commit and provider calls. Live work stays inside the existing $5 conservative debug cap with unchanged model/provider, retry=0 and fallback=none. No Full, push, merge, migration or deployment.

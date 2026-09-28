# ADR 0004: Deterministic-first optional intelligence

## Scope notice — 2026-09-28

The decision below describes the legacy deterministic-first path, not an
instruction to add a competing parser to the proposed successor conversation
contract. [LLM-led context design](../../superpowers/specs/2026-09-28-llm-context-contract-design.md)
§2 proposes superseding raw-language parsing priority while retaining backend
validation, authorization and mutation authority. Its written spec is pending
owner review; no runtime or deployment change is implied by this notice.

## Context

The core Vietnamese reminder workflow is useful without an LLM. Sending every
chat or future email to a model would add cost, privacy exposure, and an
unnecessary production dependency.

## Decision

Use deterministic parsing and validation first. Future intelligence sits behind
provider-agnostic application ports, is optional, bounded by size/time/retry
limits, and produces only validated proposals. Model output never writes D1 or
creates authoritative user state directly.

## Consequences

No LLM is required for core reminders. Low confidence asks the user a concise
clarifying question instead of escalating to an expensive model.

## Status

Accepted.

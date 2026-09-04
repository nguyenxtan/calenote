# ADR 0004: Deterministic-first optional intelligence

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

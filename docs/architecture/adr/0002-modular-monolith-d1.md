# ADR 0002: Modular monolith with D1 as canonical persistence

## Context

Current reminder, login, webhook, Queue, and Cron behavior already depends on
D1 guarded state transitions and Cloudflare runtime primitives. There is no
demonstrated scale or business blocker requiring PostgreSQL or microservices.

## Decision

Keep one deployable modular monolith and D1/SQLite as canonical persistence.
Use narrow feature ports and feature-owned D1 repositories; Worker composition
wires concrete adapters. Applied migrations remain immutable.

## Consequences

No speculative database migration, microservice split, or generic repository
framework is introduced. Future source/action data remains in D1 unless a
measured limitation proves otherwise.

## Status

Accepted.

# ADR 0003: Encrypt user-owned bot credentials

## Context

Calenote must retain each user's bot credential to receive and send bot
messages after initial setup. Plaintext retention or returning credentials to
the browser would break the BYOB privacy boundary.

## Decision

Encrypt bot and login material at rest with the Worker keyring. Never return,
log, put in a URL, or store credential plaintext in browser storage. Decrypt
only inside the Worker immediately before a necessary provider call.

## Consequences

The present single-master key cannot be rotated safely in place. A future
dual-key/re-encryption/webhook re-registration migration is required before
online rotation is offered.

## Status

Accepted.

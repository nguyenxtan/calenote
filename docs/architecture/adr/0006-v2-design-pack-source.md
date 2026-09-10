# ADR 0006: Calenote V2 design pack is the implementation source

## Context

ADR 0005 recorded an approved Figma file as the historical Calenote brand
source. Its assets cannot currently be retrieved because Figma MCP access is
unavailable. The product owner has approved the supplied Calenote V2 design
pack, which contains canonical brand assets, tokens, screen references and
implementation guidance.

## Decision

For Calenote V2 implementation, the approved design pack is the current UI
and brand authority. Runtime assets copied from its `brand/` directory live in
`public/brand/` and must be used as supplied; they must not be redrawn in
React or CSS. The temporary CSS-drawn mark is retired. ADR 0005 remains the
historical Figma authority and is superseded for implementation purposes.

## Consequences

Future intentional brand changes require an explicit update to the approved
design authority and its canonical assets. This decision does not change
backend domain authority, deployment configuration, D1, queues, or AI policy.

## Status

Accepted.

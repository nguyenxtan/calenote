# ADR 0005: Figma is the Calenote brand source of truth

## Context

Calenote has an approved design source at
`https://www.figma.com/design/956x39sa3514NSz8BVXnRQ`, including canonical logo,
mark, and application-icon assets. The current React/CSS mark is only a
temporary implementation, not the approved identity.

## Decision

Export canonical assets from the approved Figma file when Figma access is
available and use them from one production asset location. Do not redraw,
approximate, or recreate the logo from screenshots.

## Consequences

Brand integration stops if canonical assets cannot be exported. The rest of
the architecture work may continue, but no competing logo is introduced.

## Status

Accepted.

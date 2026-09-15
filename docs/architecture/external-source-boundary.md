# External source boundary

## Status: PLANNED

This document defines a future bounded integration boundary. No Calenote runtime
code, credential, endpoint, Queue job, D1 schema, or ICONIC Logistics Platform
integration exists for it today.

## Ownership boundary

Calenote may consume a small external signal to help a user create or review a
follow-up. It owns only:

- reminder;
- follow-up;
- user attention;
- notification and channel delivery;
- escalation.

ICONIC Logistics Platform remains authoritative for its business domain:

- Forwarding;
- Booking;
- Shipment;
- Finance;
- operational business state.

Calenote must not mirror, infer, mutate, or become the system of record for
these ICONIC entities. A deep link may return a user to the authoritative
external system; it is not a transfer of ownership.

## Proposed bounded contract

An external source may emit the following minimum record:

```ts
type ExternalSourceSignal = {
  source: string;
  entityType: string;
  externalRef: string;
  title: string;
  dueAt: number | null;
  status: string | null;
  assigneeRef: string | null;
  deepLink: string | null;
  idempotencyKey: string;
};
```

`source`, `entityType`, and `externalRef` identify the external authority;
`idempotencyKey` deduplicates the source event at the boundary. `title` is a
bounded attention summary, not an invitation to ingest arbitrary source data.
`dueAt`, `status`, and `assigneeRef` are advisory source metadata. `deepLink`
must be allowlisted/validated before presentation and must not carry Calenote
credentials or secrets.

## Required future controls

Any implementation requires separate review of:

1. authentication and least-privilege source authority;
2. tenant/user mapping without exposing external private identifiers;
3. payload-size and schema validation;
4. idempotency, replay, retention, and deletion semantics;
5. source-data encryption/redaction and safe audit events;
6. human confirmation before a signal creates an authoritative Calenote reminder
   or delivery;
7. failure isolation so external-source disruption cannot block core reminders.

The boundary is intentionally one-way and capability-limited. It is not a
license to import ICONIC domain services, databases, credentials, or business
workflow ownership into Calenote.

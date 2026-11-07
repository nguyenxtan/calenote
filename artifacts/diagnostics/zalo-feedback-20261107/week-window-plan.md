# Authored week window implementation

- Reproduce the missing week field and continuous-at-clock cadence through existing field capability and evidence APIs before implementation.
- Add a reject-only week amount/unit evidence predicate. Preserve authored weeks in the optional V3 slot; only the resolver converts weeks to days.
- Admit DAILY for an explicit continuous-at-clock reminder, respecting immutable quote boundaries, negation and hypothetical guards. Require finite count/end or a before-event week window at resolution.
- Verify active keyed authoring roundtrip plus current-request carry-forward; reject wrong units/amounts, model-computed count and omitted intent.
- Coordinate contracts/state/resolver/codecs with the relative-month agent and wording with the response agent. No provider, paid service, deployment or remote mutation.

# Keyed emission143: query evidence ownership

A new query operand needs current USER evidence. Exact reuse may instead cite a
same-kind retained QUERY fact that actually contains the required operands.
REMINDER facts, prior USER turns, other query kinds, and structurally absent
query operands do not grant that authority. This makes the existing prompt and
downstream query-scope policy an upper bound on keyed generation availability.

The selected query evidence enum is intersected with current USER source codes
and eligible QUERY fact codes. Null period/date/output-calendar/topic and null
DAY/DATE_BOUNDS operands exclude the fact. A real date with an unstated year is
still a value; relative periods and unsupported-but-authored operands retain
their existing representation. Same-kind complete facts remain available, and
downstream exact-value checks still decide whether a particular reuse is valid.

No fact or received pointer is removed or replaced in a response. Strict schema
validation rejects an ineligible pointer unchanged. The encoder refuses such a
proposal rather than substituting current USER evidence. Input facts, shared
codebooks, canonical contracts, legacy105/106 consumers and frozen business
oracles remain unchanged. This does not infer a query kind, operand or target.

The142 retry's R01/1 response was schema-valid but cited an absent prior query
fact for a newly supplied month; downstream refused it. The captured response
is an offline regression, not live acceptance. Validate the evidence-domain
controls, all144 canonical outcomes, and a fresh full32 live campaign.

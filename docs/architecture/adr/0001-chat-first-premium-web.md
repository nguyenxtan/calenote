# ADR 0001: Chat-first assistant with a premium Web control plane

## Context

Creating, confirming, and receiving reminders should happen naturally in the
user's Zalo or Telegram conversation. Complex setup, recovery, and management
still need a calm, accessible Web experience.

## Decision

Treat Zalo/Telegram as the daily operating surface and Calenote Web as a
first-class premium control plane. Web does not become an admin-only shell or
a calendar dashboard that happens to contain chat.

## Consequences

New daily flows must remain usable from chat. Web owns setup, visibility,
account controls, and complex recovery with product-language copy rather than
technical state names.

## Status

Accepted.

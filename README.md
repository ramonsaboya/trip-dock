# TripDock

TripDock is a consumer-first web product for organizing multi-destination trips. It gives one trip owner a structured view of destinations, transport, accommodation, activities, and the day-by-day plan, with collaboration designed to follow later.

## Status

The project is currently in product, UX, and architecture design. This repository contains no application implementation yet.

## Product direction

- Create a trip from a short form or from natural-language text or audio.
- Represent destinations as ordered stops connected by explicit transport legs.
- Track accommodation separately from activities.
- Maintain an activity pool for each destination and assign activities to days.
- Let AI answer questions and prepare persisted, reviewable change proposals.
- Require explicit human approval before an AI proposal changes the accepted trip.
- Support WhatsApp as an additional conversational surface, starting with secure one-to-one trip linking.

## Current technical direction

These choices are provisional until their corresponding design and architecture decisions are approved:

- React, Vite, React Router, and Relay for the web application.
- TypeScript, Fastify, GraphQL Yoga, and Pothos for a custom GraphQL modular monolith.
- PostgreSQL as the canonical data store.
- AWS for hosting, compute, storage, queues, authentication, observability, and email.
- OpenAI APIs for natural-language and voice intelligence.
- Meta's official WhatsApp Cloud API for WhatsApp integration.

## Repository policy

- Keep secrets out of Git and provide sanitized `.env.example` files when configuration is introduced.
- Record consequential product and architecture choices as short decision documents.
- Treat generated artifacts as derived outputs and verify them from their source definitions.
- Keep AI-generated changes reviewable and subject to the same tests and validation as human-authored changes.

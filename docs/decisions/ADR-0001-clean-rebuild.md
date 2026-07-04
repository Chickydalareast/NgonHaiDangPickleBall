# ADR-0001 — Clean VPS Rebuild

Status: **Accepted**

## Decision

Create a new repository and folder from zero. The previous Appwrite-based project is research material only. Do not copy its source tree, configuration, generated files, environment files, migrations, or deployment assumptions into this repository.

Useful business rules may be reintroduced only after they are restated against the locked V1 baseline and implemented cleanly with tests.

## Consequences

- No compatibility layer with the old project.
- No migration of old development data.
- No coding of order or bill features during Step 0.
- Every implementation step must pass the repository quality gate before the next step begins.

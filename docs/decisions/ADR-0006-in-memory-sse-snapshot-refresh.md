# ADR-0006 — In-Memory SSE with Snapshot Refresh

Status: **ACCEPTED**

## Context

The V1 deployment has one Fastify process and only a few admin devices. The dashboard needs low-latency notification when a customer creates an order, but order and bill correctness must remain independent from realtime transport.

## Decision

Use a process-local event hub and a protected Server-Sent Events endpoint. The order service publishes `order.created` only after its PostgreSQL transaction commits. The event carries entity IDs only. The browser uses native EventSource and invalidates the TanStack Query dashboard snapshot. While disconnected, the dashboard polls every 15 seconds.

## Consequences

The implementation has minimal CPU, memory, and operational cost and requires no Redis, queue, WebSocket framework, or new database table. Events can be missed during API restart or network interruption, but the client always refetches authoritative PostgreSQL-backed snapshots, so missed notifications do not create incorrect state.

This design assumes one API process. Before horizontal scaling, the publisher can be replaced by PostgreSQL LISTEN/NOTIFY or Redis while preserving the SSE endpoint and shared event contract.

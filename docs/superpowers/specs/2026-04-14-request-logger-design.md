# Request Logger Middleware — Design Spec

**Date:** 2026-04-14

## Overview

Add a global request logger to the Hono server that logs every incoming HTTP request to stdout. The log covers all routes — auth, models, proxy, and any future routes — with a simple, consistent format.

## Scope

- **File changed:** `src/server.ts` only
- **New files:** None
- **Lines added:** ~3

## Design

### Middleware

A `app.use('*', ...)` middleware is registered after the existing `corsMiddleware` and before all route definitions. It calls `console.log` with the HTTP method and path for every incoming request.

```
→ POST /v1/messages
→ GET /auth/status
→ GET /v1/models
→ POST /auth/oauth/start
```

### Placement

```
app.options('*', corsPreflightHandler)   // existing
app.use('*', corsMiddleware)             // existing
app.use('*', requestLogger)              // new — added here
app.get('/', ...)                        // routes follow
```

Registering it here ensures all routes defined below are covered, including any added in the future.

### What is NOT logged

- Response status code (out of scope for this iteration)
- Request duration (out of scope)
- Client IP (out of scope)
- Model name — the existing per-request log inside `messagesFn` (line 265) already captures that detail and is left unchanged

## Implementation

Single middleware function added inline in `server.ts`:

```ts
app.use('*', async (c, next) => {
  console.log(`→ ${c.req.method} ${c.req.path}`)
  await next()
})
```

No new imports required. No new files required.

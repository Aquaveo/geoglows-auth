---
title: An unreachable auth service needs a budget, not unbounded retrying
date: 2026-09-01
category: best-practices
module: geoglows-auth
problem_type: best_practice
component: authentication
severity: high
applies_when:
  - Auth is optional to the app — signed-out visitors get real functionality
  - You use `@supabase/supabase-js` in a long-lived page (a map, a dashboard)
  - You are deciding what a navbar auth slot should show when the account service is down
tags:
  - supabase
  - resilience
  - retry
  - backoff
  - token-refresh
  - degradation
last_updated: 2026-09-01
---

# An unreachable auth service needs a budget, not unbounded retrying

## The situation

Every GEOGloWS portal treats auth as optional: the map renders, the data loads
and every read-only feature works signed out. Auth decorates one corner of the
navbar. Despite that, an unreachable Supabase project used to degrade the whole
page — quietly, and for as long as the tab stayed open.

## What went wrong

Three independent unbounded behaviours, none of them obvious from the code:

1. **Supabase's `autoRefreshToken` is on from construction to the end of the
   page.** It is a 30s `setInterval` plus a `visibilitychange` handler, started
   inside `createClient()` — before your code knows whether a session even
   exists. Against a stored session whose refresh token cannot be redeemed,
   every tick is a failed request with its own internal backoff. A tab left
   open overnight generates thousands.

2. **Nothing had a timeout.** `bootstrapSession` resolves with an `error` state
   rather than rejecting, so it reports every failure it can observe — but the
   one outcome it *cannot* report is a request that never settles at all, which
   is exactly the unreachable-host case. The sign-in form, password reset and
   profile writes had no timeout either.

3. **The navbar offered a "Sign in" button.** The modal behind it talks to the
   same host that just failed. A form that cannot submit is a worse answer than
   saying the service is unavailable.

## The rule

**Bound the effort, state the outcome, and recover on evidence.**

- **Bound it.** A budget in both attempts *and* wall clock
  (`connect: { attempts, timeoutMs, giveUpMs }`). When it is spent, stop —
  stop the ticker too, so nothing is left running in the background.
- **Time out at the transport, not the call site.** Racing a promise abandons
  the wait but leaves the request, and Supabase's internal retries behind it,
  running. A `fetch` wrapper on the client (`fetchTimeoutMs`) aborts the actual
  work and covers every call the client makes rather than the one path that
  remembered to add a race.
- **Classify failures.** Retrying an unreachable host is the point of a budget.
  Retrying an RLS denial (`42501`) or any 4xx spends the whole budget on a
  request that answers the same way every time, then reports "service
  unavailable" for what is really a permission bug. See `isTransientError` in
  `src/core/retry.ts`.
- **Degrade partially.** Auth reachable + profile unreachable is not the same
  failure as auth unreachable. If `getCurrentUser()` succeeded, the session is
  real: keep the avatar and report the profile failure separately. Hiding a
  live session behind an error icon because a secondary read failed is a
  downgrade, not a safeguard.
- **Never replay a single-use step on retry.** An OAuth authorization code is
  spent by the first exchange. A retry that replays it fails with a different
  and more confusing error than the one being retried — hence
  `bootstrapSession({ completeCallback: false })`.
- **Jitter the backoff.** Fixed 1s/2s/4s means every tab in the fleet retries in
  lockstep and hits the recovering service simultaneously.
- **Recover on evidence, not on a clock.** Giving up should not be permanent,
  but resuming needs a reason: the `online` event, a stale-enough tab focus, an
  auth event that could only have come from a service that answered, or the
  user clicking the error icon. A blind background poll is just the unbounded
  retrying again with extra steps.

## Traps found while implementing this

Worth knowing because each produced a working-looking implementation:

- **A retry loop with no generation counter is re-entrant.** Two triggers
  (`INITIAL_SESSION` and a `SIGNED_OUT`) each start a loop with its own attempt
  counter and deadline, silently doubling the budget.
- **A backoff `setTimeout` that teardown does not track will wake up after
  `destroy()`** and render into a torn-down page. Visible under HMR.
- **A sticky give-up flag that gates *every* re-bootstrap** will swallow a
  genuine `SIGNED_OUT` and leave a signed-out user staring at an error icon.
  Gate the automatic retrying, not the auth events.
- **A timeout says "stop waiting", not "discard the answer".** If the abandoned
  attempt eventually returns a valid session while the slot shows an error,
  commit it — late is better than an error icon over a live session.

## Where this lives

`src/bootstrap/index.ts` (the budget, the ticker control, the recovery
triggers), `src/core/retry.ts` (classification and backoff),
`src/core/supabase.ts` (`fetchTimeoutMs`), `src/core/auth-action.ts` (the error
state). Added in 1.8.0. See also
[[ensureprofile-upsert-overwrites-user-edits-2026-04-29]] for the other
non-obvious failure mode in the same bootstrap pipeline.

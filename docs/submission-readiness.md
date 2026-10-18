# GRID PRIX — Hackathon Submission Readiness

**Last checked:** October 17, 2026, 21:42 BRT (October 18, 00:42 UTC)

This page distinguishes verified repository evidence from platform actions that
have not completed. Historical experiment data is not live activity.

## Verified links and delivery state

| Item | Verified state |
| --- | --- |
| Public source repository | [github.com/santleme/grid-prix](https://github.com/santleme/grid-prix) — GitHub API verified `public`; default branch `master`. |
| Last CLI-confirmed CreateOS deployment | CreateOS CLI reported upload/deploy success for [`dep-8260dda2-94c8-4c0a-a186-5aeef24dcba5`](https://dep-8260dda2-94c8-4c0a-a186-5aeef24dcba5.tyzo.nodeops.app). An earlier HTTPS check returned **HTTP 403 / Cloudflare error 1010**; the latest check timed out. A redeploy after the collision-policy update was attempted, but its completion/status could not be confirmed. This is not verified as a working app. CLI status/log checks are currently blocked by DNS resolution for `api-createos.nodeops.network`. |
| Production alias | [production-grid-prix-live.tyzo.nodeops.app](https://production-grid-prix-live.tyzo.nodeops.app) — the last known check returned **HTTP 503 (nginx)** before the latest upload deployment. It is unverified whether this alias points at the new deployment. Do not submit as a working public app URL. |
| Stripe Projects | The read-only `stripe projects status --json` response reports project `grid-prix`, the CreateOS provider linked and complete, and both `createos-plan` and `createos-project` as Free and complete. Credential values were redacted by the CLI and were not copied here. |
| Screenshot evidence | [Desktop](../artifacts/screenshots/grid-prix-desktop.png), [mobile](../artifacts/screenshots/grid-prix-mobile.png), and [race view](../artifacts/screenshots/grid-prix-race-live.png). These are local UI captures, not remote deployment or AI execution evidence. |

The latest upload deployment URL has returned 403 and timed out on a later
check. Production backend
reachability, deployment health, and hosted responsive behavior are therefore
**not verified**. The environment has only the non-secret
`GRID_PRIX_PUBLIC_READ_ONLY=1` setting; Groq/CreateOS provider secrets were
not transferred or configured. Do not advertise this URL as a working demo.

## Verified local checks

The following checks passed against the source tree on this date:

- `npm test` — 18 tests passed.
- `npm run test:python` — 31 tests passed, including the production web adapter.
- `npm run build` — TypeScript check and Vite production build passed.
- `npm run build:production` — production build and static-asset packaging passed.
- `git diff --check` — passed.
- Local production smoke test — frontend HTML and `/api/evolve/status` both
  returned HTTP 200; no model or Sandbox calls were made.
- A targeted scanner checked reachable Git commits and the publishable
  worktree for Stripe, Groq, GitHub, AWS, private-key, and credential-assignment
  patterns. No match was found. `.env` and `.projects/` were explicitly
  excluded and never read; both are ignored and neither is tracked.

This scan is bounded evidence, not proof that all external systems or
unreachable Git objects are secret-free. Review the exact files and commit
before publishing future changes.

## Recorded AI/Sandbox experiment (historical)

The previously recorded deterministic run with seed **2026** reported **20
Groq requests, 36 CreateOS Sandbox executions, 18 policies evaluated, and 2
policies promoted**. These figures describe that recorded run only. They are
not a live run or activity from the local build, repository publication, or a
CreateOS application deployment.

The promotion metric is held-out steering agreement with observed race
transitions. It does **not** claim a faster lap, a faster race, or improved
finishing position. Held-out observations are reserved from candidate
generation, and a candidate is kept only when its held-out score is strictly
above its baseline.

## Collision-avoidance policy update (local verification)

The deterministic default policy now spreads drivers farther apart when
choosing a racing line. This changes policy steering only; the circuit,
waypoints, collision physics, and AI evolution/evaluation algorithm remain
unchanged. On seed 2026, the regression run recorded **15,547 collision
events instead of 36,275** in the prior build, and all 20 drivers finished.
The updated run took 5,999 ticks versus 5,026 previously, so this is evidence
of fewer collisions, **not** faster race performance. Collisions still occur.

## Two-and-a-half-minute demo outline

Use the local commands in the [README](../README.md). Keep `.env` and
`.projects/` out of the recording and never show credential values.

| Time | Demo action and narration |
| --- | --- |
| 0:00–0:20 | Introduce GRID PRIX: 20 independent algorithmic drivers, 10 teams, and a deterministic 2D race. |
| 0:20–0:45 | Start a local race and show the track and classification. Clarify that this local simulation does not call Groq or CreateOS. |
| 0:45–1:05 | Show a driver's Python policy and independent policy history. Identify stored code as recorded history unless a new evolution request has completed during the demo. |
| 1:05–1:35 | Explain the loop: telemetry → policy generation → real CreateOS Sandbox execution → held-out evaluation → promote or retain. Only claim live execution if the current request actually completed. |
| 1:35–2:05 | Present the seed-2026 figures explicitly as a recorded experiment: 20 requests, 36 Sandbox executions, 18 policies evaluated, 2 promoted. Explain that the score measures held-out steering agreement, not lap time. |
| 2:05–2:30 | Show the final promote/retain decision and close on reproducibility and validation. Do not invent a live result to fill a gap. |

## Remaining human submission requirements

These tasks are not performed or asserted complete by this repository audit:

1. Appear on camera in the hackathon demo recording if required by the rules.
2. Record and publish the video, then add its actual public URL to the
   submission.
3. Publish the required announcement on X or LinkedIn and include the actual
   post URL.
4. Submit the hackathon form(s) and retain the confirmation.
5. Before final submission, verify the public repository URL and any CreateOS
   application URL directly in a browser and paste only verified URLs into the
   form.

## Outstanding deployment work

The public source repository is delivered. A CreateOS upload project and
Production environment were created on the authenticated Free account, and
CreateOS reported successful builds/deployments. However, the public endpoint
previously returned HTTP 503; the latest deployment URL returned Cloudflare
HTTP 403 / error 1010 and later timed out. Its runtime status/log check cannot currently be
reached because of DNS resolution failure. The
direct shell resolver also fails for the CreateOS API hostname; a constrained
local HTTPS tunnel was used to complete CLI requests. The Stripe Projects
integration separately confirms the Free Sandbox resource. No paid service
was provisioned.

The repository now includes a multi-stage `Dockerfile`, packaged static UI,
and Python WSGI/HTTP production adapters that serve the UI and backend status
API from one origin. Public evolution POSTs are intentionally denied to avoid
unauthenticated provider quota/Sandbox use. The local production smoke test
passed; the CreateOS remote build completed, but the public runtime is not
healthy. Docker is unavailable in this WSL environment. Public LLM/Sandbox
evolution remains unconfigured and unverified.

Resolve the CreateOS runtime's HTTP 503 first, then verify the public HTTPS
page, backend status route, and desktop/mobile layout. If live evolution is to
be enabled, configure provider secrets using CreateOS's environment variable
interface (never commit or print them), and keep public POSTs protected from
unauthenticated quota use. See [CreateOS deployment docs](https://createos.sh/docs/CLI/Deployments/)
and [environment variable docs](https://createos.sh/docs/CLI/Environment-Variables/).

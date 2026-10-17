# GRID PRIX — Hackathon Submission Readiness

**Last checked:** October 17, 2026 (America/Sao_Paulo)

This page distinguishes verified repository evidence from platform actions that
have not completed. Historical experiment data is not live activity.

## Verified links and delivery state

| Item | Verified state |
| --- | --- |
| Public source repository | [github.com/santleme/grid-prix](https://github.com/santleme/grid-prix) — GitHub API verified `public`, default branch `master`, at commit [`40127c9`](https://github.com/santleme/grid-prix/commit/40127c9cebddedc828c1d092b266430fc6c23098). |
| CreateOS application URL | **Not deployed / no URL verified.** The authenticated CreateOS CLI reports the Free plan, but no CreateOS application project ID or deployment was obtained. Direct CLI API requests hit a shell DNS-resolution failure; a scoped connection workaround returned no usable project-list result. The CreateOS Stripe Projects resource is the Sandbox integration; it is not proof of an application deployment. |
| Stripe Projects | The read-only `stripe projects status --json` response reports project `grid-prix`, the CreateOS provider linked and complete, and both `createos-plan` and `createos-project` as Free and complete. Credential values were redacted by the CLI and were not copied here. |
| Screenshot evidence | [Desktop](../artifacts/screenshots/grid-prix-desktop.png), [mobile](../artifacts/screenshots/grid-prix-mobile.png), and [race view](../artifacts/screenshots/grid-prix-race-live.png). These are local UI captures, not remote deployment or AI execution evidence. |

The public CreateOS URL, production backend reachability, deployment health,
and hosted responsive behavior remain **unverified** until a successful deploy
and live smoke test are recorded. Do not advertise a placeholder as a live URL.

## Verified local checks

The following checks passed against the source tree on this date:

- `npm test` — 18 tests passed.
- `npm run test:python` — 30 tests passed, including the production web adapter.
- `npm run build` — TypeScript check and Vite production build passed.
- `git diff --check` — passed.
- Local production smoke test — frontend HTML and `/api/evolve/status` both
  returned HTTP 200; no model or Sandbox calls were made.
- A targeted scanner checked three reachable Git commits and the publishable
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

The source repository has been prepared for public delivery, but an application
deployment and production-secret configuration cannot be claimed yet. The
CreateOS CLI is installed and authenticated to the Free account. Direct
control-plane requests fail DNS resolution from this runtime; a scoped
connection retry did not yield an application project ID. The current Stripe
Projects integration confirms the Free Sandbox resource only. No additional
hosting resource, paid service, public application URL, or production
environment variable was provisioned or verified in this check.

The repository now includes a multi-stage `Dockerfile` and production Python
web adapter that serve the built UI and backend status API from one origin.
Public evolution POSTs are intentionally denied to avoid unauthenticated
provider quota/Sandbox use. The local production smoke test passed, but no
container build or public deployment has been run yet; Docker is unavailable
in this WSL environment. Public LLM/Sandbox evolution therefore remains
unconfigured and unverified.

Once CreateOS control-plane access is available, deploy the frontend and
backend from the published source, set secrets using CreateOS's environment
variable interface (never commit or print them), then verify the public HTTPS
page, backend status route, and desktop/mobile layout before replacing this
section with deployment evidence. See [CreateOS deployment docs](https://createos.sh/docs/CLI/Deployments/)
and [environment variable docs](https://createos.sh/docs/CLI/Environment-Variables/).

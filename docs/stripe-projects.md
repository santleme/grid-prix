# Stripe Projects setup (demo-safe)

GRID PRIX's economy is an in-game credit system. Credits and upgrades are
local demo state; they are not Stripe balances, charges, or payment methods.
The demo does not create Stripe resources, call Stripe APIs, request credentials,
or provision paid services.

## Connect the hackathon project

1. Open the GRID PRIX project in the Stripe Projects environment provided by
   the hackathon and follow its current project-specific setup instructions.
2. Add the project link and any required demo metadata to the submission form.
   Do not put secret keys, account identifiers, or customer data in this repo.
3. Run GRID PRIX locally with the normal frontend development command. No Stripe
   account, API key, webhook, payment flow, or paid service is needed to play.

The repository intentionally contains no Stripe secret configuration. If a
future version adds a real payment feature, it must be a separate, server-side
integration with explicit user approval, test-mode credentials, and its own
security and accounting review. It must not replace the current demo credits.

## Economy module

Import the pure functions from `economy/economy.mjs` (or its declaration file
for TypeScript consumers). `createLeagueEconomy()` returns
`{ teams: Record<TeamId, EconomyState> }` for `team-01` through `team-10`, each
with 1,000 credits. UI can display `league.teams[id].credits` and
`UPGRADES`; `purchaseTeamUpgrade(league, teamId, upgradeId)` returns
`{ ok, cost, league }` (or `{ ok: false, error, league }`) without mutating
existing state. Engine, handling, and shield upgrades have increasing costs
and expose effect multipliers through `getUpgradeEffects()` for the simulation
to apply.

For the simulation contract `race.results[{ place, teamId, points, ... }]`, call
`awardRaceResult(league, result)`. The team receives 100 participation credits,
a 300/200/100 podium bonus for places 1/2/3, plus the race's published points.

Run the module's tests with:

```sh
node --test economy/economy.test.mjs
```

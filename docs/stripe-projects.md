# Configure CreateOS with Stripe Projects

GRID PRIX uses Stripe Projects as the hackathon setup path for CreateOS. This
is separate from the fictional in-game credits: GRID PRIX does not charge
payments or represent team credits as Stripe balances.

## Setup

1. Install the official Stripe CLI and enable its Projects plugin using the
   [Stripe Projects documentation](https://docs.stripe.com/projects.md).
2. Authenticate the CLI when it opens its browser/device authorization flow.
   If the CLI reports `BROWSER_AUTH_REQUIRED` but cannot prepare the browser
   handoff, stop and complete/retry Stripe sign-in before running more Projects
   commands.
3. Initialize the local project and add the CreateOS integration:

   ```sh
   stripe projects init grid-prix
   stripe projects add createos/project
   stripe projects env --pull
   ```

   Stripe Projects writes local credentials to `.env`; the backend loads that
   file, and Vite reads only the optional proxy-token value server-side. The
   `.env` file is ignored by Git. The CreateOS integration is documented as a
   free-plan sandbox setup. Do not switch plans or provision paid services
   without explicit approval.
4. Follow CreateOS's [Stripe Projects integration guide](https://createos.sh/docs/Services/Stripe-Projects.md)
   to make the sandbox API credential available to the local backend. GRID
   PRIX also requires `OPENAI_API_KEY` and `OPENAI_MODEL` for actual LLM policy
   generation; add these through Stripe Projects' interactive variable prompt
   or configure them in the local ignored `.env`. Never commit or paste secret
   values into chat.
5. Start the policy service and UI as described in the
   [installation guide](../README.md#run-the-demo). `GET /api/evolve/status`
   reports missing configuration without contacting providers.

If sign-in or integration setup is incomplete, the race demo remains playable,
but policy evolution stays unavailable. A local success response is never
used to imply a real Stripe, LLM, or CreateOS Sandbox call.

## In-game economy

Team prize credits are local, fictional demo state. `economy/economy.mjs`
defines ten teams, deterministic race rewards, and the four upgrade categories
(`engine`, `aerodynamics`, `tires`, `weight`). It does not create Stripe
charges, customers, payment methods, or real-money balances.

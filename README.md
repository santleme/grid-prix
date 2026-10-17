# GRID PRIX

GRID PRIX is a deterministic, Tron-inspired AI racing championship demo for
the CreateOS × Stripe Projects Hackathon. Twenty algorithmic drivers race for
ten teams in a 2D Canvas arena. Completed races feed an optional LLM policy
evolution service that generates Python candidates, executes them in real
CreateOS Sandboxes, and adopts a candidate only when it beats the baseline on
held-out telemetry.

## Run the demo

Requirements: Node.js 20+, Python 3.10+, and npm.

```sh
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run dev
```

Open the Vite URL (usually <http://localhost:5173>). The deterministic race,
leaderboard, telemetry, replay, team economy, and upgrades work without API
credentials. The LLM/Sandbox evolution control stays unavailable until its
server-side credentials are configured.

To enable real policy evolution, set these environment variables in the shell
running the backend (never commit or paste secret values into source or chat):

```sh
export OPENAI_API_KEY='…'
export OPENAI_MODEL='your-compatible-chat-model'
export CREATEOS_API_KEY='…'
# Optional OpenAI-compatible endpoint and local API bearer token:
export OPENAI_BASE_URL='https://api.openai.com/v1'
export GRID_PRIX_EVOLVE_TOKEN='…'
```

If you configured these through Stripe Projects, run
`stripe projects env --pull` after setup instead of exporting them manually. GRID PRIX loads the
ignored local `.env` on the Python backend and reads only the optional proxy
token in the Vite server config.

Start the backend in one terminal and Vite in another:

```sh
npm run dev:evolution
npm run dev
```

The backend binds only to `127.0.0.1:8787`; Vite proxies requests from the UI.
Each sandbox uses the CreateOS `s-1vcpu-1gb` shape, a 30-second policy
execution timeout, and a deny-by-default egress allowlist. See
[`docs/policy-evolution.md`](docs/policy-evolution.md) for the API, benchmark,
and safety contract and [`docs/stripe-projects.md`](docs/stripe-projects.md)
for CreateOS setup through Stripe Projects.

## Verify

```sh
npm run build
npm test
npm run test:python
```

Live LLM/CreateOS calls require valid credentials and are intentionally not
simulated by tests. No paid services are provisioned by the application.

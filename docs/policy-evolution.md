# Local policy evolution service

The UI's `POST /api/evolve` request is proxied by Vite to a loopback-only Python
service. The service keeps both provider credentials on the server and refuses
to return candidate metrics/source unless the configured model produced code
and CreateOS actually executed and scored it.

## Configure and run

Use Python 3.10+ and install the sandbox SDK:

```sh
python3 -m pip install -r requirements.txt
export OPENAI_API_KEY='…'
export OPENAI_MODEL='your-compatible-chat-model'
export CREATEOS_API_KEY='…'
# Optional OpenAI-compatible provider; defaults to https://api.openai.com/v1.
export OPENAI_BASE_URL='https://api.openai.com/v1'
# Optional local backend bearer token, injected by the Vite dev proxy.
export GRID_PRIX_EVOLVE_TOKEN='…'
```

Start the evolution service in one terminal and the UI in another:

```sh
npm run dev:evolution
npm run dev
```

The backend binds only to `127.0.0.1:8787`; Vite proxies `/api` locally. If a
token is configured, Vite adds it server-side and the browser never receives
it. Requests are restricted to loopback `Host`/`Origin`, JSON bodies are capped
at 2 MB, model requests time out after 20 seconds, and each policy execution is
bounded to 30 seconds in a 1-vCPU/1-GB CreateOS sandbox.

## HTTP contract

`GET /api/evolve/status` returns `{available, status, missing, message}`. It
checks configuration only; it does not contact either provider or claim a live
connection.

`POST /api/evolve` accepts the existing UI payload:

```json
{
  "seed": 2026,
  "race": [{"place": 1, "driverId": "driver-01"}],
  "telemetry": [{"tick": 1, "drivers": [{"id": "driver-01", "x": 1, "y": 2, "heading": 0.2, "speed": 3, "lap": 0, "place": 1}]}]
}
```

Success returns `EvolutionView` fields plus `accepted`, `metric`, `analysis`,
and `trainingScore`. A missing credential/configuration returns a non-2xx JSON
error; malformed telemetry is rejected and non-consecutive frames are excluded
from the benchmark. At least 10 valid transitions are required.

The metric is explicitly **held-out steering agreement with observed
race-transition headings**, not a claim that the new policy improves race
results. Transitions are deterministically split 80/20 by the supplied seed;
the model sees only training states, not held-out labels. A zero-control Python
baseline and each LLM candidate are executed in separate real sandboxes for
training and validation. Candidate source is selected only when its held-out
score is strictly above the baseline; otherwise the baseline is retained.
CreateOS sandboxes use a nonempty TEST-NET egress allowlist (deny by default),
so generated code cannot access the network. The OpenAI-compatible key and
CreateOS account key are never uploaded to the sandbox.

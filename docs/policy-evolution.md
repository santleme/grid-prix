# Local policy evolution service

The UI's `POST /api/evolve` request is proxied by Vite to a loopback-only Python
service. The service keeps both provider credentials on the server and refuses
to return candidate metrics/source unless the configured model produced code
and CreateOS actually executed and scored it.

## Configure and run

Use Python 3.10+ and install the sandbox SDK:

```sh
python3 -m pip install -r requirements.txt
```

Groq is the default OpenAI-compatible provider:

```dotenv
GROQ_API_KEY=…
# Defaults: openai/gpt-oss-20b and https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-20b
GROQ_BASE_URL=https://api.groq.com/openai/v1
```

If `GROQ_API_KEY` is absent, OpenAI is an optional fallback and requires both
`OPENAI_API_KEY` and `OPENAI_MODEL`; `OPENAI_BASE_URL` is optional. Set the
optional `GRID_PRIX_EVOLVE_TOKEN` in `.env` for a local API bearer token. Never
commit or paste provider secrets. Live Groq requests must stay within free
quota unless paid usage is explicitly authorized.

Stripe Projects supplies `CREATEOS_PROJECT_API_KEY`; the backend accepts that
key directly, and the Sandbox SDK uses its documented default API endpoint.
No manual alias or secret copy is needed for CreateOS.

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

`POST /api/evolve` accepts the race drivers and recent telemetry:

```json
{
  "seed": 2026,
  "race": [{"place": 1, "driverId": "driver-01"}],
  "telemetry": [{"tick": 1, "drivers": [{"id": "driver-01", "x": 1, "y": 2, "heading": 0.2, "speed": 3, "lap": 0, "place": 1}]}]
}
```

Success returns an independent result/history/usage record for each of 20
drivers, plus aggregate provider usage and legacy top-level selected-policy
fields. Per-driver code histories and cumulative inference totals persist in
the ignored `.grid_prix/driver-policies.json`. Inference runs sequentially and
uses a prompt token ceiling, a rolling Groq token budget, conservative RPM
pacing, `Retry-After`, and jittered exponential backoff for 429/5xx/network
errors. A missing credential/configuration returns a non-2xx JSON error;
malformed telemetry is rejected and non-consecutive frames are excluded from
the benchmark. At least 10 valid transitions per driver are required.

Groq requests use strict JSON Schema output, which is supported by the default
`openai/gpt-oss-20b` model. A 400 is retried once at a larger completion budget
only when the response explicitly identifies completion-token exhaustion;
schema/configuration 400s fail fast. Generated Python is parsed and checked
before Sandbox execution. A syntax error receives at most one bounded repair
request; imports and restricted names are rejected rather than executed.

The metric is explicitly **held-out steering agreement with observed
race-transition headings**, not a claim that the new policy improves race
results. Transitions are deterministically split 80/20 by the supplied seed;
the model sees only training states, not held-out labels. A zero-control Python
baseline and each LLM candidate are executed in separate real sandboxes for
training and validation. Candidate source is selected only when its held-out
score is strictly above the baseline; otherwise the baseline is retained.
CreateOS sandboxes use a nonempty TEST-NET egress allowlist (deny by default),
so generated code cannot access the network. A run creates exactly one
`s-1vcpu-1gb` VM and sequentially executes each driver's baseline and candidate
in it, then destroys and waits for reclamation. Groq/OpenAI and CreateOS keys
are never uploaded to the sandbox. The model sees only each driver's own
training observations and prior source; held-out labels remain private.

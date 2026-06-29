# Enterprise scale plane — Azure OpenAI behind an APIM load balancer

This is the production "intelligent routing" plane (README §7, enterprise tier).
It implements the pattern from Azure's
[OpenAI + APIM load-balancing sample](https://learn.microsoft.com/en-us/samples/azure-samples/openai-apim-lb/openai-apim-lb/):
an **Azure API Management** gateway that spreads load across **multiple Azure
OpenAI backends**, trips a **circuit breaker** on a throttled/erroring region and
fails over automatically — exposed to the app as a single OpenAI-compatible
endpoint, authenticated to OpenAI with a **managed identity** (no keys).

## Why it exists

A single Azure OpenAI deployment has a fixed tokens-per-minute (TPM) quota. On
results day a whole district hits it at once → HTTP 429 → the product stalls.
Pooling N regional backends multiplies throughput and adds regional resilience;
the gateway makes that pool look like one endpoint, so the app never changes.

## Architecture

```
  app/router  ──api-key──▶  APIM gateway (openpathshala-apim)
                              │  • load-balanced backend POOL (priority/weight)
                              │  • circuit breaker per backend (429/5xx → trip 30s)
                              │  • retry to a healthy backend
                              │  • managed-identity auth to OpenAI (no keys)
                              ├─────────────▶ Azure OpenAI · East US   (gpt-5-mini)
                              └─────────────▶ Azure OpenAI · East US 2 (gpt-5-mini)
```

The app calls it exactly like a normal Azure OpenAI endpoint — the APIM
**subscription key is sent in the `api-key` header**, so the OpenAI SDK / our
router need no special casing:

```
POST https://openpathshala-apim.azure-api.net/openai/deployments/gpt-5-mini/chat/completions?api-version=2025-04-01-preview
api-key: <APIM subscription key>
```

Every response carries `x-openpathshala-backend: op-aoai-<region>.openai.azure.com`
so the UI can show which region served the request (see the "Enterprise" toggle
and the meta bar on the live site).

## Provisioned resources (subscription `Azure subscription 1`)

| Resource | Name | Region |
|---|---|---|
| Resource group | `openpathshala-rg` | eastus |
| APIM (Consumption) | `openpathshala-apim` (system-assigned identity) | eastus |
| Azure OpenAI #1 | `op-aoai-eastus` → deployment `gpt-5-mini` | eastus |
| Azure OpenAI #2 | `op-aoai-eastus2` → deployment `gpt-5-mini` | eastus2 |
| APIM backends | `aoai-eastus`, `aoai-eastus2` (circuit breakers) | — |
| APIM backend pool | `aoai-pool` (priority 1 / weight 1 each) | — |
| APIM API | `azure-openai` (path `/openai`, sub-key header `api-key`) | — |
| Role assignment | APIM identity → **Cognitive Services OpenAI User** on both accounts | — |

## The routing policy

Applied at the API level (`apis/azure-openai/policies/policy`):

```xml
<policies>
  <inbound>
    <base />
    <set-backend-service backend-id="aoai-pool" />            <!-- pool: LB + circuit breaker -->
    <authentication-managed-identity resource="https://cognitiveservices.azure.com" />
    <set-header name="api-key" exists-action="delete" />       <!-- don't forward the APIM key -->
    <set-header name="Ocp-Apim-Subscription-Key" exists-action="delete" />
  </inbound>
  <backend>
    <retry condition="@(context.Response.StatusCode == 429 || context.Response.StatusCode >= 500)"
           count="2" interval="0" first-fast-retry="true">
      <forward-request buffer-request-body="true" />
    </retry>
  </backend>
  <outbound>
    <base />
    <set-header name="x-openpathshala-backend" exists-action="override">
      <value>@(context.Request.Url.Host)</value>
    </set-header>
  </outbound>
  <on-error><base /></on-error>
</policies>
```

Each backend declares a circuit breaker:

```json
"circuitBreaker": { "rules": [{
  "name": "openAIBreaker",
  "failureCondition": { "count": 3, "interval": "PT1M",
    "statusCodeRanges": [{"min":429,"max":429},{"min":500,"max":599}] },
  "tripDuration": "PT30S", "acceptRetryAfter": true }]}
```

## Reproduce

`deploy.sh` provisions the whole plane idempotently. Cost is low: APIM
**Consumption** tier is pay-per-call (1M free calls/month); Azure OpenAI
Standard deployments bill **per token only** (no idle cost).

```bash
az login                 # already done in this environment
./deploy/azure/deploy.sh # creates RG, 2x AOAI + deployments, APIM, pool, policy, subscription
```

It prints the gateway URL and subscription key at the end. Wire them into the
app via SSM (see below) — the key is never committed.

## App wiring (AWS Lambda)

The Node app (`web/`) reads these — the APIM key lives only in SSM:

| Env var | Value |
|---|---|
| `AZURE_APIM_ENDPOINT` | `https://openpathshala-apim.azure-api.net` |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-5-mini` |
| `AZURE_OPENAI_API_VERSION` | `2025-04-01-preview` |
| `AZURE_APIM_SSM_PARAM` | `/openpathshala/azure-apim-key` (SecureString) |

The router (`web/lib/router.js`) sends `reasoning_effort` (minimal/low/medium by
tier) to keep GPT-5 latency well under API Gateway's 30s cap and to control cost.

## Scaling further

- **Add a region:** create another `op-aoai-<region>` + deployment, add a
  `backends/aoai-<region>` with a circuit breaker, and append it to the pool's
  `services` list. No app change.
- **Priorities:** give a primary region `priority 1` and a spillover region
  `priority 2` — the pool only uses priority 2 when all priority-1 backends are
  tripped (active/passive). Equal priority + weights = active/active (current).
- **PTUs:** swap a Standard deployment for a Provisioned (PTU) one for
  guaranteed throughput; the pool and policy are unchanged.

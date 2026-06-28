# Deploying OpenPathshala on AWS

The hosted prototype runs at **https://pathshala.distillai.in**. This document
describes the exact, reproducible architecture used.

## Architecture (serverless, no Docker required)

```
  pathshala.distillai.in (Route53 A/AAAA alias)
            │
            ▼
   CloudFront distribution  ──(ACM cert, us-east-1)── TLS for the custom domain
            │  CachingDisabled + AllViewerExceptHostHeader
            ▼
   API Gateway HTTP API  (z…​.execute-api.ap-south-1, $default route)
            │  AWS_PROXY integration, payload format 2.0
            ▼
   Lambda  openpathshala  (Node 20, arm64)
     ├─ Express app (server.js) via serverless-http (lambda.js)
     ├─ serves the static site (public/) AND the /api/* endpoints
     └─ Groq key resolved at cold start from SSM Parameter Store
            │
            ▼
   SSM Parameter Store  /openpathshala/groq-api-key  (SecureString)
```

**Why this shape**

- **No container build.** The host has no Docker, so instead of the ECR + App
  Runner pattern (used by `healing.distillai.in`), the app ships as a Lambda zip.
- **The LLM key never leaves AWS in plaintext.** It lives only as an SSM
  `SecureString`; the Lambda reads it at cold start with `WithDecryption`. It is
  **not** in the image, **not** in the repo, and **not** a plaintext env var.
- **API Gateway HTTP API as the origin.** CloudFront fronts a regional HTTP API
  with an `AWS_PROXY` integration (payload format 2.0). This avoids the public
  Lambda Function URL — which this account's guardrails block (`AuthType: NONE`
  returns 403) — and is simpler and more reliable than the Function-URL + OAC
  signing combination for an API that takes POST bodies.
- **No caching for the API.** The default cache behavior uses the managed
  `CachingDisabled` policy and the `AllViewerExceptHostHeader` origin-request
  policy so POST bodies and headers pass through to API Gateway intact.

## Provisioned resources (account 556145169823)

| Resource | Name / ID | Region |
|---|---|---|
| Lambda function | `openpathshala` | ap-south-1 |
| Lambda execution role | `openpathshala-lambda-role` (+ inline `openpathshala-ssm-read`) | global |
| API Gateway HTTP API | `openpathshala-http` (`$default` route → Lambda) | ap-south-1 |
| SSM SecureString | `/openpathshala/groq-api-key` | ap-south-1 |
| ACM certificate | `pathshala.distillai.in` | us-east-1 |
| CloudFront distribution | alias `pathshala.distillai.in`, origin = API Gateway | global |
| Route53 records | `pathshala.distillai.in` A + AAAA alias | distillai.in zone |

## Reproduce / update

- **First-time provisioning:** see [`deploy.sh`](./deploy.sh). It is idempotent
  where practical and documents every CLI call. Set `GROQ_API_KEY` in your
  environment (or in `web/.env`) before running — it is written to SSM, never
  echoed.
- **Code updates (re-deploy the Lambda only):**

  ```bash
  cd web
  npm install --omit=dev
  zip -rq /tmp/op.zip . -x "*.DS_Store" "*.env"
  aws lambda update-function-code \
    --region ap-south-1 --function-name openpathshala \
    --zip-file fileb:///tmp/op.zip
  # then invalidate CloudFront so the static assets refresh:
  aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/*"
  ```

- **Rotate the Groq key:**

  ```bash
  aws ssm put-parameter --region ap-south-1 \
    --name /openpathshala/groq-api-key --type SecureString \
    --value "$NEW_KEY" --overwrite
  # restart cold start to pick it up (publish a no-op config update):
  aws lambda update-function-configuration --region ap-south-1 \
    --function-name openpathshala --description "rotate $(date +%F)"
  ```

## Cost

Effectively pennies at demo volume: Lambda (arm64, 512 MB, ~1–3 s/request) is
within or near the free tier; CloudFront and Route53 are negligible; the only
real variable cost is Groq inference, which is rate-limited per IP in
[`server.js`](../../web/server.js). See README §8 for the full cost model.

## Production hardening (beyond the prototype)

- Split static assets to S3 + CloudFront (cache them) and keep only `/api/*` on Lambda.
- Add a WAF rate-limit rule in front of CloudFront.
- Move from a shared demo key to per-tenant keys / budget caps (README §8.2).
- Add request logging to CloudWatch with PII redaction (README §9).

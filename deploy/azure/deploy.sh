#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OpenPathshala — enterprise scale plane: Azure OpenAI + APIM load balancer
# ---------------------------------------------------------------------------
# Provisions: RG, 2x Azure OpenAI (eastus + eastus2) with gpt-5-mini, an APIM
# Consumption gateway with system identity, a load-balanced backend POOL with
# circuit breakers, the OpenAI API + routing policy, and a subscription key.
# Auth to OpenAI is via managed identity — no keys in the policy.
#
# Prereqs: `az login`. Cost: APIM Consumption ~free at demo volume; AOAI bills
# per token only. Run from the repo root.  Idempotent where practical.
# ---------------------------------------------------------------------------
set -euo pipefail

RG=openpathshala-rg
LOC1=eastus
LOC2=eastus2
APIM=openpathshala-apim
AOAI1=op-aoai-eastus
AOAI2=op-aoai-eastus2
DEPLOY=gpt-5-mini
MODEL_VER=2025-08-07
AV=2024-06-01-preview            # ARM management api-version
SUB=$(az account show --query id -o tsv)
APIMBASE="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ApiManagement/service/$APIM"

echo "==> resource group + provider"
az group create -n $RG -l $LOC1 -o none
az provider register -n Microsoft.ApiManagement -o none || true

echo "==> APIM (Consumption) — async"
az apim show -n $APIM -g $RG -o none 2>/dev/null || \
  az apim create -n $APIM -g $RG -l $LOC1 --sku-name Consumption \
    --publisher-email infra@distillai.in --publisher-name "OpenPathshala" --no-wait

echo "==> Azure OpenAI accounts + gpt-5-mini deployments"
for pair in "$AOAI1:$LOC1" "$AOAI2:$LOC2"; do
  name=${pair%%:*}; loc=${pair##*:}
  az cognitiveservices account show -n $name -g $RG -o none 2>/dev/null || \
    az cognitiveservices account create -n $name -g $RG -l $loc --kind OpenAI --sku S0 \
      --custom-domain $name --yes -o none
  az cognitiveservices account deployment show -n $name -g $RG --deployment-name $DEPLOY -o none 2>/dev/null || \
    az cognitiveservices account deployment create -n $name -g $RG \
      --deployment-name $DEPLOY --model-name $DEPLOY --model-version "$MODEL_VER" \
      --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50 -o none
done

echo "==> APIM managed identity + OpenAI role on both backends"
az resource update --ids "$(az apim show -n $APIM -g $RG --query id -o tsv)" --set identity.type=SystemAssigned -o none
# wait until APIM finished provisioning so the identity exists
until [ "$(az apim show -n $APIM -g $RG --query provisioningState -o tsv 2>/dev/null)" = "Succeeded" ]; do sleep 15; done
PID=$(az apim show -n $APIM -g $RG --query identity.principalId -o tsv)
for name in $AOAI1 $AOAI2; do
  scope=$(az cognitiveservices account show -n $name -g $RG --query id -o tsv)
  az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal \
    --role "Cognitive Services OpenAI User" --scope "$scope" -o none 2>/dev/null || true
done

mgmt(){ az rest --method put --uri "https://management.azure.com$1?api-version=$AV" \
  --headers "Content-Type=application/json" --body "$2" -o none; }

echo "==> backends (circuit breakers) + load-balanced pool"
CB='"circuitBreaker":{"rules":[{"name":"openAIBreaker","failureCondition":{"count":3,"interval":"PT1M","statusCodeRanges":[{"min":429,"max":429},{"min":500,"max":599}]},"tripDuration":"PT30S","acceptRetryAfter":true}]}'
mgmt "$APIMBASE/backends/aoai-eastus"  "{\"properties\":{\"url\":\"https://$AOAI1.openai.azure.com/openai\",\"protocol\":\"http\",$CB}}"
mgmt "$APIMBASE/backends/aoai-eastus2" "{\"properties\":{\"url\":\"https://$AOAI2.openai.azure.com/openai\",\"protocol\":\"http\",$CB}}"
mgmt "$APIMBASE/backends/aoai-pool" "{\"properties\":{\"type\":\"Pool\",\"pool\":{\"services\":[{\"id\":\"$APIMBASE/backends/aoai-eastus\",\"priority\":1,\"weight\":1},{\"id\":\"$APIMBASE/backends/aoai-eastus2\",\"priority\":1,\"weight\":1}]}}}"

echo "==> API + operation + routing policy"
mgmt "$APIMBASE/apis/azure-openai" '{"properties":{"displayName":"Azure OpenAI (Load Balanced)","path":"openai","protocols":["https"],"subscriptionRequired":true,"subscriptionKeyParameterNames":{"header":"api-key","query":"subscription-key"},"serviceUrl":"https://'$AOAI1'.openai.azure.com/openai"}}'
mgmt "$APIMBASE/apis/azure-openai/operations/chat-completions" '{"properties":{"displayName":"Chat Completions","method":"POST","urlTemplate":"/deployments/{deployment-id}/chat/completions","templateParameters":[{"name":"deployment-id","type":"string","required":true}]}}'
POLICY='<policies><inbound><base /><set-backend-service backend-id="aoai-pool" /><authentication-managed-identity resource="https://cognitiveservices.azure.com" /><set-header name="api-key" exists-action="delete" /><set-header name="Ocp-Apim-Subscription-Key" exists-action="delete" /></inbound><backend><retry condition="@(context.Response.StatusCode == 429 || context.Response.StatusCode >= 500)" count="2" interval="0" first-fast-retry="true"><forward-request buffer-request-body="true" /></retry></backend><outbound><base /><set-header name="x-openpathshala-backend" exists-action="override"><value>@(context.Request.Url.Host)</value></set-header></outbound><on-error><base /></on-error></policies>'
python3 -c "import json,sys;print(json.dumps({'properties':{'format':'xml','value':sys.argv[1]}}))" "$POLICY" > /tmp/op-azpol.json
az rest --method put --uri "https://management.azure.com$APIMBASE/apis/azure-openai/policies/policy?api-version=$AV" \
  --headers "Content-Type=application/json" --body @/tmp/op-azpol.json -o none

echo "==> subscription + key"
mgmt "$APIMBASE/subscriptions/openpathshala-app" "{\"properties\":{\"scope\":\"$APIMBASE/apis/azure-openai\",\"displayName\":\"OpenPathshala App\",\"state\":\"active\"}}"
KEY=$(az rest --method post --uri "https://management.azure.com$APIMBASE/subscriptions/openpathshala-app/listSecrets?api-version=$AV" --query primaryKey -o tsv)

echo ""
echo "Gateway : https://$APIM.azure-api.net"
echo "Endpoint: https://$APIM.azure-api.net/openai/deployments/$DEPLOY/chat/completions?api-version=2025-04-01-preview"
echo "Store the subscription key in SSM (never commit it):"
echo "  aws ssm put-parameter --name /openpathshala/azure-apim-key --type SecureString --value '$KEY' --overwrite"

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# OpenPathshala — reproducible AWS deploy (serverless, no Docker)
# ---------------------------------------------------------------------------
# Deploys the web/ prototype to:  Lambda + Function URL + CloudFront(OAC) + ACM
# behind  https://pathshala.distillai.in
#
# Prereqs:  awscli v2, node, zip, an AWS identity with admin on the account,
# and the Groq key available as $GROQ_API_KEY (or in web/.env).
#
# The Groq key is written ONLY to SSM Parameter Store (SecureString). It is
# never baked into the image, committed, or stored as a plaintext env var.
# ---------------------------------------------------------------------------
set -euo pipefail

# ---- config ----------------------------------------------------------------
DOMAIN="pathshala.distillai.in"
HOSTED_ZONE_ID="Z0482096P3BCFB8672U7"   # distillai.in
FN="openpathshala"
ROLE="openpathshala-lambda-role"
SSM_PARAM="/openpathshala/groq-api-key"
APP_REGION="ap-south-1"                  # Lambda lives here
CF_ZONE="Z2FDTNDATAQYW2"                 # fixed CloudFront alias hosted-zone id
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---- 0. resolve the Groq key (never echoed) --------------------------------
if [ -z "${GROQ_API_KEY:-}" ] && [ -f "$ROOT/web/.env" ]; then
  set -a; . "$ROOT/web/.env"; set +a
fi
: "${GROQ_API_KEY:?Set GROQ_API_KEY or put it in web/.env}"

# ---- 1. SSM SecureString ---------------------------------------------------
echo "==> Writing Groq key to SSM ($SSM_PARAM)"
aws ssm put-parameter --region "$APP_REGION" --name "$SSM_PARAM" \
  --type SecureString --value "$GROQ_API_KEY" --overwrite >/dev/null

# ---- 2. IAM role -----------------------------------------------------------
echo "==> Ensuring IAM role $ROLE"
aws iam create-role --role-name "$ROLE" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  >/dev/null 2>&1 || true
aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true
aws iam put-role-policy --role-name "$ROLE" --policy-name openpathshala-ssm-read \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameter\"],\"Resource\":\"arn:aws:ssm:$APP_REGION:$ACCOUNT_ID:parameter$SSM_PARAM\"}]}" >/dev/null
ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE"

# ---- 3. package ------------------------------------------------------------
echo "==> Packaging Lambda zip"
BUILD="$(mktemp -d)"; ZIP="$(mktemp -u).zip"
cp -r "$ROOT/web/lib" "$ROOT/web/public" "$ROOT/web/server.js" \
      "$ROOT/web/lambda.js" "$ROOT/web/package.json" "$BUILD/"
( cd "$BUILD" && npm install --omit=dev --no-audit --no-fund >/dev/null && zip -rq "$ZIP" . -x "*.DS_Store" )

# ---- 4. create or update the function --------------------------------------
if aws lambda get-function --region "$APP_REGION" --function-name "$FN" >/dev/null 2>&1; then
  echo "==> Updating Lambda code"
  aws lambda update-function-code --region "$APP_REGION" --function-name "$FN" \
    --zip-file "fileb://$ZIP" >/dev/null
else
  echo "==> Creating Lambda"
  sleep 8 # role propagation
  aws lambda create-function --region "$APP_REGION" --function-name "$FN" \
    --runtime nodejs20.x --role "$ROLE_ARN" --handler lambda.handler \
    --zip-file "fileb://$ZIP" --timeout 30 --memory-size 512 --architectures arm64 \
    --environment "Variables={GROQ_SSM_PARAM=$SSM_PARAM,RATE_LIMIT_PER_MIN=20,NODE_ENV=production}" \
    --description "OpenPathshala prototype" >/dev/null
fi
aws lambda wait function-active --region "$APP_REGION" --function-name "$FN"

# ---- 5. Function URL (private, IAM auth) -----------------------------------
echo "==> Function URL (AWS_IAM)"
aws lambda create-function-url-config --region "$APP_REGION" --function-name "$FN" \
  --auth-type AWS_IAM >/dev/null 2>&1 || \
aws lambda update-function-url-config --region "$APP_REGION" --function-name "$FN" \
  --auth-type AWS_IAM >/dev/null
FU_HOST=$(aws lambda get-function-url-config --region "$APP_REGION" --function-name "$FN" \
  --query FunctionUrl --output text | sed -E 's#https://([^/]+)/#\1#')
echo "    origin: $FU_HOST"

# ---- 6. ACM cert (us-east-1, DNS validated) --------------------------------
echo "==> ACM certificate for $DOMAIN (us-east-1)"
CERT_ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [ "$CERT_ARN" = "None" ] || [ -z "$CERT_ARN" ]; then
  CERT_ARN=$(aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" \
    --validation-method DNS --query CertificateArn --output text)
  sleep 6
  read -r VN VV < <(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
    --query "Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]" --output text)
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch \
    "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$VN\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$VV\"}]}}]}" >/dev/null
  echo "    waiting for cert validation..."
  aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"
fi
echo "    cert: $CERT_ARN"

# ---- 7. CloudFront OAC + distribution --------------------------------------
echo "==> CloudFront OAC + distribution"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='openpathshala-lambda-oac'].Id | [0]" --output text)
if [ "$OAC_ID" = "None" ] || [ -z "$OAC_ID" ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    '{"Name":"openpathshala-lambda-oac","Description":"OAC for OpenPathshala","SigningProtocol":"sigv4","SigningBehavior":"always","OriginAccessControlOriginType":"lambda"}' \
    --query "OriginAccessControl.Id" --output text)
fi

DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Aliases.Items, '$DOMAIN')].Id | [0]" --output text 2>/dev/null || echo "None")
if [ "$DIST_ID" = "None" ] || [ -z "$DIST_ID" ]; then
  CFG=$(cat <<JSON
{
  "CallerReference": "openpathshala-$(date +%s)",
  "Aliases": {"Quantity": 1, "Items": ["$DOMAIN"]},
  "DefaultRootObject": "index.html",
  "Comment": "OpenPathshala prototype",
  "Enabled": true, "HttpVersion": "http2and3", "IsIPV6Enabled": true,
  "Origins": {"Quantity": 1, "Items": [{
    "Id": "lambda-openpathshala", "DomainName": "$FU_HOST",
    "OriginAccessControlId": "$OAC_ID",
    "CustomOriginConfig": {"HTTPPort":80,"HTTPSPort":443,"OriginProtocolPolicy":"https-only","OriginSslProtocols":{"Quantity":1,"Items":["TLSv1.2"]},"OriginReadTimeout":30,"OriginKeepaliveTimeout":5}
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "lambda-openpathshala", "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {"Quantity":7,"Items":["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],"CachedMethods":{"Quantity":2,"Items":["GET","HEAD"]}},
    "Compress": true,
    "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  },
  "ViewerCertificate": {"ACMCertificateArn": "$CERT_ARN","SSLSupportMethod": "sni-only","MinimumProtocolVersion": "TLSv1.2_2021"},
  "PriceClass": "PriceClass_All"
}
JSON
)
  read -r DIST_ID DIST_ARN < <(aws cloudfront create-distribution --distribution-config "$CFG" \
    --query "Distribution.[Id,ARN]" --output text)
else
  DIST_ARN="arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DIST_ID"
fi
echo "    distribution: $DIST_ID"

# ---- 8. allow this distribution to invoke the function URL ------------------
aws lambda add-permission --region "$APP_REGION" --function-name "$FN" \
  --statement-id AllowCloudFrontOAC --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com --source-arn "$DIST_ARN" \
  --function-url-auth-type AWS_IAM >/dev/null 2>&1 || true

# ---- 9. Route53 alias to CloudFront ----------------------------------------
echo "==> Route53 alias $DOMAIN -> CloudFront"
CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query "Distribution.DomainName" --output text)
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch \
  "{\"Changes\":[
    {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$DOMAIN.\",\"Type\":\"A\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$CF_DOMAIN.\",\"EvaluateTargetHealth\":false}}},
    {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$DOMAIN.\",\"Type\":\"AAAA\",\"AliasTarget\":{\"HostedZoneId\":\"$CF_ZONE\",\"DNSName\":\"$CF_DOMAIN.\",\"EvaluateTargetHealth\":false}}}
  ]}" >/dev/null

echo ""
echo "Done. https://$DOMAIN  (CloudFront $DIST_ID may take a few minutes to deploy)"

#!/usr/bin/env bash
# Usage: AWS_PROFILE=practice AWS_REGION=ap-south-1 ADMIN_EMAIL=you@example.com bash deploy.sh
set -euo pipefail
: "${AWS_PROFILE:?set AWS_PROFILE}"; : "${AWS_REGION:?set AWS_REGION}"; : "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
export AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
cd "$(dirname "$0")"

PL=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text)

# Dashboard: same-origin API (CloudFront routes /internal and /v1 to the API), real backend, no mock.
( cd ../web && npm ci && VITE_USE_MOCK=false VITE_API_URL= npm run build )
npm install
ACCT=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap "aws://$ACCT/$AWS_REGION" 2>&1 | tail -3
npx cdk deploy --require-approval never -c adminEmail="$ADMIN_EMAIL" -c cfPrefixList="$PL" --outputs-file cdk-outputs.json
cat cdk-outputs.json

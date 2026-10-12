# CP console — Remix integration

## 1. deps (frontend/)
npm i adm-zip ejs @aws-sdk/client-s3 @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
npm i -D @types/adm-zip @types/ejs

## 2. copy files
app/lib/cp/*            -> frontend/app/lib/cp/
app/routes/*            -> frontend/app/routes/
ALSO copy mf-runtime.js (unchanged, from main app DynamicCPUI/) -> frontend/app/lib/cp/mf-runtime.js

## 3. frontend/.env  (add)
AWS_REGION=us-west-2
CP_TABLE=globacom-cp-onboarding
CP_PACKAGES_BUCKET=globacom-cp-packages
CP_PACKAGES_REGION=us-west-2
# AWS creds: IAM role or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

## 4. delete / ignore (old Express dashboard)
Dashboard/server/* (server.js, routes/cp.js, routes/cpPreview.js, services/*) , Dashboard/index.html
No proxy needed. /api/cps/* now served by Remix.

## 5. menuItems.ts
add entry -> /cp-console

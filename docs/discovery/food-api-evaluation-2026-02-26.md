# Food API Evaluation (As Of 2026-02-26)

## Decision Status
- Approved on 2026-02-26: fatsecret Platform API selected for MVP nutrition data integration.

## Decision Goal
Select the best food/nutrition API for calorie and macronutrient planning/tracking with strong data consistency, reliability, and pricing fit.

## Candidates Reviewed
- USDA FoodData Central (FDC)
- fatsecret Platform API
- Edamam Nutrition Analysis API
- Nutritionix Track API (limited public information due portal access restrictions)

## Evidence Summary

| API | Data Consistency Signals | Reliability Signals | Pricing Signals | Key Constraints |
|---|---|---|---|---|
| USDA FoodData Central | Official USDA source; public domain (CC0); published release cadence by dataset | Government-backed dataset operations; documented API rate limits | API access is free with data.gov key | Mostly raw nutrient/food data; less productized for consumer diary workflows |
| fatsecret Platform | Claims verified items, zero duplicates, daily updates, broad country datasets | Publishes large-scale usage metrics and offers SLA in Premier | Basic is free with limits; Premier pricing is quote-based by market | Non-US breadth requires Premier/commercial engagement |
| Edamam Nutrition Analysis | Strong NLP + nutrition extraction capabilities | Commercial service with defined plans and throughput limits | Transparent starting prices ($29/mo basic tier) | Strict attribution/caching rules; older nutrition API version is retired |
| Nutritionix | Mature API surface for natural language and item search | Public docs reachable, but current portal access/pricing not openly retrievable in this environment | Pricing details not publicly verifiable from crawler-accessible pages | Selection risk until commercial terms and uptime posture are confirmed directly |

## Recommendation
Primary recommendation: **fatsecret Platform API** for this product model.

Reasoning:
- Strong fit for global student/professional app use cases (country-localized foods, branded data, barcode, NLP add-ons).
- Strong consistency/reliability signals published by vendor (verified items, duplicate controls, frequent updates, large usage footprint).
- Has a free entry tier for prototyping and a clear path to enterprise support/SLA.

## Practical Plan
1. Start integration spikes with fatsecret Basic/Premier Free eligibility.
2. Request Premier quote early for target launch markets.
3. Keep USDA FDC as a reference fallback source for nutrient normalization and cost-risk mitigation.
4. Do not commit to Edamam or Nutritionix without explicit legal/pricing confirmation for caching, attribution, and usage patterns.

## Risks
- fatsecret Premier pricing is market-based and requires sales engagement.
- If target launch is multi-region, commercial terms may materially affect unit economics.
- Attribution and licensing obligations must be enforced in UI/content surfaces.

## Sources
- USDA FoodData Central API Guide: https://fdc.nal.usda.gov/api-guide
- USDA FoodData Central homepage (release cadence/licensing): https://fdc.nal.usda.gov/
- data.gov rate limits: https://api.data.gov/docs/developer-manual/
- fatsecret Platform overview: https://platform.fatsecret.com/
- fatsecret API editions/pricing: https://platform.fatsecret.com/api-editions
- Edamam Nutrition Analysis API: https://developer.edamam.com/edamam-nutrition-api
- Edamam Nutrition Data API (retired): https://developer.edamam.com/edamam-nutrition-data-api
- Nutritionix developer portal (public entry): https://developer.nutritionix.com/

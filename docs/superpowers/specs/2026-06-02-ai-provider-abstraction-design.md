# Retired AI Provider Abstraction Design

> **Status:** Historical / superseded by the local MyChampions server migration.
> Do not execute this design as current Firebase implementation guidance.

This design previously described provider-abstraction work while the mobile app
still carried legacy provider-function context. Current meal-photo analyzer work belongs in the root MyChampions server analyzer boundary and focused mobile source tests.

## Context

The food-search microservice currently uses Google Translate for multilingual food search and catalog localization. The mobile app now sends BL-108 AI meal-photo macronutrient analysis requests to the root-level MyChampions server, which owns the authenticated analyzer boundary at `POST /nutrition/meal-photo-analysis`.

Both flows work today, but provider-specific concerns leak into default wiring and documentation:

- Food microservice service code imports `GoogleTranslateClient` directly and gates translation through `GOOGLE_TRANSLATE_API_KEY`.
- Catalog sync also constructs `GoogleTranslateClient` directly.
- Meal-photo analysis previously imported provider-specific helpers from the retired mobile-owned functions package; the current server boundary keeps provider details behind an injected analyzer.
- Product decision D-106 describes OpenAI as the architecture instead of the current provider behind a replaceable boundary.

The goal is to keep current runtime behavior unchanged while making both AI-adjacent flows provider-agnostic enough that switching from Google/OpenAI to another provider only requires adding or selecting an adapter.

## Scope

In scope:

- Food microservice translation provider boundary.
- Food microservice provider factory and provider-neutral config naming.
- MyChampions server meal-photo analyzer provider boundary.
- Provider adapter behind a provider-neutral meal-photo analyzer contract.
- Tests proving callers depend on neutral contracts/factories, with provider-specific HTTP shapes contained inside adapters.
- Documentation updates for D-106, D-127, BL-108, and any impacted FR/AC/BR/TC artifacts that mention OpenAI or Google as hard architecture.

Out of scope:

- Implementing Gemini, Google Vision, Llama, Ollama, or any non-current provider.
- Changing mobile request/response contracts.
- Changing prompts, macro schema, model output validation, cache semantics, or catalog ingestion behavior.
- Moving meal-photo analysis into the food microservice.

## Design Goals

- Preserve current behavior for deployed Google Translate and OpenAI flows.
- Make provider choice explicit in one factory per flow.
- Keep provider-specific request/response envelopes inside provider adapters.
- Keep domain-level parsing and error kinds provider-neutral.
- Avoid adding provider SDKs until a concrete provider is selected.
- Keep the mobile app insulated from provider choice.

## Food Translation Architecture

Create a provider-neutral translation contract:

- `MyChampions_Food_Microservice/src/translation/translator.ts`
- Exports `Translator` with:
  - `detectLanguage(text): Promise<string | null>`
  - `translateText(text, targetLanguage, sourceLanguage?): Promise<string>`
  - `translateTexts(texts, targetLanguage, sourceLanguage?): Promise<string[]>`

Keep Google-specific API code in:

- `src/translation/google-translate-client.ts`

Update imports so application services depend only on `Translator`, not `GoogleTranslateClient`.

Add a factory:

- `src/translation/create-translator.ts`
- Reads `config.translationProvider`.
- Supports `google` initially.
- Throws a clear startup/configuration error for unsupported providers.

Update default wiring:

- `src/services/search-foods-localized.service.ts` uses `createTranslator()` for production default service construction.
- `src/catalog/application/sync-food-catalog.service.ts` uses `createTranslator()` for production default sync service construction.

Config changes:

- Add `TRANSLATION_PROVIDER=google` with default `google`.
- Keep `GOOGLE_TRANSLATE_API_KEY` and `GOOGLE_TRANSLATE_BASE_URL` for the Google adapter.
- Add neutral `hasTranslationProviderCredentials`, derived from the selected provider. The `/searchFoods` controller uses this field instead of `hasGoogleTranslateApiKey`.
- Replace service-level string matching for `GOOGLE_TRANSLATE_API_KEY` with provider-neutral configuration error handling.

## Meal-Photo Analyzer Architecture

Use the provider-neutral analyzer contract in the root-level MyChampions server:

- `server/src/nutrition/meal-photo-analyzer.ts`
- Exports:
  - `MacroEstimateResult`
  - `MacroEstimateConfidence`
  - `MealPhotoAnalyzerErrorKind`
  - `MealPhotoAnalyzerError`
  - `MealPhotoAnalyzer`
  - `LocalMealPhotoAnalyzer`
  - prompt constants, because the JSON macro-estimate contract remains provider-neutral for this change

Define the contract:

```ts
export interface MealPhotoAnalyzer {
  analyze(input: { base64Image: string; mimeType?: string }): Promise<MacroEstimateResult>;
}
```

Keep provider-specific HTTP logic behind server-side analyzer implementations. The current local server uses an unconfigured placeholder analyzer by default and returns a provider-neutral `configuration` error until provider credentials are supplied.

When OpenAI or another remote provider is enabled, the provider adapter owns:

- Provider URL/model/config.
- Provider request envelope.
- Provider response-envelope extraction.
- Provider HTTP status mapping into neutral `MealPhotoAnalyzerError` kinds.

Add a factory:

- `server/src/nutrition/create-meal-photo-analyzer.ts` or equivalent server-local wiring when a remote provider is selected.
- Supports provider `openai` initially.
- Returns the selected server-side analyzer implementation.
- Throws provider-neutral configuration errors for unsupported providers.

Update server route wiring:

- `server/src/app.ts` keeps request validation and bearer-token authorization at `POST /nutrition/meal-photo-analysis`.
- The route delegates analysis to the configured `MealPhotoAnalyzer` dependency.
- Analyzer errors are mapped to the existing mobile error reasons without exposing provider details.

Config/secret notes:

- Read logical provider config from `MEAL_PHOTO_ANALYZER_PROVIDER`, defaulting to `openai` when unset.
- Keep provider API keys server-side only, outside Expo public environment variables.
- Do not expose provider keys to the mobile client.

## Error Handling

Food translation:

- Provider configuration failures should be logged once with provider-neutral language.
- Search fallback behavior remains unchanged: detection failure falls back to payload language, query translation failure uses original query, food-name translation failure returns English names.
- Catalog sync strict Portuguese localization behavior remains unchanged.

Meal-photo analysis:

- Preserve current public error responses:
  - `unrecognizable_image` -> HTTP 400
  - `quota_exceeded` -> HTTP 429
  - `invalid_response` -> HTTP 500
  - `unknown` -> HTTP 500
- Rename internal error class/kinds to provider-neutral names while preserving kind string values consumed by the client.

## Testing Strategy

Food microservice:

- Update localized search and catalog tests to import `Translator` from the neutral contract.
- Keep `GoogleTranslateClient` unit tests adapter-specific.
- Add `createTranslator` tests for:
  - default provider is `google`.
  - `TRANSLATION_PROVIDER=google` returns Google adapter.
  - unsupported provider throws a clear configuration error.
  - controller gate remains disabled when required current-provider credentials are absent.

MyChampions server:

- Keep provider-neutral schema parsing and error tests against `server/tests/meal-photo-analysis.test.ts` and server-local analyzer tests.
- Keep provider HTTP-envelope tests against adapter-specific server tests when a remote provider adapter is added.
- Add factory tests for current provider selection and unsupported provider rejection.
- Preserve existing client-side `meal-photo-analysis-source` tests because the mobile HTTP contract does not change.

## Documentation Updates

Update app documentation so it describes provider-neutral architecture with current providers:

- `docs/discovery/decisions-log-v1.md`
  - D-106 should say meal-photo analysis uses the MyChampions server analyzer route with provider details server-side.
  - D-127 should say the VPS food microservice uses a provider-neutral translation boundary, currently backed by Google Translate.
- `docs/discovery/prioritized-backlog-v1.md`
  - BL-108 remains implemented; note provider boundary hardening if needed.
- Functional requirements, acceptance criteria, business rules, and test cases that mention OpenAI as the architecture should be updated to say current provider instead.
- Food microservice README and `.env.example` should document `TRANSLATION_PROVIDER=google` and Google-specific credentials as provider-specific settings.

## Rollout

No migration is required because public HTTP contracts and persisted data do not change.

Deployment behavior remains:

- Food translation provider defaults to Google.
- Meal-photo analyzer runs through the MyChampions server route and returns a provider-neutral configuration error until server-side provider credentials are configured.
- Existing secrets and environment variables remain valid.

Future provider additions should be isolated to:

- One new adapter file.
- One factory branch.
- Provider-specific config/secrets.
- Adapter-specific tests.

## Open Risks

- Provider-neutral interfaces cannot guarantee true semantic equivalence across providers; future providers may require prompt/schema tuning.
- Llama/self-hosted providers may require operational configuration not represented by current API-key based adapters.
- Google Translate and LLM-based translation have different quality, batching, and rate-limit semantics; this design abstracts the call shape, not provider performance characteristics.

## Approval State

Approved by user on 2026-06-02 with scope option 2: food translation plus meal-photo AI provider abstraction.

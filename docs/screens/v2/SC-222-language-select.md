# SC-222 Language Select (V2)

## Route
- `/settings/language-select`
- Pushed from SC-213 Account & Privacy Settings when the user taps the Language row.

## Objective
Provide a dedicated full-screen language selector that replaces the former inline
native picker (ActionSheetIOS / Alert.alert) previously described in SC-213.
The selected language takes effect **immediately in-session** via `LocaleContext` —
no app restart is required.

## Design Structure
- Custom header (no native navigation toolbar, per D-147):
  - Left: back arrow (`MaterialIcons arrow-back`) — discards pending selection.
  - Center: screen title (`settings.language_select.title`).
  - Right: "Save" text button (`settings.language_select.save`) — disabled until the
    pending selection differs from the current active locale.
- `ScrollView` body with a single settings-style group.
- Three rows, one per supported locale (`en-US`, `pt-BR`, `es-ES`).
- Each row displays the locale's own name (always untranslated: "English",
  "Português", "Español") and a checkmark icon when selected.
- Row tap updates `pendingLocale` state (not saved yet).
- Section header above the group: `settings.language_select.section_header`.
- Shares DS token usage and row styling with SC-213 (same spacing, border radius,
  hairline dividers).

## Behavior

### Selection
- On mount: `pendingLocale` initialises to `activeLocale` from `LocaleContext`.
- Tapping a locale row sets `pendingLocale` to that locale (local state only).
- The tapped row shows a `check` icon; the previous selection loses it.

### Save
- Save button is **enabled** when `pendingLocale !== activeLocale`.
- On Save:
  1. Calls `setActiveLocale(pendingLocale)` from `useLocale()`.
  2. `setActiveLocale` persists to AsyncStorage (`app.language.override`) and
     updates `LocaleContext` state — all `useTranslation()` callers re-render
     immediately with the new locale.
  3. Calls `router.back()` to return to SC-213.

### Back / Cancel
- Tapping the back arrow discards `pendingLocale` and calls `router.back()`.
- No persistence occurs if Save was not pressed.

## States
- **Idle**: all three locale rows visible; Save button disabled (nothing changed).
- **Dirty**: at least one tap on a different locale; Save button enabled.

## Data Contract
- Inputs:
  - `useLocale()`: `activeLocale` (current effective locale), `setActiveLocale`.
  - `useTranslation()`: screen copy keys.
  - `useColorScheme()`: DS theme.
- Outputs:
  - `setActiveLocale(locale)`: persists override + refreshes all app strings.
  - `router.back()`: returns to SC-213.

## Locale Display Names
Locale option names are **intentionally not translated** so users can identify their
preferred language regardless of the current app language.

| Locale | Display name |
|--------|-------------|
| `en-US` | English |
| `pt-BR` | Português |
| `es-ES` | Español |

## Localization Keys (SC-222)
| Key | en-US | pt-BR | es-ES |
|-----|-------|-------|-------|
| `settings.language_select.title` | Language | Idioma | Idioma |
| `settings.language_select.save` | Save | Salvar | Guardar |
| `settings.language_select.section_header` | App Language | Idioma do App | Idioma de la app |
| `common.back` | Back | Voltar | Atrás |

Existing keys reused from SC-213:
- `settings.account.language.en_us` — "English" (locale option label)
- `settings.account.language.pt_br` — "Português" (locale option label)
- `settings.account.language.es_es` — "Español" (locale option label)

## Architecture Notes
- `LocaleContext` (`localization/locale-context.tsx`) holds `activeLocale` in React
  state. `LocaleProvider` wraps the entire app in `app/_layout.tsx`.
- `useTranslation()` (`localization/use-translation.ts`) reads from `LocaleContext`
  instead of the device locale directly, enabling in-session locale switching.
- `localization/index.ts` re-exports `useTranslation` from `use-translation.ts` so
  all existing imports from `@/localization` continue to work unchanged.
- No circular import: `locale-context.tsx` imports pure helpers from `index.ts`;
  `use-translation.ts` imports both `index.ts` and `locale-context.tsx`.

## New Files Introduced
- `localization/locale-context.tsx` — `LocaleProvider` + `useLocale()` hook.
- `localization/use-translation.ts` — context-aware `useTranslation()` hook.
- `app/settings/language-select.tsx` — this screen.

## Links
- Functional requirement: FR-227
- Decisions: D-144 (superseded: inline picker replaced by this screen), D-155
- Related screen: SC-213 (Account & Privacy Settings)
- Copy table: `docs/screens/v2/localized-copy-table-v2.md`

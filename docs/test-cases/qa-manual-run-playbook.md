# Manual QA Run Playbook (MyChampions app packs)

## Purpose

Canonical **mobile/web** packs and Linear conventions for the MyChampions app repo.  
The executable Skill is the **global** `qa-manual-run` Skill (`~/.cursor/skills/qa-manual-run`) with family adapter `families/mychampions.md`.

## Family / surfaces

| Surface | Default when cwd is… | Smoke pack |
|---|---|---|
| `mobile` / `web` | `mychampions/` | `docs/test-cases/qa-smoke-pack.md` |
| `api` | `../server/` | `../server/docs/qa-smoke-pack.md` |
| `food` | `../mychampionsapi-food/` | `../mychampionsapi-food/docs/qa-smoke-pack.md` |
| `exercises` | `../mychampionsapi-exercises/` | `../mychampionsapi-exercises/docs/qa-smoke-pack.md` |

## Kickoff

- Trigger: chat (`QA MyChampions …`) via global Skill.
- Scope: `smoke` if unspecified; else UC/TC/pack ids.
- Env: `docs/test-cases/qa-env-registry.md`; default `local`.
- Linear: team Edexample, project **MyChampions**.
- Insights: `~/Documents/Default/Projects/MyChampions/QA-Skill-Insights/`

## Execution order (shared)

Follow the global Skill procedure. For this repo’s mobile/web surface:

1. Resolve scope/env/surface.
2. Create Linear QA Run.
3. Playwright smoke when applicable (`yarn test:e2e:web:smoke`).
4. Browser UC/TC pass.
5. Classify / dedupe Bugs.
6. Write Skill insights.
7. Finalize QA Run + chat summary.

## Classification / dedupe / prod confirm

Unchanged from global Skill: Pass / Bug / Doc Gap / Known Deferred; `[TC-…]`/`[UC-…]` dedupe; `confirm prod qa` for prod; never file Doc Gap or Known Deferred as Bugs.

## Related

- Global Skill + adapter: `~/.cursor/skills/qa-manual-run/`
- Smoke: `docs/test-cases/qa-smoke-pack.md`
- Env: `docs/test-cases/qa-env-registry.md`
- Pending wiring: `docs/discovery/pending-wiring-checklist-v1.md`

# Repository Guidelines

## Project Structure & Module Organization

This workspace currently contains `報修需求筆記.txt`, the requirements for a small repair-reporting demo. It has no application source, tests, dependency manifests, or Git metadata yet. Read the note before implementing features.

Planned deliverables include a report form and list, Supabase tables and access rules, an Excel field catalog with sample data, a six-slide proposal, and a Word operating guide. When adding implementation files, group application code under `src/`, tests under `tests/`, database migrations under `supabase/migrations/`, and supporting deliverables under `docs/`. These directories are proposed conventions, not existing components.

## Build, Test, and Development Commands

No build, development, lint, or test commands are configured. Do not assume `npm test` or `npm run build` works. When selecting a stack, document its prerequisites and exact installation, local development, build, and test commands in a README; keep them aligned with the actual scripts.

## Coding Style & Naming Conventions

No formatter or linter is configured. Follow the chosen language’s standard conventions and use consistent indentation within each file. Add formatter and lint configuration alongside the first application implementation. Use descriptive identifiers and Traditional Chinese user-facing labels consistent with the requirements note. Keep database field names consistent across forms, queries, and documentation.

## Testing Guidelines

No testing framework or coverage threshold exists. Add tests with the implementation and document how to run them. Cover report creation, required-field validation, category and urgency choices, list retrieval, and automatic registration timestamps. Verify Supabase policies permit public inserts and reads while rejecting updates and deletes. Use fictional fixtures only.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. Once Git is initialized, use short, imperative commit subjects describing one focused change. Pull requests should explain the change, reference relevant requirements or issues, list validation performed, and include screenshots for visible interface changes.

## Security & Scope

Use fictional names and locations. Enable Supabase row-level security before exposing data through the frontend. Never commit privileged keys or real personal data. The current demo excludes login and permits only creation and listing; status updates, authentication, and notifications require clarified requirements before implementation.

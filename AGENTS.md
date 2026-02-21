# Repository Guidelines

## Project Structure & Module Organization
This project is a Next.js App Router app.
- `app/`: routes, layouts, and API handlers (for example `app/api/call/route.ts`).
- `components/`: feature components; reusable UI primitives live in `components/ui/`.
- `hooks/`: shared React hooks (`use-mobile`, `use-toast`).
- `lib/`: utility logic (phone parsing/validation, helpers).
- `public/`: static assets (icons, logo, placeholder images).
- Global styles are in `app/globals.css` and `styles/globals.css`.
Use the `@/*` import alias from `tsconfig.json` for internal imports.

## Build, Test, and Development Commands
- `pnpm install`: install dependencies.
- `pnpm dev`: run the local development server.
- `pnpm build`: produce a production build.
- `pnpm start`: serve the production build.
- `pnpm lint`: run ESLint across the repository.

## Coding Style & Naming Conventions
- Language: TypeScript with `strict` mode enabled.
- Follow existing formatting: 2-space indentation, single quotes, and no semicolons.
- Exported React component names use PascalCase (for example `SetupForm`).
- File names are lowercase or kebab-case (for example `setup-form.tsx`, `phone.ts`).
- Hook names start with `use` and live in `hooks/`.
- Prefer composing from `components/ui/*` before creating new primitives.

## Testing Guidelines
There is currently no dedicated test runner configured in `package.json`.
For every change:
- Run `pnpm lint`.
- Manually validate key flows: `/setup` phone capture, `/` call flow, and API validation behavior in `POST /api/call`.
If you add automated tests, use `*.test.ts` / `*.test.tsx` naming and document the new command in `package.json` and this guide.

## Commit & Pull Request Guidelines
Recent history follows concise conventional prefixes (for example `feat:` and `fix:`). Continue that pattern:
- `feat: add call retry state`
- `fix: handle missing VAPI env vars`

PRs should include:
- Clear summary and scope.
- Linked issue/task (if applicable).
- Verification steps (commands + manual checks).
- Screenshots or short recordings for UI changes.

## Security & Configuration Tips
Keep secrets in local env files only; never commit credentials. The call API requires:
`VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID`, and `VAPI_PHONE_NUMBER_ID`.

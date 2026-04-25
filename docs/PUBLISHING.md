# Publishing to npm

This checklist is for maintainers releasing `cursor-claude` to the public registry.

## Preconditions

- Clean tree: `git status` shows no unintended changes.
- CI green on the release commit (typecheck, tests with coverage, build).
- `npm whoami` shows the correct npm user/org.
- Version in `package.json` matches the intended release (semver).

## Verify locally

```bash
npm ci
npm run typecheck
npm run test:coverage
npm run build
npm pack --dry-run
```

Inspect the pack output: `dist/`, `bin/`, `README.md`, and `LICENSE` should be included per `package.json` `files`.

## Publish

1. Commit any version/changelog updates on `main` (or your release branch).
2. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z` (optional but recommended).
3. `npm publish` — `prepublishOnly` runs `npm run build` automatically.

`publishConfig.access` is `public` so scoped packages are not required for an unscoped name.

## After publish

- Smoke-test: `npx cursor-claude@X.Y.Z --help`.
- Create a GitHub release (notes can mirror [CHANGELOG.md](../CHANGELOG.md)).

## Rollbacks

npm does not allow republishing the same version. For a bad publish, publish a patch with a fix or deprecate the bad version in the npm UI.

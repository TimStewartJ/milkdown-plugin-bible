# Releasing

## Every release

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Run `npm run check` and `npm run test:consumer`. `npm publish` runs the first of these again by itself.
3. Open the demo (`npm run dev`) and try a reference, the Tab key and the `/` menu in at least one Crepe theme and on the plain page.
4. Commit, then tag the commit `v<version>` and push the tag.

## The first release

npm sets up automated publishing in a package's settings, so the package has to exist first. Publish `0.1.0` by hand:

```sh
npm login          # your npm account, with two-factor authentication
npm publish        # builds, tests, and publishes
```

Then, on npmjs.com, open the package's **Settings → Trusted publishing**, choose GitHub Actions and enter:

- Organization or user: `TimStewartJ`
- Repository: `milkdown-plugin-bible`
- Workflow filename: `release.yml`

The repository must be public for this, and for the provenance statement npm attaches to each release.

## Later releases

Pushing a `v<version>` tag runs `.github/workflows/release.yml`, which checks that the tag matches `package.json` and publishes. No token is stored anywhere: GitHub proves to npm which repository and workflow is publishing.

Once that works, set **Settings → Publishing access** on npmjs.com to "Require two-factor authentication and disallow tokens", so nothing but that workflow, or you with a second factor, can publish.
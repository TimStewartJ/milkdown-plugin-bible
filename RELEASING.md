# Releasing

Releases are published by GitHub Actions when a version tag is pushed. Nobody publishes from their own machine, and there is no npm token: npm trusts `.github/workflows/release.yml` in this repository, and attaches a provenance statement to each release that links it to the commit and workflow run that built it.

## Steps

1. Update `version` in `package.json` (and run `npm install` so `package-lock.json` follows) and add a section to `CHANGELOG.md`.
2. Run `npm run check` and `npm run test:consumer`.
3. Open the demo (`npm run dev`) and try a reference, the Tab key and the `/` menu in at least one Crepe theme and on the plain page.
4. Commit and push to `main`. Wait for CI to pass.
5. Tag that commit `v<version>` and push the tag:

   ```sh
   git tag -a v0.2.0 -m "0.2.0"
   git push origin v0.2.0
   ```

The Release workflow checks that the tag matches `package.json`, runs the checks again, and publishes. Afterwards, add a GitHub release for the tag with the changelog section as its notes.

A version can't be published twice. If a release fails after the tag is pushed, fix the problem under a new version number and leave the old tag in place.

## How the trust is set up

`0.1.0` was published by hand, because npm can only trust a workflow for a package that already exists. The workflow was then registered with:

```sh
npx npm@latest trust github milkdown-plugin-bible --file release.yml --repo TimStewartJ/milkdown-plugin-bible --allow-publish
```

`npx npm@latest trust list milkdown-plugin-bible` shows the registration; both commands ask for two-factor approval. It names the workflow file and the repository, so renaming either means registering again.

To make the workflow the only way to publish, set **Settings → Publishing access** for the package on npmjs.com to "Require two-factor authentication and disallow tokens".
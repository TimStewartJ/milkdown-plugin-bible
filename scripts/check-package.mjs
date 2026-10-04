// Lints what would be published: the package.json fields (publint) and
// whether the type declarations resolve for consumers (are-the-types-wrong).
//
// Both pack the package themselves. When this runs inside
// `npm publish --dry-run`, npm passes the dry-run setting down to them and no
// tarball gets written, so it is switched off for these two commands.
import { execSync } from 'node:child_process';

const env = { ...process.env, npm_config_dry_run: 'false' };

for (const command of [
  'publint --strict',
  // The stylesheet entry isn't a module, and CommonJS isn't supported.
  'attw --pack . --profile esm-only --exclude-entrypoints style.css',
]) {
  execSync(`npx --no-install ${command}`, { stdio: 'inherit', env });
}

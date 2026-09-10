import { spawnSync } from 'node:child_process'

// npm exports config values as npm_config_* environment variables to lifecycle
// scripts. When a user has `allow-scripts` in their ~/.npmrc, that value leaks
// into this process as npm_config_allow_scripts. A nested `npm install` treats
// the inherited variable as a CLI-level --allow-scripts flag and rejects it in
// project-scoped installs (EALLOWSCRIPTS, npm 12+). Drop it so each package
// resolves allow-scripts from package.json / .npmrc as usual.
const env = { ...process.env }
delete env.npm_config_allow_scripts

for (const pkg of ['server', 'client']) {
  const result = spawnSync(`npm --prefix ${pkg} install`, {
    stdio: 'inherit',
    env,
    shell: true,
  })

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

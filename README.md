# opencode-roast-tone-plugin

Roast-tone server plugin for OpenCode. It injects a roast-comic tone instruction into the first user message so the assistant stays sharp, fast, and a little judgmental — like good tooling with worse bedside manner.

Compatible with OpenCode `>=1.4.6 <2`.

## Install in current project

```sh
opencode plugin opencode-roast-tone-plugin@latest
```

## Global install

```sh
opencode plugin opencode-roast-tone-plugin@latest --global
```

## Config alternative

If you would rather configure plugins directly, use:

```json
{ "plugin": ["opencode-roast-tone-plugin@latest"] }
```

## TUI controls in OpenCode

This plugin now has **two** TUI control surfaces:

1. **Built-in Plugins dialog**: controls whether the whole `opencode-roast-tone-plugin` package is enabled.
2. **`Roast Tone settings` command**: controls only whether roast-tone injection is enabled while the plugin itself stays installed and active.

Open the command palette and run **`Roast Tone settings`** to manage the roast-tone injection toggle.

### State combinations

- **Plugin enabled + roast tone enabled**: the plugin is on, and future user messages get the roast-tone instruction injected.
- **Plugin enabled + roast tone disabled**: the plugin stays on, but future user messages are sent without the roast-tone instruction.
- **Plugin disabled**: the plugin is off from the Plugins dialog, so no roast-tone injection runs at all.

### Persistence

The state is persisted across restarts.

It uses the existing config-root resolution order:

1. `OPENCODE_CONFIG_DIR`
2. the nearest workspace `.opencode` directory inside the current worktree
3. `XDG_CONFIG_HOME/opencode`
4. `~/.config/opencode`

That means both the plugin-level enabled state and the roast-tone injection state continue to follow the same config-root behavior OpenCode already uses.

## Local development

From the repository root, build first, then install the local plugin with a path spec:

```sh
npm run build
opencode plugin "$(pwd)" --force
```

After changing code, run `npm run build` again and then reinstall or refresh the local plugin so OpenCode picks up the updated `dist/` output. Amazing how compiled files do not, in fact, materialize out of pure optimism.

## Development

```sh
npm install
npm test
npm run build
```

## Publish

### Preferred: GitHub Actions release (OIDC trusted publishing)

This repo includes `.github/workflows/release.yml` that publishes to npm with **trusted publishing (OIDC)**, so no long-lived `NPM_TOKEN` secret is required.

1. In npm package settings, add this GitHub repository/workflow as a trusted publisher.
2. Bump version locally and push:

```sh
npm version <new-version>
git push --follow-tags
```

3. Push a matching `v*` tag (for example `v0.1.4`) to trigger release. The workflow validates tag version matches `package.json` and runs `npm publish --provenance --access public`.

### Manual fallback

```sh
npm run build
npm publish --dry-run
npm publish
```

Note: if that version was already published, `npm publish --dry-run` may still exit non-zero even when the tarball contents are fine. Beautiful little reminder that registries hold grudges.

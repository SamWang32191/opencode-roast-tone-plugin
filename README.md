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
2. **`Roast Tone settings` command**: controls whether tone injection is enabled and which preset gets injected.

Open the command palette and run **`Roast Tone settings`** to manage both values.

### Tone presets

- **Roast**: the existing sharp roast-comic baseline
- **Dry**: shorter, clipped, and unimpressed
- **Deadpan**: flat delivery with colder punchlines
- **Mentor**: stricter guidance with lighter roast

### State combinations

- **Plugin enabled + Tone enabled**: the selected preset is injected into future user messages.
- **Plugin enabled + Tone disabled**: the plugin stays installed, but any known injected preset is removed from the active thread on the next transform.
- **Plugin disabled**: the plugin is off from the Plugins dialog, so no roast-tone injection runs at all.

### Persistence

The state is persisted across restarts.

It uses the existing config-root resolution order:

1. `OPENCODE_CONFIG_DIR`
2. the nearest workspace `.opencode` directory inside the current worktree
3. `XDG_CONFIG_HOME/opencode`
4. `~/.config/opencode`

That means the plugin-level enabled state, the tone toggle, and the active preset all continue to follow the same config-root behavior OpenCode already uses.

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

Use GitHub Actions release workflow only (OIDC trusted publishing).

1. In npm package settings, add this repository workflow as a trusted publisher.
2. Open **Actions → Release → Run workflow**.
3. Select bump type (`patch` or `major`) and run on the default branch.

The workflow will automatically:

- run `npm test`
- run `npm run build`
- bump version in `package.json` + `package-lock.json`
- create and push the release commit and `v*` tag
- publish to npm with `npm publish --provenance --access public`

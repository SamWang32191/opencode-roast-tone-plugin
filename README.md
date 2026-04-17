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

## Enable or disable in OpenCode

After installation, open OpenCode's **Plugins** dialog and toggle `opencode-roast-tone-plugin` on or off there.

- **Enabled:** OpenCode injects the roast-tone instruction into future message payloads, so new requests keep the sharp roast-comic tone.
- **Disabled:** OpenCode stops injecting that instruction for future requests, so new messages go out without the roast-tone add-on.
- The enabled/disabled state is persisted, so the toggle stays where you left it across restarts.

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

Update the package version first, then publish:

```sh
npm version <new-version>
npm run build
npm publish --dry-run
npm publish
```

Note: if that version was already published, `npm publish --dry-run` may still exit non-zero even when the tarball contents are fine. Beautiful little reminder that registries hold grudges.

# opencode-roast-tone-plugin

Roast-tone server plugin for OpenCode. It injects a roast-comic tone instruction into the first user message so the assistant stays sharp, fast, and a little judgmental — like good tooling with worse bedside manner.

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

```sh
npm run build
npm publish --dry-run
npm publish
```

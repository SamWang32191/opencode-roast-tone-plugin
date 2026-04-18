import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "solid-js": "solid-js/dist/solid.js",
    },
  },
  plugins: [
    {
      name: "opentui-solid-tsx",
      enforce: "pre",
      async transform(code, id) {
        if (id.includes("/node_modules/") || !id.match(/\.tsx(?:$|\?)/u)) {
          return null;
        }

        const result = await transformAsync(code.replace(/^\/\*\*\s*@jsxImportSource[^\n]*\n/u, ""), {
          filename: id,
          babelrc: false,
          configFile: false,
          presets: [
            [
              solid,
              {
                moduleName: "@opentui/solid",
                generate: "universal",
              },
            ],
            [ts],
          ],
        });

        if (!result?.code) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ?? null,
        };
      },
    },
  ],
});

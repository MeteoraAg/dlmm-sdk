import type { Options } from "tsup";

const config: Options = {
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  splitting: false,
  sourcemap: true,
  minify: false,
  clean: true,
  skipNodeModulesBundle: true,
  dts: true,
  external: ["node_modules"],
  target: "es2020",
  // post-process CJS build to fix default export for require() users
  onSuccess: async () => {
    const fs = await import("fs");
    const path = await import("path");
    const cjsPath = path.join(process.cwd(), "dist", "index.js");
    let content = fs.readFileSync(cjsPath, "utf8");

    content +=
      "\n\n// CJS interop: Make default export primary for require() compatibility\n";
    content += "if (exports.default) {\n";
    content += "  module.exports = exports.default;\n";
    content += "  for (const key in exports) {\n";
    content += '    if (key !== "default") {\n';
    content += "      module.exports[key] = exports[key];\n";
    content += "    }\n";
    content += "  }\n";
    content += "}\n";

    fs.writeFileSync(cjsPath, content);
  },
};

export default config;

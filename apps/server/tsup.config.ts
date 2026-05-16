import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node22",
	platform: "node",
	bundle: true,
	splitting: false,
	sourcemap: true,
	clean: true,
	skipNodeModulesBundle: true,
	noExternal: [/^@devpinger\//],
})

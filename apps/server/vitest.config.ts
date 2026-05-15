import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
		globalSetup: ["./test/integration/global-setup.ts"],
		pool: "forks",
		testTimeout: 60_000,
		hookTimeout: 120_000,
		passWithNoTests: true,
	},
})

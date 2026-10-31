import { defineConfig } from "orval";

try {
	process.loadEnvFile();
} catch (error) {
	if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
		throw error;
	}
}

export default defineConfig({
	api: {
		output: {
			mode: "single",
			target: "src/api/api.ts",
			schemas: {
				path: "src/api/model.ts",
				mode: "single",
			},
			tsconfig: "tsconfig.build.json",
			clean: true,
			client: "fetch",
			override: {
				fetch: {
					forceSuccessResponse: true,
					httpClientInjection: "factory",
					includeHttpResponseReturnType: true,
				},
			},
		},
		input: {
			target: process.env.OPENAPI_URL ?? `${process.env.BASE_URL}/openapi.json`,
		},
	},
});

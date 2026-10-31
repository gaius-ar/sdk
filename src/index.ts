import { getGaiusAPI } from "./api/api.js";
import { caseCreator } from "./create-case.js";
import { throwHttpError } from "./http-error.js";

export * from "./api/model.js";
export type {
	CreateCaseInput,
	CreateCaseOptions,
	CreateCaseResult,
} from "./create-case.js";
export { CaseUploadError } from "./create-case.js";
export { GaiusHttpError } from "./http-error.js";

const DEFAULT_BASE_URL = "https://api.gaius.com.ar";

export type FetchFn = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

type WithoutUrlHelpers<T> = {
	[K in keyof T as K extends `get${string}Url` ? never : K]: T[K];
};

export type GaiusClientParams =
	| string
	| { apiKey: string; baseUrl?: string; fetch?: FetchFn };

export type GaiusClient = ReturnType<typeof createGaiusClient>;

export function createGaiusClient(params: GaiusClientParams) {
	const {
		apiKey,
		baseUrl = DEFAULT_BASE_URL,
		fetch: fetchFn = globalThis.fetch,
	} = typeof params === "string" ? { apiKey: params } : params;

	const authenticatedFetch: FetchFn = async (input, init) => {
		const request =
			input instanceof Request
				? new Request(input, init)
				: new Request(new URL(input, baseUrl).href, init);

		request.headers.set("Authorization", `Bearer ${apiKey}`);

		const response = await fetchFn(request);
		if (!response.ok) await throwHttpError(response);
		return response;
	};

	const api = getGaiusAPI(authenticatedFetch as typeof globalThis.fetch);

	return { ...api, createCase: caseCreator(api, fetchFn) } as WithoutUrlHelpers<
		typeof api
	> & { createCase: ReturnType<typeof caseCreator> };
}

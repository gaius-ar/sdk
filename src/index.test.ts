import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createGaiusClient } from ".";

const caseId = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
	mock.restore();
});

describe("createGaiusClient", () => {
	test("accepts a key string and uses the default URL and global fetch", async () => {
		const data = { id: caseId };
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json(data),
		);
		const client = createGaiusClient("api_test");

		const response = await client.getV1CaseById(caseId);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const request = fetchSpy.mock.calls[0]?.[0];
		if (!(request instanceof Request)) {
			throw new Error("Expected a Request to be passed to fetch");
		}
		expect(request.url).toBe(`https://api.gaius.com.ar/v1/case/${caseId}`);
		expect(request.method).toBe("GET");
		expect(request.headers.get("Authorization")).toBe("Bearer api_test");
		expect(response.status).toBe(200);
		expect(response.data.id).toBe(data.id);
	});

	test("uses the injected fetch and preserves the body, headers and cancellation", async () => {
		const controller = new AbortController();
		const body = { assignedToUserId: caseId, notes: "Change assignee" };
		const fetchFn = mock(async (input: string | URL | Request) => {
			if (!(input instanceof Request)) {
				throw new Error("Expected a Request to be passed to fetch");
			}
			expect(input.url).toBe(`http://localhost:8888/v1/case/${caseId}/asignee`);
			expect(input.method).toBe("PUT");
			expect(input.headers.get("Authorization")).toBe("Bearer api_local");
			expect(input.headers.get("Content-Type")).toBe("application/json");
			expect(input.headers.get("X-Request-ID")).toBe("request-1");
			expect(await input.json()).toEqual(body);
			controller.abort();
			expect(input.signal.aborted).toBe(true);
			return Response.json({ id: caseId });
		});
		const client = createGaiusClient({
			apiKey: "api_local",
			baseUrl: "http://localhost:8888",
			fetch: fetchFn,
		});

		await client.putV1CaseByIdAsignee(caseId, body, {
			headers: {
				Authorization: "Bearer overridden",
				"X-Request-ID": "request-1",
			},
			signal: controller.signal,
		});

		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	test("keeps keys, URLs and fetch implementations isolated between clients", async () => {
		const requests: Request[] = [];
		const createFetch = () =>
			mock(async (input: string | URL | Request) => {
				if (!(input instanceof Request)) {
					throw new Error("Expected a Request to be passed to fetch");
				}
				requests.push(input);
				return Response.json({ id: caseId });
			});
		const firstFetch = createFetch();
		const secondFetch = createFetch();
		const first = createGaiusClient({
			apiKey: "api_first",
			baseUrl: "https://first.example.com",
			fetch: firstFetch,
		});
		const second = createGaiusClient({
			apiKey: "api_second",
			baseUrl: "https://second.example.com",
			fetch: secondFetch,
		});

		await first.getV1CaseById(caseId);
		await second.getV1CaseById(caseId);
		await first.getV1CaseById(caseId);

		expect(firstFetch).toHaveBeenCalledTimes(2);
		expect(secondFetch).toHaveBeenCalledTimes(1);
		expect(requests.map((request) => new URL(request.url).host)).toEqual([
			"first.example.com",
			"second.example.com",
			"first.example.com",
		]);
		expect(
			requests.map((request) => request.headers.get("Authorization")),
		).toEqual(["Bearer api_first", "Bearer api_second", "Bearer api_first"]);
	});

	test("preserves the HTTP status and error body returned by the API", async () => {
		const problem = { status: 403, title: "Forbidden" };
		const client = createGaiusClient({
			apiKey: "api_test",
			fetch: async () => Response.json(problem, { status: 403 }),
		});

		await expect(client.getV1CaseById(caseId)).rejects.toMatchObject({
			status: 403,
			info: problem,
		});
	});

	test("propagates failures from the injected fetch", async () => {
		const error = new TypeError("Network request failed");
		const client = createGaiusClient({
			apiKey: "api_test",
			fetch: async () => {
				throw error;
			},
		});

		await expect(client.getV1CaseById(caseId)).rejects.toBe(error);
	});
});

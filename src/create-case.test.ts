import { describe, expect, test } from "bun:test";
import {
	type CaseTypeQuestionWithOptionsAndDocumentRequirement,
	CaseUploadError,
	type CreateCaseInput,
	createGaiusClient,
} from "./index.js";

const caseId = "00000000-0000-4000-8000-000000000001";
const questionId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";

const caseTypeId = "00000000-0000-4000-8000-000000000004";
function question(
	overrides: Partial<CaseTypeQuestionWithOptionsAndDocumentRequirement> = {},
): CaseTypeQuestionWithOptionsAndDocumentRequirement {
	return {
		id: questionId,
		CaseTypeId: caseTypeId,
		label: "Evidence",
		helpText: null,
		answerType: "file",
		required: true,
		requiredDocument: true,
		position: 0,
		minLength: null,
		maxLength: null,
		minValue: null,
		maxValue: null,
		allowDecimals: null,
		options: [],
		...overrides,
	} as CaseTypeQuestionWithOptionsAndDocumentRequirement;
}
function input(): CreateCaseInput {
	return {
		personType: "individual",
		firstName: " Ana ",
		lastName: "Perez",
		idType: "DNI",
		idValue: "12.345.678",
		intakeChannel: "web",
		intakeDate: "2026-10-30",
		caseTypeId,
		answers: { [questionId]: new File(["answer"], "answer.pdf") },
		documents: [{ title: " Other ", file: new File(["other"], "other.pdf") }],
	};
}

function fixture() {
	const calls: {
		url: string;
		method: string;
		body: unknown;
		authorization: string | null;
	}[] = [];
	const uploaded: string[] = [];
	let failUpload = false;
	let failConfirmation = false;
	let typeError: unknown = null;
	let questions = [question()];
	let createError: unknown = null;

	const client = createGaiusClient({
		apiKey: "secret",
		baseUrl: "https://api.example",
		fetch: async (resource, init) => {
			const request =
				resource instanceof Request
					? resource
					: new Request(resource.toString(), init);
			const url = new URL(request.url);
			const body =
				url.host === "api.example" && request.body
					? ((await request.json()) as Record<string, unknown>)
					: {};
			calls.push({
				url: request.url,
				method: request.method,
				body,
				authorization: request.headers.get("Authorization"),
			});
			if (url.host === "storage.example") {
				expect(request.headers.get("Authorization")).toBeNull();
				expect(request.headers.get("Content-Type")).toBe("application/pdf");
				expect(await request.text()).toBe(
					url.pathname.includes("answer") ? "answer" : "other",
				);
				if (failUpload && url.pathname.includes("other"))
					return new Response("", { status: 503 });
				uploaded.push(url.pathname);
				return new Response("", { status: 200 });
			}
			if (url.pathname === `/v1/case-type/${caseTypeId}`) {
				if (typeError) return Response.json(typeError, { status: 404 });
				return Response.json({ id: caseTypeId, questions });
			}
			if (url.pathname === "/v1/case/") {
				if (createError) return Response.json(createError, { status: 400 });
				expect(body["idValue"]).toBe("12345678");
				return Response.json({
					id: caseId,
					answers: [
						{
							questionId,
							valueFileUploadURL: "https://storage.example/answer",
							valueFileUploadMethod: "PUT",
							valueFileUploadHeaders: { "Content-Type": ["application/pdf"] },
						},
					],
					documents: [
						{
							id: documentId,
							fileUploadURL: "https://storage.example/other",
							fileUploadMethod: "PUT",
							fileUploadHeaders: { "Content-Type": ["application/pdf"] },
						},
					],
				});
			}
			if (url.pathname.endsWith("/confirm-uploads")) {
				if (failConfirmation)
					return Response.json(
						{ detail: "Storage unavailable" },
						{ status: 503 },
					);
				return Response.json({ submittedDocumentIds: [documentId] });
			}
			throw new Error(`Unexpected URL: ${request.url}`);
		},
	});
	return {
		client,
		calls,
		uploaded,
		failUpload: () => {
			failUpload = true;
		},
		allowUploads: () => {
			failUpload = false;
		},
		failConfirmation: () => {
			failConfirmation = true;
		},
		allowConfirmation: () => {
			failConfirmation = false;
		},
		rejectType: () => {
			typeError = { detail: "Invalid case type" };
		},
		setQuestions: (
			next: CaseTypeQuestionWithOptionsAndDocumentRequirement[],
		) => {
			questions = next;
		},
		rejectCreate: () => {
			createError = { detail: "Case type changed" };
		},
	};
}

async function uploadError(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(CaseUploadError);
		return error as CaseUploadError;
	}
	throw new Error("Expected upload failure");
}

describe("createCase", () => {
	test("validates metadata, creates, uploads actual files without credentials and confirms", async () => {
		const f = fixture();
		expect(await f.client.createCase(input())).toEqual({
			caseId,
			submittedDocumentIds: [documentId],
		});
		expect(f.calls.map(({ url }) => new URL(url).pathname)).toEqual([
			`/v1/case-type/${caseTypeId}`,
			"/v1/case/",
			"/answer",
			"/other",
			`/v1/case/${caseId}/confirm-uploads`,
		]);
		expect(f.calls[1]?.body).toMatchObject({
			intakeDate: "2026-10-30T00:00:00Z",
			answers: [
				{ questionId, valueOptionIDs: null, valueFileName: "answer.pdf" },
			],
		});
		expect(f.calls[1]?.body).toMatchObject({
			documents: [{ title: "Other", fileName: "other.pdf", status: "pending" }],
		});
		expect(
			f.calls
				.filter(({ url }) => new URL(url).host === "api.example")
				.every(({ authorization }) => authorization === "Bearer secret"),
		).toBe(true);
	});

	test("does not create or upload if the case type is unavailable", async () => {
		const f = fixture();
		f.rejectType();
		await expect(f.client.createCase(input())).rejects.toMatchObject({
			status: 404,
		});
		expect(f.calls).toHaveLength(1);
	});

	for (const [name, configure] of Object.entries({
		"missing required file": (values: CreateCaseInput) => {
			values.answers = {};
		},
		"missing required text": (
			_values: CreateCaseInput,
			f: ReturnType<typeof fixture>,
		) => {
			f.setQuestions([question({ answerType: "text" })]);
		},
		"invalid option": (
			values: CreateCaseInput,
			f: ReturnType<typeof fixture>,
		) => {
			f.setQuestions([question({ answerType: "single_select" })]);
			values.answers = { [questionId]: documentId };
		},
		"invalid bounds": (
			values: CreateCaseInput,
			f: ReturnType<typeof fixture>,
		) => {
			f.setQuestions([question({ answerType: "number", minValue: 10 })]);
			values.answers = { [questionId]: "2" };
		},
		"unsupported extension": (values: CreateCaseInput) => {
			values.answers = { [questionId]: new File(["exe"], "bad.exe") };
		},
		"unknown question": (values: CreateCaseInput) => {
			values.answers = { [documentId]: "unknown" };
		},
	})) {
		test(`rejects before creation: ${name}`, async () => {
			const f = fixture();
			const values = input();
			configure(values, f);
			await expect(f.client.createCase(values)).rejects.toMatchObject({
				name: "ZodError",
			});
			expect(f.calls).toHaveLength(1);
			expect(f.uploaded).toHaveLength(0);
		});
	}

	test("checks the actual files before sending any requests", async () => {
		const f = fixture();
		const values = input();
		values.documents![0]!.file = undefined as unknown as File;
		await expect(f.client.createCase(values)).rejects.toMatchObject({
			name: "ZodError",
		});
		expect(f.calls).toHaveLength(0);
	});

	test("does not upload if creation rejects a change after preflight", async () => {
		const f = fixture();
		f.rejectCreate();
		await expect(f.client.createCase(input())).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(2);
		expect(f.uploaded).toHaveLength(0);
	});

	test("retries only unfinished uploads on the original case", async () => {
		const f = fixture();
		f.failUpload();
		const error = await uploadError(f.client.createCase(input()));
		expect(error.caseId).toBe(caseId);
		expect(f.uploaded).toEqual(["/answer"]);
		f.allowUploads();
		expect(await error.retry()).toEqual({
			caseId,
			submittedDocumentIds: [documentId],
		});
		expect(f.uploaded).toEqual(["/answer", "/other"]);
		expect(
			f.calls.filter(({ url }) => new URL(url).pathname === "/v1/case/"),
		).toHaveLength(1);
		expect(
			f.calls.filter(({ url }) => url.includes("/case-type/")),
		).toHaveLength(1);
	});

	test("retries confirmation without uploading files again", async () => {
		const f = fixture();
		f.failConfirmation();
		const error = await uploadError(f.client.createCase(input()));
		f.allowConfirmation();
		await error.retry();
		expect(f.uploaded).toEqual(["/answer", "/other"]);
		expect(
			f.calls.filter(({ url }) => url.endsWith("/upload-urls")),
		).toHaveLength(0);
		expect(
			f.calls.filter(({ url }) => url.endsWith("/confirm-uploads")),
		).toHaveLength(2);
	});

	for (const [field, value] of [
		["idValue", "00000000"],
		["email", "bad-address"],
		["firstName", "  "],
		["intakeDate", "2026-02-30"],
		["caseTypeId", "invalid"],
	] as const) {
		test(`validates ${field} locally before any request`, async () => {
			const f = fixture();
			await expect(
				f.client.createCase({ ...input(), [field]: value }),
			).rejects.toMatchObject({ name: "ZodError" });
			expect(f.calls).toHaveLength(0);
		});
	}

	test("requires a document file even when only requiredDocument is set", async () => {
		const f = fixture();
		f.setQuestions([question({ required: false, requiredDocument: true })]);
		await expect(
			f.client.createCase({ ...input(), answers: {} }),
		).rejects.toMatchObject({ name: "ZodError" });
		expect(f.calls).toHaveLength(1);
	});

	test("converts false and zero without treating them as missing answers", async () => {
		const f = fixture();
		f.setQuestions([
			question({
				id: questionId,
				answerType: "boolean",
				requiredDocument: false,
			}),
			question({
				id: documentId,
				answerType: "number",
				requiredDocument: false,
			}),
		]);
		await f.client.createCase({
			...input(),
			answers: { [questionId]: "false", [documentId]: "0" },
			documents: [],
		});
		expect(f.calls[1]?.body).toMatchObject({
			firstName: "Ana",
			intakeDate: "2026-10-30T00:00:00Z",
			answers: [
				{ questionId, valueBoolean: false },
				{ questionId: documentId, valueNumber: 0 },
			],
		});
		expect(f.uploaded).toHaveLength(0);
	});

	test("preserves a fresh cancellation signal when retrying the same case", async () => {
		const f = fixture();
		f.failUpload();
		const original = new AbortController();
		const error = await uploadError(
			f.client.createCase(input(), { signal: original.signal }),
		);
		original.abort();
		f.allowUploads();
		const retry = new AbortController();
		expect(await error.retry({ signal: retry.signal })).toMatchObject({
			caseId,
		});
		expect(
			f.calls.filter(({ url }) => new URL(url).pathname === "/v1/case/"),
		).toHaveLength(1);
	});

	test("can create a case with no files", async () => {
		const f = fixture();
		const values = input();
		values.answers = {};
		values.caseTypeId = "";
		values.documents = [];
		await f.client.createCase(values);
		expect(f.uploaded).toHaveLength(0);
		expect(f.calls).toHaveLength(2);
	});
});

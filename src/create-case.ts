import { z } from "zod";
import type { getGaiusAPI } from "./api/api.js";
import type { CaseTypeQuestionWithOptionsAndDocumentRequirement } from "./api/model.js";
import {
	type CaseFormValues,
	createCaseFormSchema,
} from "./frontend/case-answers.js";
import {
	type PendingCaseUploads,
	toCaseCreateInput,
	uploadCaseFiles,
} from "./frontend/case-create.js";
import {
	documentFileContentType,
	documentFileTypeMessage,
} from "./frontend/document-files.js";
import type { FetchFn } from "./index.js";

type API = ReturnType<typeof getGaiusAPI>;
type RequiredFields =
	| "personType"
	| "idType"
	| "idValue"
	| "intakeChannel"
	| "intakeDate";

/** Same values as the frontend form: ISO calendar dates and answers keyed by question ID. */
export type CreateCaseInput = Pick<CaseFormValues, RequiredFields> &
	Partial<Omit<CaseFormValues, RequiredFields>> & { caseDraftId?: string };
export type CreateCaseOptions = { signal?: AbortSignal };
export type CreateCaseResult = {
	caseId: string;
	submittedDocumentIds: string[];
};

/** The case exists. Retry this error to resume uploads rather than creating another case. */
export class CaseUploadError extends Error {
	readonly caseId: string;
	readonly retry: (options?: CreateCaseOptions) => Promise<CreateCaseResult>;

	constructor(caseId: string, cause: unknown, retry: CaseUploadError["retry"]) {
		super(
			`El caso ${caseId} fue creado, pero sus cargas no se completaron. Reintentá con error.retry().`,
			{ cause },
		);
		this.name = "CaseUploadError";
		this.caseId = caseId;
		this.retry = retry;
	}
}

function completeCaseSchema(
	questions: CaseTypeQuestionWithOptionsAndDocumentRequirement[],
) {
	return createCaseFormSchema(questions).superRefine((values, context) => {
		const validateFile = (file: File, path: (string | number)[]) => {
			// Frontend uploader allowlist, plus the backend's filename byte/control limits.
			if (!documentFileContentType(file.name)) {
				context.addIssue({
					code: "custom",
					path,
					message: documentFileTypeMessage,
				});
			}
			if (
				new TextEncoder().encode(file.name).length > 255 ||
				/\p{Cc}/u.test(file.name)
			) {
				context.addIssue({
					code: "custom",
					path,
					message: "Seleccioná un archivo con un nombre válido.",
				});
			}
		};
		for (const question of questions) {
			if (question.answerType !== "file") continue;
			const file = values.answers[question.id];
			if (
				(question.required || question.requiredDocument) &&
				!(file instanceof File)
			) {
				context.addIssue({
					code: "custom",
					path: ["answers", question.id],
					message: "Seleccioná el archivo obligatorio.",
				});
			}
			if (file instanceof File) validateFile(file, ["answers", question.id]);
		}
		values.documents.forEach(({ file }, index) => {
			if (file) validateFile(file, ["documents", index, "file"]);
		});
	});
}

export function caseCreator(api: API, fetch: FetchFn) {
	return async function createCase(
		input: CreateCaseInput,
		options: CreateCaseOptions = {},
	): Promise<CreateCaseResult> {
		// Zod clones the form values, retaining immutable File objects for later retries.
		const values = createCaseFormSchema(undefined).parse({
			firstName: "",
			lastName: "",
			businessName: "",
			caseTypeId: "",
			assignedToUserId: "",
			addressCity: "",
			addressState: "",
			addressStreet: "",
			consultationReason: "",
			email: "",
			phone: "",
			initialAccount: "",
			answers: {},
			documents: [],
			...input,
		});
		const draftId = z.uuid().optional().parse(input.caseDraftId);
		const definition = values.caseTypeId
			? await api.getV1CaseTypeById(values.caseTypeId, options)
			: undefined;
		const questions = definition?.data.questions ?? [];
		const parsed = completeCaseSchema(questions).parse(values);
		const response = await api.postV1Case(
			toCaseCreateInput(parsed, questions, draftId),
			options,
		);
		const pending: PendingCaseUploads = {
			data: response.data,
			answers: parsed.answers,
			documents: parsed.documents,
			uploadedQuestionIds: new Set(),
			uploadedDocumentIds: new Set(),
		};
		const complete = async (
			requestOptions: CreateCaseOptions,
		): Promise<CreateCaseResult> => {
			try {
				await uploadCaseFiles(
					pending,
					async ({ url, method, headers, file }) => {
						if (method !== "PUT")
							throw new Error("El método de carga firmado debe ser PUT.");
						// Storage receives signed headers only, without the API Bearer token.
						const result = await fetch(url, {
							method: "PUT",
							headers,
							body: file,
							signal: requestOptions.signal,
						});
						if (!result.ok)
							throw new Error(
								`No se pudo subir ${file.name} (HTTP ${result.status}).`,
							);
					},
				);
				const confirmed = await api.postV1CaseByIdConfirmUploads(
					pending.data.id,
					requestOptions,
				);
				return {
					caseId: pending.data.id,
					submittedDocumentIds: confirmed.data.submittedDocumentIds ?? [],
				};
			} catch (cause) {
				throw new CaseUploadError(pending.data.id, cause, (retryOptions = {}) =>
					complete(retryOptions),
				);
			}
		};
		return complete(options);
	};
}

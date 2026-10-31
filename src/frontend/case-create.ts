// Synced from gaius/app/src/common/case-create.ts. Run bun run sync:frontend to update.
import type {
  CaseAnswerCreateInput,
  CaseCreateInput,
  CaseCreateResponse,
} from '../api/model.js'
type FileUploadInput = { url: string; method: string; headers: Headers; file: File }
import {
  type CaseFormValues,
  type CaseQuestion,
  type CaseQuestionAnswer,
  createCaseFormSchema,
} from './case-answers.js'

export function toAnswerInput(
  question: CaseQuestion,
  value: CaseQuestionAnswer,
): CaseAnswerCreateInput {
  const answer = { questionId: question.id, valueOptionIDs: null }
  switch (question.answerType) {
    case 'text':
    case 'multiline_text':
      if (typeof value === 'string') return { ...answer, valueString: value }
      break
    case 'number':
      if (typeof value === 'string')
        return { ...answer, valueNumber: Number(value) }
      break
    case 'date':
      if (typeof value === 'string')
        return { ...answer, valueDate: `${value}T00:00:00Z` }
      break
    case 'boolean':
      if (typeof value === 'string')
        return { ...answer, valueBoolean: value === 'true' }
      break
    case 'single_select':
      if (typeof value === 'string') return { ...answer, valueOptionID: value }
      break
    case 'multi_select':
      if (Array.isArray(value)) return { ...answer, valueOptionIDs: value }
      break
    case 'file':
      if (value instanceof File) return { ...answer, valueFileName: value.name }
      break
  }
  throw new Error('La respuesta no coincide con el tipo de pregunta.')
}

/** File answers include only their names; uploading their contents is a separate step. */
export function toCaseCreateInput(
  values: CaseFormValues,
  questions: readonly CaseQuestion[],
  draftId?: string,
): CaseCreateInput {
  const parsed = createCaseFormSchema(questions).parse(values)
  const common = {
    caseDraftId: draftId,
    CaseTypeId: parsed.caseTypeId || null,
    assignedToUserId: parsed.assignedToUserId || null,
    idValue: parsed.idValue,
    addressCity: parsed.addressCity || null,
    addressState: parsed.addressState || null,
    addressStreet: parsed.addressStreet || null,
    consultationReason: parsed.consultationReason || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    initialAccount: parsed.initialAccount || null,
    intakeChannel: parsed.intakeChannel,
    intakeDate: `${parsed.intakeDate}T00:00:00Z`,
    documents: parsed.documents.map((document) => ({
      title: document.title,
      fileName: document.file?.name ?? null,
      status: 'pending' as const,
    })),
    answers: questions.flatMap((question) => {
      const value = parsed.answers[question.id]
      return value == null ? [] : [toAnswerInput(question, value)]
    }),
  }

  if (parsed.personType === 'company') {
    if (parsed.idType !== 'CUIT' && parsed.idType !== 'CDI')
      throw new Error('Para empresas, seleccioná CUIT o CDI.')
    return {
      ...common,
      personType: 'company',
      idType: parsed.idType,
      businessName: parsed.businessName,
      firstName: null,
      lastName: null,
    }
  }
  return {
    ...common,
    personType: 'individual',
    idType: parsed.idType,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    businessName: null,
  }
}

export type PendingCaseUploads = {
  data: Pick<CaseCreateResponse, 'id' | 'answers' | 'documents'>
  answers: CaseFormValues['answers']
  uploadedQuestionIds: Set<string>
  documents: CaseFormValues['documents']
  uploadedDocumentIds: Set<string>
}

export async function uploadCaseFiles(
  pending: PendingCaseUploads,
  upload: (input: FileUploadInput) => Promise<void>,
) {
  const uploads = Object.entries(pending.answers).flatMap(
    ([questionId, file]) => {
      if (
        !(file instanceof File) ||
        pending.uploadedQuestionIds.has(questionId)
      )
        return []
      const answer = pending.data.answers?.find(
        (answer) => answer.questionId === questionId,
      )
      if (!answer?.valueFileUploadURL || !answer.valueFileUploadMethod)
        throw new Error('Faltan los datos para subir un archivo del caso.')
      const headers = new Headers()
      for (const [name, values] of Object.entries(
        answer.valueFileUploadHeaders ?? {},
      )) {
        for (const value of values ?? []) headers.append(name, value)
      }
      return [
        {
          questionId,
          input: {
            url: answer.valueFileUploadURL,
            method: answer.valueFileUploadMethod,
            headers,
            file,
          },
        },
      ]
    },
  )
  // CreateCase returns additional documents in the same order as the input.
  const documentUploads = pending.documents.flatMap(({ file }, index) => {
    if (!file) return []
    const document = pending.data.documents?.[index]
    if (!document)
      throw new Error('Faltan los datos para subir un documento del caso.')
    if (pending.uploadedDocumentIds.has(document.id)) return []
    if (!document.fileUploadURL || !document.fileUploadMethod)
      throw new Error('Faltan los datos para subir un documento del caso.')
    const headers = new Headers()
    for (const [name, values] of Object.entries(
      document.fileUploadHeaders ?? {},
    )) {
      for (const value of values ?? []) headers.append(name, value)
    }
    return [
      {
        id: document.id,
        input: {
          url: document.fileUploadURL,
          method: document.fileUploadMethod,
          headers,
          file,
        },
      },
    ]
  })
  for (const { questionId, input } of uploads) {
    await upload(input)
    pending.uploadedQuestionIds.add(questionId)
  }
  for (const { id, input } of documentUploads) {
    await upload(input)
    pending.uploadedDocumentIds.add(id)
  }
}

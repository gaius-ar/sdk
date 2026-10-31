// Synced from gaius/app/src/schemas/case-answers.ts. Run bun run sync:frontend to update.
import { z } from 'zod'
import type { CaseTypeQuestionWithOptionsAndDocumentRequirement } from '../api/model.js'
import { caseSchema } from './case.js'

const answerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.file(),
  z.null(),
])
export type CaseQuestionAnswer = z.infer<typeof answerValueSchema>
export type CaseQuestion = Pick<
  CaseTypeQuestionWithOptionsAndDocumentRequirement,
  | 'id'
  | 'answerType'
  | 'required'
  | 'options'
  | 'minLength'
  | 'maxLength'
  | 'minValue'
  | 'maxValue'
  | 'allowDecimals'
>

const decimalPattern =
  /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/

function isEmptyAnswer(value: CaseQuestionAnswer | undefined) {
  return (
    value == null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function isValidFileName(name: string) {
  return (
    Boolean(name.trim()) &&
    name !== '.' &&
    name !== '..' &&
    !['/', '\\', '\0', '\r', '\n'].some((character) => name.includes(character))
  )
}

function answerError(
  question: CaseQuestion,
  value: CaseQuestionAnswer,
): string | undefined {
  switch (question.answerType) {
    case 'text':
    case 'multiline_text': {
      if (typeof value !== 'string') return 'Ingresá una respuesta de texto.'
      const length = Array.from(value).length
      if (question.minLength != null && length < question.minLength)
        return `Ingresá al menos ${question.minLength} caracteres.`
      if (question.maxLength != null && length > question.maxLength)
        return `Ingresá como máximo ${question.maxLength} caracteres.`
      break
    }
    case 'number': {
      if (typeof value !== 'string' || !decimalPattern.test(value.trim()))
        return 'Ingresá un número válido.'
      const number = Number(value)
      if (!Number.isFinite(number)) return 'Ingresá un número finito.'
      if (question.minValue != null && number < question.minValue)
        return `Ingresá un número mayor o igual a ${question.minValue}.`
      if (question.maxValue != null && number > question.maxValue)
        return `Ingresá un número menor o igual a ${question.maxValue}.`
      if (!question.allowDecimals && !Number.isInteger(number))
        return 'Ingresá un número entero.'
      break
    }
    case 'date':
      if (typeof value !== 'string' || !z.iso.date().safeParse(value).success)
        return 'Ingresá una fecha válida.'
      break
    case 'boolean':
      if (value !== 'true' && value !== 'false') return 'Seleccioná Sí o No.'
      break
    case 'single_select':
      if (
        typeof value !== 'string' ||
        !question.options.some((option) => option.id === value)
      )
        return 'Seleccioná una opción válida.'
      break
    case 'multi_select':
      if (
        !Array.isArray(value) ||
        new Set(value).size !== value.length ||
        value.some((id) => !question.options.some((option) => option.id === id))
      )
        return 'Seleccioná opciones válidas sin repetir.'
      break
    case 'file':
      if (!(value instanceof File) || !isValidFileName(value.name))
        return 'Seleccioná un archivo con un nombre válido.'
      break
    default:
      return 'El tipo de pregunta no está soportado.'
  }
}

export function createCaseAnswersSchema(questions: readonly CaseQuestion[]) {
  const questionIds = new Set(questions.map((question) => question.id))
  return z
    .record(z.string(), answerValueSchema.optional())
    .superRefine((answers, ctx) => {
      for (const id of Object.keys(answers)) {
        if (!questionIds.has(id))
          ctx.addIssue({
            code: 'custom',
            path: [id],
            message: 'La pregunta no pertenece al tipo de caso seleccionado.',
          })
      }
      for (const question of questions) {
        const value = answers[question.id]
        if (value === undefined || isEmptyAnswer(value)) {
          if (question.required && question.answerType !== 'file')
            ctx.addIssue({
              code: 'custom',
              path: [question.id],
              message: 'Respondé esta pregunta obligatoria.',
            })
          continue
        }
        const message = answerError(question, value)
        if (message)
          ctx.addIssue({ code: 'custom', path: [question.id], message })
      }
    })
    .overwrite((answers) =>
      Object.fromEntries(
        Object.entries(answers).filter(([, value]) => !isEmptyAnswer(value)),
      ),
    )
}

const caseDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Ingresá un título para el documento.'),
  file: z
    .file()
    .nullable()
    .refine(
      (file): boolean => file !== null,
      'Seleccioná un archivo para el documento.',
    )
    .refine(
      (file) => file === null || isValidFileName(file.name),
      'Seleccioná un archivo con un nombre válido.',
    ),
})

export function createCaseFormSchema(
  questions: readonly CaseQuestion[] | undefined,
) {
  return caseSchema.safeExtend({
    documents: z.array(caseDocumentSchema),
    answers:
      questions === undefined
        ? z.record(z.string(), answerValueSchema.optional())
        : createCaseAnswersSchema(questions),
  })
}

export type CaseFormValues = z.infer<ReturnType<typeof createCaseFormSchema>>

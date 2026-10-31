// Synced from gaius/app/src/schemas/case.ts. Run bun run sync:frontend to update.
import { z } from 'zod'
import {
  CaseCreateInputIdType,
  CaseCreateInputIntakeChannel,
  CaseCreateInputPersonType,
} from '../api/model.js'

const identityNumberPattern = /^(?:[0-9]{1,8}|[0-9]{1,3}(?:\.[0-9]{3})+)$/
const taxNumberPattern = /^(?:[0-9]{11}|[0-9]{2}-[0-9]{8}-[0-9])$/
const alphanumericIDPattern = /^[A-Za-z0-9]+$/

function normalizeIdentification(idType: CaseCreateInputIdType, value: string) {
  switch (idType) {
    case 'DNI':
    case 'LC_LE':
      return value.replaceAll('.', '')
    case 'CUIL':
    case 'CUIT':
    case 'CDI':
      return value.replaceAll('-', '')
    case 'Passport':
    case 'CI':
      return value.toUpperCase()
  }
}

function validTaxCheckDigit(value: string): boolean {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const sum = weights.reduce(
    (total, weight, index) => total + Number(value[index]) * weight,
    0,
  )
  let check = 11 - (sum % 11)
  if (check === 11) check = 0
  // Match the backend's compatibility convention for remainder 1.
  if (check === 10) check = 9
  return Number(value[10]) === check
}

export const assignedToUserIdSchema = z.uuid('Seleccioná un responsable.')

export const caseSchema = z
  .object({
    personType: z.enum(CaseCreateInputPersonType, {
      error: 'Seleccioná el tipo de persona.',
    }),
    firstName: z.string().trim(),
    lastName: z.string().trim(),
    businessName: z.string().trim(),
    idType: z.enum(CaseCreateInputIdType, {
      error: 'Seleccioná un tipo de documento válido.',
    }),
    idValue: z.string().trim().min(1, 'Ingresá el número de documento.'),
    addressCity: z.string().trim(),
    addressState: z.string().trim(),
    addressStreet: z.string().trim(),
    assignedToUserId: z.union([z.literal(''), assignedToUserIdSchema]),
    consultationReason: z.string().trim(),
    email: z
      .string()
      .trim()
      .pipe(z.union([z.literal(''), z.email('Ingresá un email válido.')])),
    phone: z.string().trim(),
    initialAccount: z.string().trim(),
    intakeChannel: z.enum(CaseCreateInputIntakeChannel, {
      error: 'Seleccioná un canal de ingreso válido.',
    }),
    intakeDate: z.iso.date('Ingresá una fecha válida (YYYY-MM-DD).'),
    caseTypeId: z.union([z.literal(''), z.uuid('Seleccioná un tipo de caso.')]),
  })
  .superRefine((values, ctx) => {
    if (values.personType === 'individual') {
      if (!values.firstName)
        ctx.addIssue({
          code: 'custom',
          path: ['firstName'],
          message: 'Ingresá el nombre.',
        })
      if (!values.lastName)
        ctx.addIssue({
          code: 'custom',
          path: ['lastName'],
          message: 'Ingresá el apellido.',
        })
    } else {
      if (!values.businessName)
        ctx.addIssue({
          code: 'custom',
          path: ['businessName'],
          message: 'Ingresá la razón social.',
        })
      if (values.idType !== 'CUIT' && values.idType !== 'CDI') {
        ctx.addIssue({
          code: 'custom',
          path: ['idType'],
          message: 'Para empresas, seleccioná CUIT o CDI.',
        })
      }
    }
  })
  .superRefine((values, ctx) => {
    let idValue = values.idValue
    const invalid = (message: string) => {
      ctx.addIssue({ code: 'custom', path: ['idValue'], message })
      return z.NEVER
    }

    switch (values.idType) {
      case 'DNI':
      case 'LC_LE': {
        const minimumLength = values.idType === 'DNI' ? 6 : 1
        if (!identityNumberPattern.test(idValue)) {
          return invalid(
            `Ingresá entre ${minimumLength} y 8 dígitos, con puntos de miles opcionales.`,
          )
        }
        idValue = idValue.replaceAll('.', '')
        if (
          idValue.length < minimumLength ||
          idValue.length > 8 ||
          !/[1-9]/.test(idValue)
        ) {
          return invalid(
            `Ingresá entre ${minimumLength} y 8 dígitos, con valor mayor que cero.`,
          )
        }
        break
      }
      case 'CUIL':
      case 'CUIT':
      case 'CDI': {
        if (!taxNumberPattern.test(idValue)) {
          return invalid(
            `Ingresá los 11 dígitos del ${values.idType}, sin guiones o con formato XX-XXXXXXXX-X.`,
          )
        }
        idValue = idValue.replaceAll('-', '')
        if (!validTaxCheckDigit(idValue)) {
          return invalid(
            `El dígito verificador del ${values.idType} no es válido.`,
          )
        }
        break
      }
      case 'Passport':
      case 'CI': {
        if (!alphanumericIDPattern.test(idValue)) {
          return invalid('Ingresá únicamente letras A-Z y números.')
        }
        break
      }
    }
  })
  .overwrite((values) => ({
    ...values,
    idValue: normalizeIdentification(values.idType, values.idValue),
  }))

export type CaseValues = z.infer<typeof caseSchema>

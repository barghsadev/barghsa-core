import { z } from 'zod/mini';
import type { ContractDraftValues, ContractContextValues } from './contract-authoring-form.js';
export const inactiveContractDraftSchema = z.custom<ContractDraftValues>();
export const inactiveContractContextSchema = z.custom<ContractContextValues>();
export function contractDraftSchema(
  original: Record<string, unknown>,
  existing: boolean,
  profiles: string[],
  orders: string[],
  message: (key: string) => string,
  contentFor: (values: ContractDraftValues) => Record<string, unknown>
) {
  return z.custom<ContractDraftValues>().check((ctx) => {
    const values = ctx.value;
    const issue = (path: keyof ContractDraftValues, key: string) =>
      ctx.issues.push({ code: 'custom', input: values[path], path: [path], message: message(key) });
    if (!existing && !profiles.includes(values.profileId)) issue('profileId', 'profileInvalid');
    if (!existing && values.orderId && !orders.includes(values.orderId))
      issue('orderId', 'orderInvalid');
    if (!existing && !values.title.trim()) issue('title', 'titleInvalid');
    if (!existing && !values.text.trim()) issue('text', 'textInvalid');
    if (!values.changeDescription.trim() || values.changeDescription.trim().length > 1000)
      issue('changeDescription', 'reasonInvalid');
    if (values.commercialValueKind === 'unsupported') issue('commercialValueKind', 'valueInvalid');
    if (
      values.commercialValueKind === 'fixed' &&
      (!/^(0|[1-9][0-9]{0,18})$/.test(values.commercialValueAmountIrr.trim()) ||
        BigInt(values.commercialValueAmountIrr.trim()) > 9_223_372_036_854_775_807n)
    )
      issue('commercialValueAmountIrr', 'amountInvalid');
    if (
      values.commercialValueKind === 'variable' &&
      (!values.commercialValueDescription.trim() ||
        values.commercialValueDescription.trim().length > 500)
    )
      issue('commercialValueDescription', 'descriptionInvalid');
    const content = contentFor(values);
    if (
      !Object.keys(content).length ||
      new TextEncoder().encode(JSON.stringify(content)).length > 65536
    )
      issue(typeof original.text === 'object' ? 'changeDescription' : 'text', 'contentInvalid');
  });
}
export function contractContextSchema(
  bodyFor: (values: ContractContextValues) => {
    serviceStartsAt: string | null;
    serviceEndsAt: string | null;
  },
  message: (key: string) => string
) {
  return z.custom<ContractContextValues>().check((ctx) => {
    const values = ctx.value,
      body = bodyFor(values);
    const issue = (path: keyof ContractContextValues, key: string) =>
      ctx.issues.push({ code: 'custom', input: values[path], path: [path], message: message(key) });
    if (
      values.initialInvoiceId.trim() &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        values.initialInvoiceId.trim()
      )
    )
      issue('initialInvoiceId', 'invoiceInvalid');
    if (values.serviceStartsAt && !body.serviceStartsAt) issue('serviceStartsAt', 'startInvalid');
    if (
      values.serviceEndsAt &&
      (!body.serviceEndsAt ||
        (body.serviceStartsAt &&
          Date.parse(body.serviceEndsAt) <= Date.parse(body.serviceStartsAt)))
    )
      issue('serviceEndsAt', 'endInvalid');
    if (!values.changeDescription.trim() || values.changeDescription.trim().length > 1000)
      issue('changeDescription', 'reasonInvalid');
  });
}

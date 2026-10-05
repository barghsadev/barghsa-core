import { z } from 'zod/mini';
import {
  selectedSolarSource,
  solarContractBody,
  solarContractAmounts,
  solarInt8,
  solarRowPrice,
  type SolarContractDraft,
  type SolarContractOptions,
} from './solar-contract-form.js';
export const inactiveSolarContractSchema = z.custom<SolarContractDraft>();
export function solarContractSchema(
  messages: Record<string, string>,
  options: SolarContractOptions | null
) {
  return z.custom<SolarContractDraft>().check((ctx) => {
    const draft = ctx.value;
    const issue = (path: (string | number)[], message: string, input: unknown) =>
      ctx.issues.push({ code: 'custom', path, message, input });
    for (const [name, max] of [
      ['title', 200],
      ['text', 60000],
      ['changeDescription', 1000],
    ] as const)
      if (
        typeof draft?.[name] !== 'string' ||
        !draft[name].trim() ||
        draft[name].trim().length > max
      )
        issue([name], messages[name]!, draft?.[name]);
    if (!options || !selectedSolarSource(draft?.source ?? '', options))
      issue(['source'], messages.source!, draft?.source);
    if (!['fixed', 'variable'].includes(draft?.valueKind))
      issue(['valueKind'], messages.valueKind!, draft?.valueKind);
    else if (
      draft.valueKind === 'fixed' &&
      (typeof draft.fixedAmount !== 'string' ||
        !/^(0|[1-9][0-9]{0,18})$/.test(draft.fixedAmount) ||
        BigInt(draft.fixedAmount) > solarInt8)
    )
      issue(['fixedAmount'], messages.fixedAmount!, draft.fixedAmount);
    else if (
      draft.valueKind === 'variable' &&
      (typeof draft.variableDescription !== 'string' ||
        !draft.variableDescription.trim() ||
        draft.variableDescription.trim().length > 500)
    )
      issue(['variableDescription'], messages.variableDescription!, draft.variableDescription);
    if (
      !Array.isArray(draft?.invoiceLines) ||
      draft.invoiceLines.length < 1 ||
      draft.invoiceLines.length > 100
    )
      issue(['invoiceLines'], messages.invoiceLines!, draft?.invoiceLines);
    else
      for (const [index, line] of draft.invoiceLines.entries()) {
        if (
          typeof line?.description !== 'string' ||
          !line.description.trim() ||
          line.description.trim().length > 1000
        )
          issue(['invoiceLines', index, 'description'], messages.description!, line?.description);
        for (const [field, min, max] of [
          ['quantity', 1, 2147483647],
          ['vatRate', 0, 10000],
        ] as const)
          if (
            typeof line?.[field] !== 'string' ||
            !line[field].trim() ||
            !Number.isInteger(Number(line[field])) ||
            Number(line[field]) < min ||
            Number(line[field]) > max
          )
            issue(['invoiceLines', index, field], messages[field]!, line?.[field]);
        if (!solarRowPrice(line?.unitPrice))
          issue(['invoiceLines', index, 'unitPrice'], messages.unitPrice!, line?.unitPrice);
        if (typeof line?.isTaxable !== 'boolean')
          issue(['invoiceLines', index, 'isTaxable'], messages.isTaxable!, line?.isTaxable);
      }
    if (ctx.issues.length) return;
    const body = solarContractBody(draft, '', '');
    const content = JSON.stringify({
      title: body.title,
      text: body.text,
      solarSource: body.source,
      commercialValue: body.commercialValue,
    });
    if (new TextEncoder().encode(content).length > 65536)
      issue(['text'], messages.text!, draft.text);
    const total = BigInt(solarContractAmounts(body.invoiceLines).total);
    if (total <= 0n || total > solarInt8)
      issue(
        ['invoiceLines', 0, 'unitPrice'],
        messages.invoiceLines!,
        draft.invoiceLines[0]?.unitPrice
      );
  });
}

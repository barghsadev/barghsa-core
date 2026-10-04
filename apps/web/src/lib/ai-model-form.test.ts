import { describe, expect, it } from 'vitest';
import { aiModel } from '../test/ai-catalogue-fixtures.js';
import {
  blank,
  budgetBody,
  budgetDraftFor,
  invalidBudgetFields,
  invalidModelFields,
  matchesBudgetReceipt,
  matchesModelReceipt,
  modelBody,
  modelDraftFor,
  usdMicros,
  validModels,
} from './ai-model-form.js';

describe('AI model and budget form boundaries', () => {
  it.each([
    ['0.000001', 1],
    ['.123456', 123456],
    ['1000.0000000', 1000000000],
    ['0.0000001', null],
    ['1.1234567', null],
    ['1e-6', null],
    ['Infinity', null],
    ['-1', null],
    ['', null],
  ])('converts USD %s without rounding', (value, expected) => {
    expect(usdMicros(value)).toBe(expected);
  });
  it('preserves the smallest supported cost and validates each missing price', () => {
    const draft = {
      ...budgetDraftFor(aiModel),
      monthlyCostUsd: '0.000001',
      inputPriceUsd: '0',
      outputPriceUsd: '0',
    };
    expect(invalidBudgetFields(draft)).toEqual(['inputPriceUsd', 'outputPriceUsd']);
    draft.inputPriceUsd = '0.000001';
    draft.outputPriceUsd = '0.000002';
    expect(invalidBudgetFields(draft)).toEqual([]);
    expect(budgetBody(draft)).toMatchObject({
      monthlyCostLimitMicros: 1,
      inputPricePerMillionMicros: 1,
      outputPricePerMillionMicros: 2,
    });
  });
  it('rejects fractional token limits and sub-microdollar prices instead of rounding', () => {
    expect(
      invalidBudgetFields({
        ...budgetDraftFor(aiModel),
        monthlyTokenLimit: '1.5',
        monthlyCostUsd: '0.0000001',
        inputPriceUsd: '1.0000001',
      })
    ).toEqual(['monthlyTokenLimit', 'monthlyCostUsd', 'inputPriceUsd']);
  });
  it('keeps tokens out of unchanged updates and distinguishes clear from replacement', () => {
    const draft = modelDraftFor(aiModel);
    expect(modelBody(draft)).not.toHaveProperty('apiToken');
    expect(modelBody({ ...draft, tokenChoice: 'clear' })).toHaveProperty('apiToken', '');
    expect(
      modelBody({ ...draft, tokenChoice: 'replace', apiToken: 'private-new-token' })
    ).toHaveProperty('apiToken', 'private-new-token');
  });
  it('requires an explicit token choice for a changed destination', () => {
    const draft = { ...modelDraftFor(aiModel), baseUrl: 'https://changed.example.test/v1' };
    expect(invalidModelFields(draft, aiModel)).toEqual(['tokenChoice']);
    expect(invalidModelFields({ ...draft, tokenChoice: 'clear' }, aiModel)).toEqual([]);
    expect(invalidModelFields({ ...draft, tokenChoice: 'replace' }, aiModel)).toEqual(['apiToken']);
    expect(
      invalidModelFields(
        { ...draft, tokenChoice: 'replace', apiToken: aiModel.apiTokenMasked },
        aiModel
      )
    ).toEqual(['apiToken']);
  });
  it('retains incomplete numeric values for field validation and permits tokenless local providers', () => {
    const draft = {
      ...blank(),
      title: 'Local',
      baseUrl: 'http://127.0.0.1/v1',
      modelName: 'local',
    };
    expect(invalidModelFields(draft)).toEqual([]);
    expect(invalidModelFields({ ...draft, maxTokens: '', temperature: '' })).toEqual([
      'maxTokens',
      'temperature',
    ]);
  });
  it.each([
    { ...aiModel, id: '' },
    { ...aiModel, apiToken: 'private-server-token' },
    { ...aiModel, apiTokenMasked: 'private-server-token' },
    { ...aiModel, config: { max_tokens: Infinity, temperature: 0 } },
    { ...aiModel, budget: { ...aiModel.budget, usedCostMicros: NaN } },
  ])('does not accept malformed or secret-bearing model receipts', (model) => {
    expect(validModels([model])).toBe(false);
  });
  it('does not accept duplicate identities', () =>
    expect(validModels([aiModel, aiModel])).toBe(false));
  it('checks the submitted configuration and token choice before accepting a save', () => {
    const draft = modelDraftFor(aiModel);
    expect(matchesModelReceipt(aiModel, draft)).toBe(true);
    expect(matchesModelReceipt({ ...aiModel, modelName: 'another' }, draft)).toBe(false);
    expect(matchesModelReceipt({ ...aiModel, id: 'another' }, draft)).toBe(false);
    expect(matchesModelReceipt(aiModel, { ...draft, tokenChoice: 'clear' })).toBe(false);
    expect(
      matchesModelReceipt({ ...aiModel, apiTokenMasked: '' }, { ...draft, tokenChoice: 'clear' })
    ).toBe(true);
  });
  it('requires the saved budget values, while allowing usage telemetry to advance', () => {
    const draft = budgetDraftFor(aiModel);
    expect(
      matchesBudgetReceipt(
        { ...aiModel, budget: { ...aiModel.budget, usedInputTokens: 999 } },
        draft
      )
    ).toBe(true);
    expect(
      matchesBudgetReceipt(
        { ...aiModel, budget: { ...aiModel.budget, monthlyTokenLimit: 20000 } },
        draft
      )
    ).toBe(false);
    const cleared = { ...draft, monthlyTokenLimit: '', monthlyCostUsd: '' };
    expect(matchesBudgetReceipt({ ...aiModel, budget: null }, cleared)).toBe(true);
    expect(matchesBudgetReceipt(aiModel, cleared)).toBe(false);
  });
});

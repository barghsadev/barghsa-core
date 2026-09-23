import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsController } from './products.controller.js';

const query = vi.fn();
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query }) }));

describe('electricity catalogue', () => {
  beforeEach(() => query.mockReset());

  it('shows all four system products and refuses to advertise inactive or unpriced ones', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: 'thermal-id',
          system_key: 'thermal',
          title: { en: 'Thermal' },
          description: null,
          status: 'active',
          price: '2500000000000000000',
          min_kwh: '100',
          max_kwh: '0',
        },
        {
          id: 'green-id',
          system_key: 'green',
          title: { en: 'Green' },
          description: null,
          status: 'inactive',
          price: '300',
          min_kwh: '0',
          max_kwh: '0',
        },
        {
          id: 'market-id',
          system_key: 'free_market',
          title: { en: 'Market' },
          description: null,
          status: 'active',
          price: null,
          min_kwh: null,
          max_kwh: null,
        },
      ],
    });

    const products = await new ProductsController({
      getGreenElectricitySafetyStatus: vi.fn().mockResolvedValue({
        simpleOrder: { blocked: false, reasons: [] },
        advancedOrder: { blocked: false, reasons: [] },
      }),
    } as never).getElectricityProducts();

    expect(products.map((product) => product.systemKey)).toEqual([
      'thermal',
      'green',
      'free_market',
      'energy_saving',
    ]);
    expect(products.map((product) => product.orderable)).toEqual([true, false, false, false]);
    expect(products[0]?.simpleOrderable).toBe(true);
    expect(products[0]?.price).toBe('2500000000000000000');
    expect(products[0]?.limits).toEqual({ minKwh: '100', maxKwh: '0' });
    expect(products[3]).toMatchObject({ id: null, status: 'missing', price: null });
  });

  it('does not offer the simple order action when the configured green rule is blocked', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: 'thermal-id',
          system_key: 'thermal',
          title: { en: 'Thermal' },
          description: null,
          status: 'active',
          price: '1000',
          min_kwh: '0',
          max_kwh: '0',
        },
      ],
    });
    const products = await new ProductsController({
      getGreenElectricitySafetyStatus: vi.fn().mockResolvedValue({
        simpleOrder: { blocked: true, reasons: ['inactive'] },
        advancedOrder: { blocked: false, reasons: [] },
      }),
    } as never).getElectricityProducts();
    expect(products[0]).toMatchObject({
      orderable: true,
      simpleOrderable: false,
      simpleOrderBlockReasons: ['inactive'],
    });
  });
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { Test, type TestingModule } from '@nestjs/testing'
import { PublicBrandingController } from './branding.controller.js'
import { BrandConfigService } from '../admin/brand-config.service.js'

// ─── Mock BrandConfigService ─────────────────────────────────────────────

const mockGetActiveConfig = vi.fn()

vi.mock('../admin/brand-config.service.js', () => ({
  BrandConfigService: vi.fn().mockImplementation(() => ({
    getActiveConfig: mockGetActiveConfig,
  })),
}))

// ─── Suite ───────────────────────────────────────────────────────────────

describe('PublicBrandingController', () => {
  let controller: PublicBrandingController

  beforeEach(async () => {
    vi.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicBrandingController],
      providers: [BrandConfigService],
    }).compile()

    controller = module.get<PublicBrandingController>(PublicBrandingController)
  })

  describe('GET /api/public/branding/config', () => {
    it('returns the active brand config as a public DTO', async () => {
      mockGetActiveConfig.mockResolvedValue({
        id: 'cfg-1',
        config: {
          appTitle: 'My Brand',
          slogan: 'My Slogan',
          primaryColor: '#ff0000',
          secondaryColor: '#00ff00',
          accentColor: '#0000ff',
          logoUrl: 'https://cdn.example.com/logo.png',
          faviconUrl: 'https://cdn.example.com/favicon.ico',
          darkMode: true,
        },
        version: 2,
        status: 'active',
        createdBy: 'admin-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })

      const result = await controller.getActiveBrandConfig()

      expect(result).toEqual({
        appTitle: 'My Brand',
        slogan: 'My Slogan',
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
        accentColor: '#0000ff',
        logoUrl: 'https://cdn.example.com/logo.png',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
        darkMode: true,
      })

      // Assert internal fields are stripped
      expect(result).not.toHaveProperty('id')
      expect(result).not.toHaveProperty('version')
      expect(result).not.toHaveProperty('status')
      expect(result).not.toHaveProperty('createdBy')
      expect(result).not.toHaveProperty('createdAt')
      expect(result).not.toHaveProperty('updatedAt')
    })

    it('applies default fallbacks when config fields are missing', async () => {
      mockGetActiveConfig.mockResolvedValue({
        id: 'cfg-1',
        config: {},
        version: 1,
        status: 'draft',
        createdBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })

      const result = await controller.getActiveBrandConfig()

      expect(result).toEqual({
        appTitle: 'Barghsa',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: false,
      })
    })

    it('handles null values for optional fields', async () => {
      mockGetActiveConfig.mockResolvedValue({
        id: 'cfg-1',
        config: {
          appTitle: 'Test',
          primaryColor: '#123456',
          secondaryColor: '#789abc',
          accentColor: '#def012',
          logoUrl: null,
          faviconUrl: null,
          darkMode: false,
        },
        version: 1,
        status: 'active',
        createdBy: 'admin-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })

      const result = await controller.getActiveBrandConfig()

      expect(result.appTitle).toBe('Test')
      expect(result.logoUrl).toBeNull()
      expect(result.faviconUrl).toBeNull()
      expect(result.darkMode).toBe(false)
    })

    it('preserves string values correctly', async () => {
      mockGetActiveConfig.mockResolvedValue({
        id: 'cfg-1',
        config: {
          appTitle: '  Spaces  ',
          slogan: 'With spaces',
          primaryColor: '#aabbcc',
          secondaryColor: '#ddeeff',
          accentColor: '#112233',
          logoUrl: 'https://cdn.example.com/logo.svg',
          faviconUrl: null,
          darkMode: false,
        },
        version: 1,
        status: 'active',
        createdBy: 'admin-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      })

      const result = await controller.getActiveBrandConfig()

      expect(result.appTitle).toBe('  Spaces  ')
      expect(result.slogan).toBe('With spaces')
      expect(result.logoUrl).toBe('https://cdn.example.com/logo.svg')
    })
  })
})
import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'

export interface ProvinceRow {
  id: string
  nameFa: string
  nameEn: string
}

export interface CityRow {
  id: string
  provinceId: string
  nameFa: string
  nameEn: string
}

export interface CompanyTypeRow {
  id: string
  nameEn: string
  nameFa: string
}

@Injectable()
export class GeographyService {
  private readonly logger = new Logger(GeographyService.name)

  /**
   * Returns all Iranian provinces ordered by Persian name.
   */
  async getProvinces(): Promise<ProvinceRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, name_fa, name_en FROM provinces ORDER BY name_fa ASC`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      nameFa: row.name_fa as string,
      nameEn: row.name_en as string,
    }))
  }

  /**
   * Returns all cities in the specified province ordered by Persian name.
   */
  async getCitiesByProvince(provinceId: string): Promise<CityRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, province_id, name_fa, name_en FROM cities WHERE province_id = $1 ORDER BY name_fa ASC`,
      [provinceId],
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      provinceId: row.province_id as string,
      nameFa: row.name_fa as string,
      nameEn: row.name_en as string,
    }))
  }

  /**
   * Returns all company types ordered by Persian name (T-03.02.03).
   */
  async getCompanyTypes(): Promise<CompanyTypeRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, name_en, name_fa FROM company_types ORDER BY name_fa ASC`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      nameEn: row.name_en as string,
      nameFa: row.name_fa as string,
    }))
  }
}
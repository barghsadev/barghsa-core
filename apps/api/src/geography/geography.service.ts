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

@Injectable()
export class GeographyService {
  private readonly logger = new Logger(GeographyService.name)

  async getProvinces(): Promise<ProvinceRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, name_fa, name_en FROM provinces ORDER BY name_fa ASC`,
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      nameFa: row.name_fa as string,
      nameEn: row.name_en as string,
    }))
  }

  async getCitiesByProvince(provinceId: string): Promise<CityRow[]> {
    const pool = getDbPool()
    const result = await pool.query(
      `SELECT id, province_id, name_fa, name_en FROM cities WHERE province_id = $1 ORDER BY name_fa ASC`,
      [provinceId],
    )
    return result.rows.map((row) => ({
      id: row.id as string,
      provinceId: row.province_id as string,
      nameFa: row.name_fa as string,
      nameEn: row.name_en as string,
    }))
  }
}
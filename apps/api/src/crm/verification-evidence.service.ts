import { readCappedBytes } from '../storage/read-capped-bytes.js'
import { BadRequestException, ConflictException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import type { StorageProvider } from '@barghsa/shared/storage'
import { STORAGE_PROVIDER } from '../storage/storage.constants.js'
import { pickDetectedContentType, sniffContentTypes, SNIFF_SAMPLE_BYTES } from '../upload/content-type-sniffer.js'
import type { DualApprovalQueryClient } from '../admin/dual-approval-resolution.js'
const MAX_BYTES = 10 * 1024 * 1024
const MIME = ['application/pdf','image/jpeg','image/png','image/webp']
const SEALED_PREFIX = 'verification-evidence/'
@Injectable()
export class VerificationEvidenceService {
  constructor(@Optional() @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null = null) {}
  async seal(client: DualApprovalQueryClient, keys: string[], actorId: string, profileId: string): Promise<string[]> {
    if (!keys.length || keys.length > 5 || new Set(keys).size !== keys.length) throw new BadRequestException('One to five distinct evidence files are required')
    if (!this.storage) throw new ServiceUnavailableException('Evidence storage is unavailable')
    const sealed: string[] = []
    for (const key of keys) {
      if (!/^uploads\/(document|image)\/[a-f0-9-]+\.(pdf|png|jpe?g|webp)$/i.test(key)) throw new BadRequestException('Invalid evidence upload key')
      const row = (await client.query('SELECT * FROM storage_records WHERE storage_key=$1 FOR UPDATE',[key])).rows[0] as Record<string,unknown> | undefined
      const metadata = row?.metadata as Record<string,unknown> | undefined
      if (!row || row.status !== 'active' || metadata?.verified !== true || metadata.uploadedBy !== actorId || metadata.profileId !== profileId || metadata.purpose !== 'verification_evidence') throw new BadRequestException('Evidence must be a verified upload for this profile by the corrector')
      const object = await this.storage.getObject(key)
      const read = await readCappedBytes(object.body, MAX_BYTES)
      if(read.truncated) throw new BadRequestException('Evidence file is too large')
      const bytes = Buffer.from(read.bytes), total = bytes.length
      if(!total || String(row.file_size)!==String(total)) throw new BadRequestException('Evidence size changed after upload verification')
      const contentType=pickDetectedContentType(sniffContentTypes(bytes.subarray(0,SNIFF_SAMPLE_BYTES)),MIME)
      if(!contentType) throw new BadRequestException('Unsupported evidence file content')
      const digest=createHash('sha256').update(bytes).digest('hex')
      const sealedKey=`${SEALED_PREFIX}${randomUUID()}/${digest}`
      await this.storage.putObject(sealedKey,bytes,contentType)
      await client.query(`INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name,signed_at,signed_by)
        VALUES ($1,'immutable',$2::jsonb,$3,$4,$5,$6,NOW(),$7)`,[sealedKey,JSON.stringify({purpose:'verification_evidence',profileId,uploadedBy:actorId,sourceKey:key,sha256:digest}),total,contentType,row.category,row.file_name,actorId])
      sealed.push(sealedKey)
    }
    return sealed
  }
  async validate(client: DualApprovalQueryClient, keys: string[], profileId: string): Promise<void> {
    if(!keys.length) throw new ConflictException('Legacy correction has no sealed evidence; recreate it for review')
    for(const key of keys) {
      if(!key.startsWith(SEALED_PREFIX)) throw new ConflictException('Legacy correction evidence must be resubmitted')
      const row=(await client.query('SELECT status,metadata FROM storage_records WHERE storage_key=$1 FOR SHARE',[key])).rows[0] as {status:string;metadata:Record<string,unknown>}|undefined
      if(row?.status!=='immutable' || row.metadata.profileId!==profileId || row.metadata.purpose!=='verification_evidence' || typeof row.metadata.sha256!=='string') throw new ConflictException('Correction evidence is unavailable or unbound')
    }
  }
  async downloadUrls(keys: string[]): Promise<string[]> {
    if(!this.storage) return []
    return Promise.all(keys.filter(key=>key.startsWith(SEALED_PREFIX)).map(key=>this.storage!.presignedGetUrl(key,300)))
  }
}

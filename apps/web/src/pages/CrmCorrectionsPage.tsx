import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearch } from '@tanstack/react-router'
import { t } from '@barghsa/i18n'
import { Button, Input, Label } from '@barghsa/ui'
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js'
import { useLocale } from '../hooks/useLocale.js'
import { uploadVerificationEvidence, isAllowedInvoiceReceiptFile } from '../lib/invoice-bank-receipt-upload.js'
type Status = 'Open' | 'Under Review' | 'Approved' | 'Rejected'
interface Case { assignedName?:string|null; id:string; profileId:string; fieldName:string; requestedValue:string; reason:string; status:Status; createdBy:string }
interface Detail extends Case { currentValue:string|null; evidenceUrls:string[]; evidenceDownloadUrls?:string[]; reviewerNotes:string|null }
interface Queue { cases:Case[]; total:number; viewer:{userId:string;canCreate:boolean;canReview:boolean} }
export default function CrmCorrectionsPage() {
  const {profileId}=useSearch({from:'/admin/crm/corrections'})
  return <Corrections key={profileId ?? 'queue'} profileId={profileId} />
}
function Corrections({profileId}:{profileId:string|undefined}) {
  const locale=useLocale(), generation=useRef(0), detailGeneration=useRef(0), uploading=useRef(false)
  const [refreshVersion,setRefreshVersion]=useState(0)
  const [status,setStatus]=useState<Status>('Open'), [offset,setOffset]=useState(0)
  const [queue,setQueue]=useState<Queue|null>(null), [detail,setDetail]=useState<Detail|null>(null)
  const [loading,setLoading]=useState(true), [detailLoading,setDetailLoading]=useState(false), [busy,setBusy]=useState(false)
  const [error,setError]=useState(false), [saved,setSaved]=useState(false)
  const [profileType,setProfileType]=useState<string|null>(null)
  const [field,setField]=useState('first_name'), [value,setValue]=useState(''), [reason,setReason]=useState('')
  const [fileVersion,setFileVersion]=useState(0)
  const [files,setFiles]=useState<File[]>([]), [notes,setNotes]=useState(''), [decision,setDecision]=useState<Status>('Under Review')
  const [action,setAction]=useState<TeamAction|null>(null)
  const load=useCallback(async()=>{
    const current=++generation.current; ++detailGeneration.current
    setLoading(true);setError(false);setQueue(null);setDetail(null);setDetailLoading(false)
    const params=new URLSearchParams({status,limit:'20',offset:String(offset),...(profileId?{profileId}:{})})
    try {const response=await fetch(`/api/crm/verification-cases?${params}`,{credentials:'include'});if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data.cases))throw new Error();if(current===generation.current)setQueue(data)}
    catch{if(current===generation.current)setError(true)}finally{if(current===generation.current)setLoading(false)}
  },[profileId,status,offset])
  useEffect(()=>{void load();return()=>{++generation.current;++detailGeneration.current}},[load])
  useEffect(()=>{
    if(!profileId)return
    const controller=new AbortController()
    void fetch(`/api/crm/profiles/${encodeURIComponent(profileId)}`,{credentials:'include',signal:controller.signal}).then(async response=>{
      if(!response.ok)return
      const data=await response.json();if(controller.signal.aborted)return
      setProfileType(data.profile.profileType);setField(data.profile.profileType==='LEGAL'?'legal_name':'first_name')
    }).catch(()=>{})
    return()=>controller.abort()
  },[profileId,refreshVersion])
  async function select(item:Case){
    const current=++detailGeneration.current;setDetail(null);setDetailLoading(true);setError(false);setNotes('')
    try{const response=await fetch(`/api/crm/verification-cases/${item.id}`,{credentials:'include'});if(!response.ok)throw new Error();const data=await response.json();if(current===detailGeneration.current){setDetail(data);setDecision(data.status==='Open'?'Under Review':'Approved')}}
    catch{if(current===detailGeneration.current)setError(true)}finally{if(current===detailGeneration.current)setDetailLoading(false)}
  }
  function captured(next:TeamAction){setSaved(false);setAction({...next,forbiddenMessage:t('crm.corrections.self',locale),conflictMessage:t('crm.profile.conflict',locale)})}
  async function create(event:FormEvent){
    event.preventDefault()
    if(!profileId||!files.length||files.length>5||files.some(file=>!isAllowedInvoiceReceiptFile(file))||uploading.current)return
    uploading.current=true;setBusy(true);setError(false)
    try{
      const keys:string[]=[]
      for(const file of files){const key=await uploadVerificationEvidence(file,profileId);if(!key)throw new Error();keys.push(key)}
      captured({title:t('crm.corrections.request',locale),description:`${profileId} · ${t(`crm.corrections.${field}`,locale)} · ${value.trim()} · ${reason.trim()}`,
        path:`/api/crm/profiles/${encodeURIComponent(profileId)}/verification-cases`,method:'POST',body:{fieldName:field,requestedValue:value.trim(),reason:reason.trim(),evidenceUrls:keys}})
    }catch{setError(true)}finally{uploading.current=false;setBusy(false)}
  }
  const evidence=(detail?.evidenceDownloadUrls ?? []).filter(url=>{try{return ['https:','http:'].includes(new URL(url).protocol)}catch{return false}})
  const hasEvidence=!!detail?.evidenceUrls.length && evidence.length===detail.evidenceUrls.length
  return <section className="space-y-5 max-w-5xl mx-auto" dir={locale==='fa'?'rtl':'ltr'}>
    <header><h1 className="text-2xl font-semibold">{t('crm.corrections.title',locale)}</h1><p className="mt-2 text-sm text-gray-600">{t('crm.corrections.description',locale)}</p></header>
    {!profileId&&<p><a className="text-blue-700 underline" href="/admin/crm">{t('crm.corrections.chooseProfile',locale)}</a></p>}
    {profileId&&profileType&&queue?.viewer.canCreate&&<form onSubmit={event=>void create(event)} className="space-y-3 rounded border bg-white p-4">
      <h2 className="font-semibold">{t('crm.corrections.request',locale)}</h2>
      <fieldset disabled={busy||!!action} className="space-y-3">
        <div><Label htmlFor="correction-field">{t('crm.corrections.field',locale)}</Label><select id="correction-field" value={field} onChange={event=>setField(event.target.value)} className="block rounded border p-2">
          {(profileType==='LEGAL'?['legal_name','national_identifier']:['first_name','last_name','national_id']).map(key=><option key={key} value={key}>{t(`crm.corrections.${key}`,locale)}</option>)}
        </select></div>
        <div><Label htmlFor="correction-value">{t('crm.corrections.newValue',locale)}</Label><Input id="correction-value" required maxLength={512} value={value} onChange={event=>setValue(event.target.value)}/></div>
        <div><Label htmlFor="correction-reason">{t('crm.corrections.reason',locale)}</Label><textarea id="correction-reason" required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)} className="block w-full rounded border p-2"/></div>
        <div><Label htmlFor="correction-files">{t('crm.corrections.files',locale)}</Label><Input key={fileVersion} id="correction-files" type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={event=>{const next=Array.from(event.target.files??[]);setFiles(next);setError(next.length>5||next.some(file=>!isAllowedInvoiceReceiptFile(file)))}}/></div>
        <Button type="submit" disabled={!value.trim()||!reason.trim()||!files.length||files.length>5||files.some(file=>!isAllowedInvoiceReceiptFile(file))}>{t(busy?'crm.corrections.uploading':'crm.corrections.upload',locale)}</Button>
      </fieldset>
    </form>}
    <div className="flex flex-wrap items-center gap-3"><Label htmlFor="case-status">{t('crm.corrections.status',locale)}</Label><select id="case-status" disabled={busy||!!action} value={status} onChange={event=>{setStatus(event.target.value as Status);setOffset(0)}} className="rounded border p-2">
      {(['Open','Under Review','Approved','Rejected'] as const).map(value=><option key={value} value={value}>{t(`crm.corrections.${value}`,locale)}</option>)}</select>
      <Button variant="outline" disabled={loading||busy||!!action} onClick={()=>{setRefreshVersion(previous=>previous+1);void load()}}>{t('crm.list.refresh',locale)}</Button></div>
    {saved&&<p role="status">{t('crm.corrections.saved',locale)}</p>}{error&&<p role="alert">{t('crm.corrections.error',locale)}</p>}
    {loading?<p role="status">{t('crm.list.loading',locale)}</p>:queue?.cases.length?<ul className="space-y-2">{queue.cases.map(item=><li key={item.id} className="rounded border bg-white p-3 flex flex-wrap items-center justify-between gap-3">
      <span>{t(`crm.corrections.${item.fieldName}`,locale)} · {item.requestedValue}</span><Button variant="outline" disabled={!!action||busy} onClick={()=>void select(item)}>{t('crm.corrections.details',locale)}</Button>
    </li>)}</ul>:!error&&<p>{t('crm.corrections.empty',locale)}</p>}
    <nav className="flex gap-2" aria-label={t('crm.corrections.title',locale)}><Button variant="outline" disabled={loading||busy||!!action||offset===0} onClick={()=>setOffset(previous=>Math.max(0,previous-20))}>{t('crm.list.previous',locale)}</Button><Button variant="outline" disabled={loading||busy||!!action||!queue||offset+20>=queue.total} onClick={()=>setOffset(previous=>previous+20)}>{t('crm.list.next',locale)}</Button></nav>
    {detailLoading&&<p role="status">{t('crm.list.loading',locale)}</p>}
    {detail&&<article className="space-y-3 rounded border bg-white p-4 break-words">
      <h2 className="font-semibold">{t(`crm.corrections.${detail.fieldName}`,locale)}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{[['profile',detail.profileId],['creator',detail.createdBy],['assignee',detail.assignedName??t('tickets.unassigned',locale)],['currentValue',detail.currentValue??'—'],['newValue',detail.requestedValue],['reason',detail.reason],['status',t(`crm.corrections.${detail.status}`,locale)]].map(([key,value])=><div key={key}><dt className="text-sm text-gray-500">{t(`crm.corrections.${key}`,locale)}</dt><dd className="whitespace-pre-wrap">{value}</dd></div>)}</dl>
      {evidence.map((url,index)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline">{t('crm.corrections.evidence',locale)} {index+1}</a>)}
      {!hasEvidence&&<p role="status">{t('crm.corrections.legacy',locale)}</p>}
      {detail.reviewerNotes&&<p>{detail.reviewerNotes}</p>}
      {queue?.viewer.userId===detail.createdBy?<p>{t('crm.corrections.self',locale)}</p>:queue?.viewer.canReview&&['Open','Under Review'].includes(detail.status)&&<div className="space-y-3">
        <Label htmlFor="case-decision">{t('crm.corrections.save',locale)}</Label><select disabled={busy||!!action} id="case-decision" value={decision} onChange={event=>setDecision(event.target.value as Status)} className="block rounded border p-2">
          {(detail.status==='Open'?['Under Review','Rejected']:['Approved','Rejected']).map(value=><option key={value} value={value}>{t(`crm.corrections.${value}`,locale)}</option>)}
        </select><Label htmlFor="case-notes">{t('crm.corrections.notes',locale)}</Label><textarea disabled={busy||!!action} id="case-notes" maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)} className="block rounded border p-2 w-full"/>
        <Button disabled={busy||!!action||(decision==='Rejected'&&!notes.trim())||(decision==='Approved'&&!hasEvidence)} onClick={()=>captured({title:t(`crm.corrections.${decision}`,locale),description:`${detail.id} · ${detail.requestedValue} · ${notes.trim()}`,path:`/api/crm/verification-cases/${detail.id}/status`,method:'PUT',body:{decision,...(notes.trim()?{reviewerNotes:notes.trim()}:{})}})}>{t('crm.corrections.save',locale)}</Button>
      </div>}
    </article>}
    {action&&<TeamActionDialog action={action} onClose={()=>setAction(null)} onSuccess={async()=>{setSaved(true);setValue('');setReason('');setFiles([]);setFileVersion(previous=>previous+1);await load()}}/>}
  </section>
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearch } from '@tanstack/react-router'
import { Button, Input, Label } from '@barghsa/ui'
import { t } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'
import { withCsrf } from '../lib/csrf.js'
import { isAllowedInvoiceReceiptFile, uploadTicketAttachment } from '../lib/invoice-bank-receipt-upload.js'

type Status = 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed'
interface Ticket {
  id: string; subject: string; body: string; status: Status; priority: string; profileId: string | null
  userId: string; assignedTo: string | null; updatedAt: string; relatedEntityId: string | null
  relatedEntityType: string | null; attachments: string[]; attachmentDownloadUrls?: string[]
}
interface Comment { id: string; authorId: string; body: string; visibility: string; createdAt: string }
interface Queue { data: Ticket[]; totalPages: number; viewer?: { userId: string; canWrite: boolean; canAssignOthers: boolean } }
interface Options { profiles: { id: string; title: string | null }[]; records: { id: string; type: string; created_at: string }[]; hasMoreRecords?: boolean }
const statuses: Status[] = ['open','in_progress','waiting_customer','waiting_staff','resolved','closed']
const transitions: Record<Status, Status[]> = {
  open: ['in_progress'], in_progress: ['waiting_customer','waiting_staff','resolved'], waiting_customer: ['in_progress'],
  waiting_staff: ['in_progress'], resolved: ['closed'], closed: [],
}
export function CustomerTicketsPage() { return <Tickets staff={false} /> }
export function StaffTicketsPage() { return <Tickets staff /> }
function Tickets({ staff }: { staff: boolean }) {
  const routeSearch = useSearch({ strict: false }) as { ticketId?: string }
  const locale = useLocale(), prefix = staff ? '/api/staff/tickets' : '/api/tickets'
  const text = (key: string) => t(`tickets.${key}`,locale)
  const generation = useRef(0), detailGeneration = useRef(0), inFlight = useRef(false)
  const uploads = useRef(new Map<File,string>()), heading = useRef<HTMLHeadingElement>(null)
  const [queue,setQueue] = useState<Queue|null>(null), [loading,setLoading] = useState(true)
  const [page,setPage] = useState(1), [filter,setFilter] = useState(''), [search,setSearch] = useState(''), [term,setTerm] = useState('')
  const [sort,setSort] = useState('desc'), [error,setError] = useState(''), [saved,setSaved] = useState(false), [busy,setBusy] = useState(false)
  const [detail,setDetail] = useState<Ticket|null>(null), [comments,setComments] = useState<Comment[]>([]), [detailLoading,setDetailLoading] = useState(false)
  const [reply,setReply] = useState(''), [internal,setInternal] = useState(false), [nextStatus,setNextStatus] = useState<Status>('open')
  const [assignees,setAssignees] = useState<{id:string;name:string}[]>([]), [assignee,setAssignee] = useState('')
  const [creating,setCreating] = useState(false), [subject,setSubject] = useState(''), [body,setBody] = useState(''), [priority,setPriority] = useState('normal')
  const [recordPage,setRecordPage] = useState(1)
  const [profileId,setProfileId] = useState(''), [record,setRecord] = useState(''), [files,setFiles] = useState<File[]>([]), [fileVersion,setFileVersion] = useState(0)
  const [options,setOptions] = useState<Options|null>(null), [optionsLoading,setOptionsLoading] = useState(false), [optionsVersion,setOptionsVersion] = useState(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true);setQueue(null)
    try {
      const query = new URLSearchParams({page:String(page),limit:'20',search:term,sortOrder:sort,...(filter?{status:filter}:{})})
      const response = await fetch(`${prefix}?${query}`,{credentials:'include'})
      if (!response.ok) throw new Error(response.status===403?'forbidden':'error')
      const data = await response.json() as Queue
      if (!Array.isArray(data.data)) throw new Error('error')
      if (current===generation.current) setQueue(data)
    } catch (reason) { if(current===generation.current) setError(reason instanceof Error?reason.message:'error') }
    finally { if(current===generation.current) setLoading(false) }
  },[prefix,page,term,sort,filter])
  useEffect(()=>{void load();return()=>{++generation.current}},[load])
  useEffect(()=>{
    if(search.trim()===term)return
    const timer=setTimeout(()=>{setTerm(search.trim());setPage(1)},300)
    return()=>clearTimeout(timer)
  },[search,term])
  useEffect(()=>{
    if(staff || !creating)return
    const controller=new AbortController();setOptionsLoading(true);setOptions(null)
    void fetch(`/api/tickets/options${profileId?`?profileId=${encodeURIComponent(profileId)}&recordPage=${recordPage}`:''}`,{credentials:'include',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error();const data=await response.json();if(!controller.signal.aborted)setOptions(data)})
      .catch(()=>{if(!controller.signal.aborted)setError('error')}).finally(()=>{if(!controller.signal.aborted)setOptionsLoading(false)})
    return()=>controller.abort()
  },[staff,creating,profileId,optionsVersion,recordPage])
  useEffect(()=>{
    if(!staff||!queue?.viewer?.canAssignOthers)return
    const controller=new AbortController()
    void fetch(`${prefix}/assignees`,{credentials:'include',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error();const data=await response.json();if(!controller.signal.aborted&&Array.isArray(data))setAssignees(data)
    }).catch(()=>{if(!controller.signal.aborted)setError('error')})
    return()=>controller.abort()
  },[staff,prefix,queue?.viewer?.canAssignOthers])
  async function select(id:string) {
    const current=++detailGeneration.current
    setDetail(null);setComments([]);setDetailLoading(true);setReply('');setInternal(false)
    try {
      const [recordResponse,commentsResponse]=await Promise.all([
        fetch(`${prefix}/${encodeURIComponent(id)}`,{credentials:'include'}),
        fetch(`${prefix}/${encodeURIComponent(id)}/comments`,{credentials:'include'}),
      ])
      if(!recordResponse.ok||!commentsResponse.ok)throw new Error()
      const [ticket,conversation]=await Promise.all([recordResponse.json(),commentsResponse.json()])
      if(current===detailGeneration.current){setDetail(ticket);setComments(conversation);setNextStatus(transitions[ticket.status as Status]?.[0]??'open');setAssignee(ticket.assignedTo??'')}
    } catch {if(current===detailGeneration.current)setError('error')}
    finally{if(current===detailGeneration.current)setDetailLoading(false)}
  }
  useEffect(()=>{if(routeSearch.ticketId)void select(routeSearch.ticketId)},[routeSearch.ticketId,prefix])
  useEffect(()=>{if(detail)heading.current?.focus()},[detail?.id])
  useEffect(()=>()=>{++detailGeneration.current},[])
  async function mutate(path:string,method:string,payload:unknown,id?:string) {
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setSaved(false);setError('')
    try {
      const response=await fetch(path,{method,credentials:'include',headers:withCsrf({'Content-Type':'application/json'}),body:JSON.stringify(payload)})
      if(!response.ok){setError(response.status===409?'conflict':response.status===403?'forbidden':'error');return}
      setSaved(true)
      await Promise.all([load(),...(id?[select(id)]:[])])
    } catch{setError('error')}finally{inFlight.current=false;setBusy(false)}
  }
  async function create(event:FormEvent) {
    event.preventDefault()
    if(inFlight.current||files.length>5||files.some(file=>!isAllowedInvoiceReceiptFile(file)))return
    inFlight.current=true;setBusy(true);setSaved(false);setError('')
    try {
      const keys:string[]=[]
      for(const file of files){let key=uploads.current.get(file);if(!key){key=await uploadTicketAttachment(file,profileId||null)??undefined;if(!key)throw new Error();uploads.current.set(file,key)}keys.push(key)}
      const related=options?.records.find(item=>`${item.type}:${item.id}`===record)
      const response=await fetch(prefix,{method:'POST',credentials:'include',headers:withCsrf({'Content-Type':'application/json'}),body:JSON.stringify({subject:subject.trim(),body:body.trim(),priority,profileId:profileId||null,attachments:keys,...(related?{relatedEntityType:related.type,relatedEntityId:related.id}:{})})})
      if(!response.ok){setError(response.status===409?'conflict':'error');return}
      const created=await response.json() as Ticket
      setSaved(true);setCreating(false);setSubject('');setBody('');setFiles([]);uploads.current.clear();setFileVersion(value=>value+1)
      await Promise.all([load(),select(created.id)])
    }catch{setError('error')}finally{inFlight.current=false;setBusy(false)}
  }
  const canWrite = !staff || queue?.viewer?.canWrite
  const formatDate=(value:string)=>new Intl.DateTimeFormat(locale==='fa'?'fa-IR':'en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
  return <section className="mx-auto max-w-5xl space-y-5" dir={locale==='fa'?'rtl':'ltr'}>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{text(staff?'staffTitle':'title')}</h1>
      {!staff&&<Button disabled={busy} onClick={()=>{setCreating(value=>!value);setError('')}}>{text(creating?'cancel':'create')}</Button>}</header>
    {error&&<p role="alert">{text(['conflict','forbidden'].includes(error)?error:'error')}</p>}{saved&&<p role="status">{text('saved')}</p>}
    {creating&&<form onSubmit={event=>void create(event)} className="rounded border bg-white p-4">
      <fieldset disabled={busy} className="space-y-3">
        <div><Label htmlFor="ticket-subject">{text('subject')}</Label><Input id="ticket-subject" maxLength={200} required value={subject} onChange={event=>setSubject(event.target.value)}/></div>
        <div><Label htmlFor="ticket-body">{text('body')}</Label><textarea id="ticket-body" className="block w-full rounded border p-2" maxLength={10000} required value={body} onChange={event=>setBody(event.target.value)}/></div>
        <div><Label htmlFor="ticket-priority">{text('priority')}</Label><select id="ticket-priority" className="block rounded border p-2" value={priority} onChange={event=>setPriority(event.target.value)}>{['normal','high'].map(value=><option value={value} key={value}>{text(value)}</option>)}</select></div>
        {optionsLoading?<p role="status">{text('loading')}</p>:options?<>
          <div><Label htmlFor="ticket-profile">{text('profile')}</Label><select id="ticket-profile" className="block max-w-full rounded border p-2" value={profileId} onChange={event=>{setProfileId(event.target.value);setRecord('');setRecordPage(1);uploads.current.clear()}}><option value="">{text('noProfile')}</option>{options.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.title??text('unnamed')}</option>)}</select></div>
          {profileId&&<div><Label htmlFor="ticket-record">{text('related')}</Label><select id="ticket-record" className="block max-w-full rounded border p-2" value={record} onChange={event=>setRecord(event.target.value)}><option value="">{text('none')}</option>{options.records.map(item=><option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{text(item.type)} · {item.id.slice(-8)} · {formatDate(item.created_at)}</option>)}</select><div className="flex gap-2 mt-2"><Button type="button" variant="outline" disabled={recordPage===1} onClick={()=>{setRecord('');setRecordPage(value=>value-1)}}>{text('previous')}</Button><Button type="button" variant="outline" disabled={!options.hasMoreRecords} onClick={()=>{setRecord('');setRecordPage(value=>value+1)}}>{text('next')}</Button></div></div>}
        </>:<Button variant="outline" type="button" onClick={()=>setOptionsVersion(value=>value+1)}>{text('retry')}</Button>}
        <div><Label htmlFor="ticket-files">{text('files')}</Label><Input id="ticket-files" key={fileVersion} type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={event=>setFiles(Array.from(event.target.files??[]))}/><p className="text-sm">{text('fileHelp')}</p>{(files.length>5||files.some(file=>!isAllowedInvoiceReceiptFile(file)))&&<p role="alert">{text('invalidFiles')}</p>}</div>
        <Button type="submit" disabled={!subject.trim()||!body.trim()||files.length>5||files.some(file=>!isAllowedInvoiceReceiptFile(file))||optionsLoading||!options}>{text(busy?'saving':'submit')}</Button>
      </fieldset>
    </form>}
    <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <div><Label htmlFor="ticket-search">{text('search')}</Label><Input id="ticket-search" maxLength={200} value={search} onChange={event=>setSearch(event.target.value)}/></div>
      <div><Label htmlFor="ticket-filter">{text('status')}</Label><select id="ticket-filter" className="block rounded border p-2" value={filter} onChange={event=>{setFilter(event.target.value);setPage(1)}}><option value="">{text('all')}</option>{statuses.map(value=><option key={value} value={value}>{text(value)}</option>)}</select></div>
      <div><Label htmlFor="ticket-sort">{text('sort')}</Label><select id="ticket-sort" className="block rounded border p-2" value={sort} onChange={event=>{setSort(event.target.value);setPage(1)}}><option value="desc">{text('newest')}</option><option value="asc">{text('oldest')}</option></select></div>
      <Button variant="outline" disabled={loading} onClick={()=>{setError('');void load()}}>{text('refresh')}</Button>
    </fieldset>
    {loading?<p role="status">{text('loading')}</p>:queue?.data.length?<div className="overflow-x-auto"><table className="w-full text-start"><thead><tr>{['subject','status','priority','updated',...(staff?['customer','assignee']:[])].map(key=><th key={key} className="p-2 text-start">{text(key)}</th>)}</tr></thead><tbody>{queue.data.map(item=><tr key={item.id} className="border-t"><td className="p-2"><button disabled={busy} className="text-blue-700 underline text-start" onClick={()=>{setError('');void select(item.id)}}>{item.subject}</button></td><td className="p-2">{text(item.status)}</td><td className="p-2">{text(item.priority)}</td><td className="p-2 whitespace-nowrap">{formatDate(item.updatedAt)}</td>{staff&&<><td className="p-2">{item.userId}</td><td className="p-2">{assignees.find(person=>person.id===item.assignedTo)?.name??item.assignedTo??text('unassigned')}</td></>}</tr>)}</tbody></table></div>:queue&&<p>{text('empty')}</p>}
    <nav aria-label={text('pages')} className="flex gap-3"><Button variant="outline" disabled={loading||busy||page===1} onClick={()=>setPage(value=>value-1)}>{text('previous')}</Button><Button variant="outline" disabled={loading||busy||!queue||page>=queue.totalPages} onClick={()=>setPage(value=>value+1)}>{text('next')}</Button></nav>
    {detailLoading&&<p role="status">{text('loading')}</p>}
    {detail&&<article className="rounded border bg-white p-4 space-y-4 break-words">
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">{detail.subject}</h2><p>{text(detail.status)} · {text(detail.priority)}</p><p className="whitespace-pre-wrap">{detail.body}</p>
      <p>{text('assignee')}: {assignees.find(person=>person.id===detail.assignedTo)?.name??detail.assignedTo??text('unassigned')}</p>
      {staff&&detail.profileId&&<a className="block text-blue-700 underline" href={`/admin/crm/profiles/${encodeURIComponent(detail.profileId)}`}>{text('openProfile')}</a>}
      {detail.relatedEntityId&&<p>{text(detail.relatedEntityType??'related')}: {detail.relatedEntityType==='invoice'?<a className="text-blue-700 underline" href={staff?'/admin/invoices':`/invoices/${encodeURIComponent(detail.relatedEntityId)}`}>{detail.relatedEntityId}</a>:detail.relatedEntityId}</p>}
      {(detail.attachmentDownloadUrls??[]).filter(url=>/^https?:\/\//.test(url)).map((url,index)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-blue-700 underline">{text('attachment')} {index+1}</a>)}
      {!!detail.attachments?.length&&!detail.attachmentDownloadUrls?.length&&<p role="status">{text('filesUnavailable')}</p>}
      {staff&&queue?.viewer?.canAssignOthers&&<div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="ticket-assignee">{text('assignee')}</Label><select id="ticket-assignee" disabled={busy} className="block rounded border p-2" value={assignee} onChange={event=>setAssignee(event.target.value)}><option value="">{text('choose')}</option>{assignees.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></div><Button disabled={busy||!assignee} onClick={()=>void mutate(`${prefix}/${detail.id}/assign`,'PUT',{assigneeId:assignee},detail.id)}>{text('assign')}</Button></div>}
      {staff&&canWrite&&<div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="ticket-next-status">{text('changeStatus')}</Label><select id="ticket-next-status" disabled={busy} className="block rounded border p-2" value={nextStatus} onChange={event=>setNextStatus(event.target.value as Status)}>{[...transitions[detail.status],...(detail.status!=='open'?['open']:[])].map(value=><option key={value} value={value}>{text(value)}</option>)}</select></div><Button disabled={busy||(detail.status==='open'&&!detail.assignedTo)} onClick={()=>void mutate(`${prefix}/${detail.id}/status`,'PATCH',{status:nextStatus},detail.id)}>{text('saveStatus')}</Button></div>}
      {!staff&&detail.status!=='open'&&<Button disabled={busy} onClick={()=>void mutate(`${prefix}/${detail.id}/status`,'PATCH',{status:'open'},detail.id)}>{text('reopen')}</Button>}
      <h3 className="font-semibold">{text('conversation')}</h3>
      {comments.map(item=><div key={item.id} className={`rounded border p-3 ${item.visibility==='internal'?'border-amber-300 bg-amber-50':'bg-gray-50'}`}><p className="text-sm">{item.authorId} · {formatDate(item.createdAt)} · {text(item.visibility)}</p><p className="whitespace-pre-wrap">{item.body}</p></div>)}
      {canWrite&&!['closed','resolved'].includes(detail.status)&&<form className="space-y-3" onSubmit={event=>{event.preventDefault();if(reply.trim())void mutate(`${prefix}/${detail.id}/comments`,'POST',{body:reply.trim(),visibility:staff&&internal?'internal':'public'},detail.id)}}>
        <Label htmlFor="ticket-reply">{text('reply')}</Label><textarea id="ticket-reply" disabled={busy} required maxLength={10000} className="block w-full rounded border p-2" value={reply} onChange={event=>setReply(event.target.value)}/>
        {staff&&<Label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={internal} onChange={event=>setInternal(event.target.checked)}/>{text('internal')}</Label>}
        <Button disabled={busy||!reply.trim()} type="submit">{text(busy?'saving':'send')}</Button>
      </form>}
    </article>}
  </section>
}

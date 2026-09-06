import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { t } from '@barghsa/i18n'
import { Button, Input, Label } from '@barghsa/ui'
import { DEFAULT_STAFF_ASSIGNMENT_RULES, STAFF_ASSIGNMENT_WORK_TYPES, STAFF_ASSIGNMENT_STRATEGIES, type StaffAssignmentRules, type StaffAssignmentStrategy } from '@barghsa/shared/admin'
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js'
import { useLocale } from '../hooks/useLocale.js'

interface Team { leadUserId?: string | null; id: string; name: string; description: string | null; skillTags: string[]; isActive: boolean; memberUserIds: string[] }
interface Member { id: string; name: string; eligible?: boolean }
const emptyDraft = () => ({ name: '', description: '', tags: '', members: [] as string[], leadUserId:null as string|null })

export default function AdminStaffTeamsPage() {
  const locale = useLocale(), label = (key: string) => t(`admin.teams.${key}`, locale)
  const [teams, setTeams] = useState<Team[]>([]), [rules, setRules] = useState<StaffAssignmentRules>(DEFAULT_STAFF_ASSIGNMENT_RULES)
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState<string | null>(null), [draft, setDraft] = useState(emptyDraft)
  const [search, setSearch] = useState(''), [members, setMembers] = useState<Member[]>([]), [known, setKnown] = useState<Record<string, Member>>({})
  const [memberLoading, setMemberLoading] = useState(false), [memberError, setMemberError] = useState(false), [hasMore, setHasMore] = useState(false)
  const [action, setAction] = useState<TeamAction | null>(null)
  const generation = useRef(0), formHeading = useRef<HTMLHeadingElement>(null)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true); setError(false)
    try {
      const responses = await Promise.all(['/api/admin/staff-teams','/api/admin/config/assignment-rules'].map(path=>fetch(path,{credentials:'include'})))
      if (responses.some(response=>!response.ok)) throw new Error('Unavailable')
      const [data, config] = await Promise.all(responses.map(response=>response.json()))
      if (current===generation.current) { setTeams(data); setRules(config) }
    } catch { if (current===generation.current) setError(true) }
    finally { if (current===generation.current) setLoading(false) }
  }, [])
  useEffect(()=>{void load();return()=>{++generation.current}},[load])
  useEffect(()=>{
    const controller = new AbortController()
    setMemberLoading(true); setMemberError(false)
    const timer=setTimeout(async()=>{
      try {
        const params=new URLSearchParams({q:search,...(editing?{teamId:editing}:{})})
        const response=await fetch(`/api/admin/staff-teams/members?${params}`,{credentials:'include',signal:controller.signal})
        if(!response.ok)throw new Error('Unavailable')
        const data=await response.json() as {items:Member[];selected:Member[];hasMore:boolean}
        if(controller.signal.aborted)return
        setMembers(data.items);setHasMore(data.hasMore)
        setKnown(previous=>({...previous,...Object.fromEntries([...data.items,...data.selected].map(member=>[member.id,member]))}))
      } catch { if(!controller.signal.aborted)setMemberError(true) }
      finally { if(!controller.signal.aborted)setMemberLoading(false) }
    },250)
    return()=>{clearTimeout(timer);controller.abort()}
  },[search,editing])
  function edit(team?:Team) {
    setEditing(team?.id ?? null);setDraft(team?{name:team.name,description:team.description??'',tags:team.skillTags.join(', '),members:[...team.memberUserIds],leadUserId:team.leadUserId??null}:emptyDraft())
    setSearch('');setSaved(false);formHeading.current?.focus()
  }
  function toggleMember(id:string,checked:boolean) {
    setDraft(previous=>({...previous,members:checked?[...previous.members,id]:previous.members.filter(value=>value!==id),leadUserId:!checked&&previous.leadUserId===id?null:previous.leadUserId}))
  }
  function saveTeam(event:FormEvent) {
    event.preventDefault();setSaved(false)
    setAction({title:label('saveTeam'),description:`${draft.name.trim()} · ${draft.members.map(id=>known[id]?.name??label('loading')).join(', ')}`,path:`/api/admin/staff-teams${editing?`/${editing}`:''}`,method:editing?'PUT':'POST',
      body:{name:draft.name.trim(),description:draft.description.trim()||null,skillTags:draft.tags.split(',').map(tag=>tag.trim()).filter(Boolean),memberUserIds:[...draft.members],leadUserId:draft.leadUserId},forbiddenMessage:label('forbidden')})
  }
  const disabled=loading||error||!!action
  return <section className="mx-auto max-w-4xl space-y-6" dir={locale==='fa'?'rtl':'ltr'}>
    <header><h1 className="text-2xl font-semibold">{label('title')}</h1><p className="mt-2 text-sm text-gray-600">{label('description')}</p></header>
    {saved&&<p role="status">{label('saved')}</p>}
    {loading?<p role="status">{label('loading')}</p>:error?<div role="alert">{label('error')} <Button variant="outline" onClick={()=>void load()}>{label('retry')}</Button></div>:<>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{label('teams')}</h2>
        {!teams.length&&<p>{label('empty')}</p>}
        <ul className="space-y-2">{teams.map(team=><li key={team.id} className="flex flex-wrap items-center justify-between gap-3 rounded border bg-white p-3">
          <div><h3 className="font-medium">{team.name}</h3><p className="text-sm text-gray-600">{team.description}</p><p className="text-sm">{label('memberCount')}: {new Intl.NumberFormat(locale).format(team.memberUserIds.length)}{!team.isActive?` · ${label('inactive')}`:''}</p></div>
          <div className="flex gap-2"><Button variant="outline" disabled={disabled} onClick={()=>edit(team)}>{label('edit')}</Button>
          <Button variant="outline" disabled={disabled} onClick={()=>{setSaved(false);setAction({title:label('delete'),description:`${team.name}. ${label('deleteNote')}`,path:`/api/admin/staff-teams/${team.id}`,method:'DELETE',forbiddenMessage:label('forbidden')})}}>{label('delete')}</Button></div>
        </li>)}</ul>
      </div>
      <form onSubmit={saveTeam} className="space-y-4 rounded-lg border bg-white p-4">
        <h2 ref={formHeading} tabIndex={-1} className="text-lg font-semibold">{label(editing?'edit':'new')}</h2>
        <fieldset disabled={disabled} className="space-y-3">
          <div><Label htmlFor="staff-team-name">{label('name')}</Label><Input id="staff-team-name" required maxLength={80} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></div>
          <div><Label htmlFor="staff-team-description">{label('teamDescription')}</Label><textarea id="staff-team-description" maxLength={2000} className="block w-full rounded border p-2" value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></div>
          <div><Label htmlFor="staff-team-tags">{label('tags')}</Label><Input id="staff-team-tags" value={draft.tags} onChange={event=>setDraft({...draft,tags:event.target.value})}/><p className="text-sm text-gray-600">{label('tagsHelp')}</p></div>
          <div><Label htmlFor="staff-team-search">{label('search')}</Label><Input id="staff-team-search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></div>
          {memberLoading?<p role="status">{label('loading')}</p>:memberError?<p role="alert">{label('memberError')}</p>:<>
            <fieldset className="max-h-52 overflow-auto space-y-2"><legend>{label('members')}</legend>{members.map(member=><label key={member.id} className="flex items-center gap-2"><input type="checkbox" checked={draft.members.includes(member.id)} disabled={!draft.members.includes(member.id)&&draft.members.length>=200} onChange={event=>toggleMember(member.id,event.target.checked)}/>{member.name}</label>)}</fieldset>
            {hasMore&&<p className="text-sm">{label('more')}</p>}
          </>}
          <ul aria-label={label('selected')} className="flex flex-wrap gap-2">{draft.members.map(id=><li key={id} className="rounded border p-2 text-sm">{known[id]?.name??label('loading')} {known[id]?.eligible===false&&label('inactive')} <button type="button" className="underline" onClick={()=>toggleMember(id,false)}>{label('remove')}</button></li>)}</ul>
          <div><Label htmlFor="staff-team-lead">{label('lead')}</Label><select id="staff-team-lead" className="block rounded border p-2" value={draft.leadUserId??''} onChange={event=>setDraft({...draft,leadUserId:event.target.value||null})}>
            <option value="">{label('noLead')}</option>{draft.members.map(id=><option key={id} value={id} disabled={known[id]?.eligible===false}>{known[id]?.name??label('loading')}</option>)}
          </select><p className="text-sm text-gray-600">{label('leadHelp')}</p></div>
          <div className="flex gap-2"><Button type="submit" disabled={!draft.name.trim()||memberLoading||memberError}>{label('saveTeam')}</Button>{editing&&<Button type="button" variant="outline" onClick={()=>edit()}>{label('new')}</Button>}</div>
        </fieldset>
      </form>
      <form className="space-y-4 rounded-lg border bg-white p-4" onSubmit={event=>{event.preventDefault();setSaved(false);setAction({title:label('saveRules'),description:STAFF_ASSIGNMENT_WORK_TYPES.map(type=>`${label(type)}: ${teams.find(team=>team.id===rules[type].teamId)?.name??label('manual')} · ${label(rules[type].strategy)}`).join('; '),path:'/api/admin/config/assignment-rules',method:'PUT',body:structuredClone(rules),forbiddenMessage:label('forbidden')})}}>
        <h2 className="text-lg font-semibold">{label('rules')}</h2><p className="text-sm text-gray-600">{label('expertiseHelp')}</p>
        <fieldset disabled={disabled} className="space-y-4">{STAFF_ASSIGNMENT_WORK_TYPES.map(type=><fieldset key={type} className="flex flex-wrap items-end gap-3"><legend className="font-medium">{label(type)}</legend>
          <div><Label htmlFor={`team-${type}`}>{label('team')}</Label><select id={`team-${type}`} className="block rounded border p-2" value={rules[type].teamId??''} onChange={event=>setRules({...rules,[type]:{...rules[type],teamId:event.target.value||null}})}>
            <option value="">{label('manual')}</option>{teams.filter(team=>team.isActive).map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
            {rules[type].teamId&&!teams.some(team=>team.id===rules[type].teamId&&team.isActive)&&<option value={rules[type].teamId!}>{label('unavailable')}</option>}
          </select></div>
          <div><Label htmlFor={`strategy-${type}`}>{label('strategy')}</Label><select id={`strategy-${type}`} className="block rounded border p-2" disabled={!rules[type].teamId} value={rules[type].strategy} onChange={event=>setRules({...rules,[type]:{...rules[type],strategy:event.target.value as StaffAssignmentStrategy}})}>{STAFF_ASSIGNMENT_STRATEGIES.map(strategy=><option key={strategy} value={strategy}>{label(strategy)}</option>)}</select></div>
        </fieldset>)}<Button type="submit">{label('saveRules')}</Button></fieldset>
      </form>
    </>}
    {action&&<TeamActionDialog action={action} onClose={()=>setAction(null)} onSuccess={async()=>{if(action.path.includes('/staff-teams')){setEditing(null);setDraft(emptyDraft())}setSaved(true);await load()}}/>}
  </section>
}

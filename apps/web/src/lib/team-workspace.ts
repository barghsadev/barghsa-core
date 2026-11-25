export type TeamSection = 'members' | 'invitations' | 'roles' | 'invite' | 'transfers';
export type TeamRecordSection = 'members' | 'invitations';
export type TeamWorkspace = {
  section: TeamSection;
  recordId?: string | undefined;
  edit?: boolean | undefined;
  navigate: (section: TeamSection, recordId?: string, edit?: boolean, replace?: boolean) => void;
};

export function teamRecordLink(section: TeamRecordSection, recordId: string, edit = false) {
  return {
    to: '/settings/team/$section/$recordId/{-$action}' as const,
    params: { section, recordId, action: edit ? 'edit' : undefined },
  };
}

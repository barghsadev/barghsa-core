const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export const PROFILE_EXPORT_ARCHIVE_PATTERN = `^tmp/profile-exports/(${uuidPattern})/${uuidPattern}\\.zip$`;
const archivePattern = new RegExp(PROFILE_EXPORT_ARCHIVE_PATTERN);

export function isProfileExportArchive(ticketId: string, key: string | null): key is string {
  if (!key?.endsWith('.zip')) return false;
  return archivePattern.exec(key)?.[1]?.toLowerCase() === ticketId.toLowerCase();
}

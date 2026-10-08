import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';
import { groupPermissions, type EffectivePermissions } from '../lib/staff-permissions.js';

export function EffectivePermissionsView({ data }: { data: EffectivePermissions }) {
  const locale = useLocale();
  const text = (key: string) => t(`admin.roles.effective.${key}`, locale);
  const roles = data.roleIds.map((id, index) => {
    const key = `admin.staff.role.${id}.name`,
      value = t(key, locale);
    return value === key ? (data.roleNames[index] ?? id) : value;
  });
  return (
    <div className="min-w-0 space-y-4" data-testid="effective-permissions">
      <div className="flex flex-wrap items-center gap-3">
        <bdi dir="ltr" className="break-all text-sm">
          {data.userId}
        </bdi>
        {data.isAdmin && (
          <span className="rounded-full bg-muted px-2 py-1 text-xs">{text('admin')}</span>
        )}
      </div>
      {roles.length > 0 && (
        <p className="text-sm">
          {text('roles')}: {roles.join(locale === 'fa' ? '، ' : ', ')}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{text('accountHelp')}</p>
      {data.isWildcard ? (
        <p>{text('wildcard')}</p>
      ) : !data.permissions.length ? (
        <p>{text('none')}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {groupPermissions(data.permissions.map((item) => item.permission)).map((group) => {
            const key = `admin.roles.group.${group.group}`,
              label = t(key, locale);
            return (
              <section key={group.group} className="min-w-0 border-t pt-3">
                <h3 className="text-sm font-semibold">{label === key ? group.group : label}</h3>
                <ul className="mt-2 space-y-1">
                  {group.permissions.map((permission) => (
                    <li key={permission} className="break-all text-sm">
                      <bdi dir="ltr">{permission}</bdi>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

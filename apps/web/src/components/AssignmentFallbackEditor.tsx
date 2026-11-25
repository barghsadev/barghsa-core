import { Button, Label, NativeSelect } from '@barghsa/ui';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  STAFF_ASSIGNMENT_MAX_FALLBACKS,
  STAFF_ASSIGNMENT_STRATEGIES,
  type StaffAssignmentChoice,
  type StaffAssignmentRule,
  type StaffAssignmentStrategy,
} from '@barghsa/shared/admin';

export function AssignmentFallbackEditor({
  workType,
  rule,
  teams,
  label,
  onChange,
  feedback,
  children,
  number,
}: {
  workType: string;
  rule: StaffAssignmentRule;
  teams: Array<{ id: string; name: string; isActive: boolean }>;
  label: (key: string) => string;
  onChange: (rule: StaffAssignmentRule) => void;
  feedback?: { 'aria-invalid': boolean | undefined; 'aria-describedby': string };
  children: ReactNode;
  number: (value: number) => string;
}) {
  const choices: StaffAssignmentChoice[] = rule.teamId
    ? [{ teamId: rule.teamId, strategy: rule.strategy }, ...(rule.fallbacks ?? [])]
    : [];
  const replace = (next: StaffAssignmentChoice[]) => {
    const first = next[0];
    if (!first) return;
    onChange({ ...first, ...(next.length > 1 ? { fallbacks: next.slice(1) } : {}) });
  };
  const move = (index: number, offset: number) => {
    const next = [...choices];
    const target = index + offset;
    if (!next[index] || !next[target]) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    replace(next);
  };
  const available = teams.filter(
    (team) => team.isActive && !choices.some((choice) => choice.teamId === team.id)
  );
  const canAdd = available.length > 0 && choices.length <= STAFF_ASSIGNMENT_MAX_FALLBACKS;
  const addId = `add-fallback-team-${workType}`;
  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-1.5">
        {rule.teamId && (
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-foreground">
              {label('primary')}
            </span>
            {choices.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${label('moveDown')} ${number(1)}`}
                title={label('moveDown')}
                onClick={() => move(0, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
        {children}
      </div>
      {choices.slice(1).map((choice, index) => {
        const position = index + 1;
        const rank = position + 1;
        const rankLabel = number(rank);
        const teamId = `fallback-team-${workType}-${rank}`;
        const strategyId = `fallback-strategy-${workType}-${rank}`;
        return (
          <fieldset
            key={rank}
            className="grid min-w-0 items-end gap-2 rounded-lg border bg-muted/25 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              {label('priority')} {rankLabel}
            </legend>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={teamId}>
                {label('team')} {rankLabel}
              </Label>
              <NativeSelect
                {...feedback}
                id={teamId}
                className="w-full"
                value={choice.teamId}
                onChange={(event) =>
                  replace(
                    choices.map((item, i) =>
                      i === position ? { ...item, teamId: event.target.value } : item
                    )
                  )
                }
              >
                {teams
                  .filter((team) => team.isActive)
                  .map((team) => (
                    <option
                      key={team.id}
                      value={team.id}
                      disabled={choices.some(
                        (item, i) => i !== position && item.teamId === team.id
                      )}
                    >
                      {team.name}
                    </option>
                  ))}
                {!teams.some((team) => team.id === choice.teamId && team.isActive) && (
                  <option value={choice.teamId}>{label('unavailable')}</option>
                )}
              </NativeSelect>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={strategyId}>
                {label('strategy')} {rankLabel}
              </Label>
              <NativeSelect
                {...feedback}
                id={strategyId}
                className="w-full"
                value={choice.strategy}
                onChange={(event) =>
                  replace(
                    choices.map((item, i) =>
                      i === position
                        ? { ...item, strategy: event.target.value as StaffAssignmentStrategy }
                        : item
                    )
                  )
                }
              >
                {STAFF_ASSIGNMENT_STRATEGIES.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {label(strategy)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${label('moveUp')} ${rankLabel}`}
                title={label('moveUp')}
                onClick={() => move(position, -1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${label('moveDown')} ${rankLabel}`}
                title={label('moveDown')}
                disabled={position === choices.length - 1}
                onClick={() => move(position, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${label('removeFallback')} ${rankLabel}`}
                title={label('removeFallback')}
                onClick={() => replace(choices.filter((_, i) => i !== position))}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          </fieldset>
        );
      })}
      {rule.teamId && (
        <div className="max-w-sm space-y-1">
          <Label htmlFor={addId}>{label('addFallback')}</Label>
          <NativeSelect
            id={addId}
            value=""
            disabled={!canAdd}
            className="w-full"
            onChange={(event) => {
              const team = available.find((candidate) => candidate.id === event.target.value);
              if (!canAdd || !team) return;
              const form = event.currentTarget.form;
              replace([...choices, { teamId: team.id, strategy: 'round_robin' }]);
              requestAnimationFrame(() => {
                form
                  ?.querySelector<HTMLElement>(
                    `#fallback-strategy-${workType}-${choices.length + 1}`
                  )
                  ?.focus();
              });
            }}
          >
            <option value="">{label(canAdd ? 'chooseFallback' : 'fallbackUnavailable')}</option>
            {available.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}

import { Button, Label } from '@barghsa/ui';
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
}: {
  workType: string;
  rule: StaffAssignmentRule;
  teams: Array<{ id: string; name: string; isActive: boolean }>;
  label: (key: string) => string;
  onChange: (rule: StaffAssignmentRule) => void;
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
  const available = teams.find(
    (team) => team.isActive && !choices.some((choice) => choice.teamId === team.id)
  );
  return (
    <div className="w-full space-y-3">
      <p className="text-sm text-gray-600">{label('fallbackHelp')}</p>
      {choices.length > 1 && (
        <Button type="button" variant="outline" onClick={() => move(0, 1)}>
          {label('moveDown')} 1
        </Button>
      )}
      {choices.slice(1).map((choice, index) => {
        const position = index + 1;
        const number = position + 1;
        const teamId = `fallback-team-${workType}-${number}`;
        const strategyId = `fallback-strategy-${workType}-${number}`;
        return (
          <fieldset key={number} className="flex flex-wrap items-end gap-3 rounded border p-3">
            <legend>
              {label('priority')} {number}
            </legend>
            <div>
              <Label htmlFor={teamId}>
                {label('team')} {number}
              </Label>
              <select
                id={teamId}
                className="block rounded border p-2"
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
              </select>
            </div>
            <div>
              <Label htmlFor={strategyId}>
                {label('strategy')} {number}
              </Label>
              <select
                id={strategyId}
                className="block rounded border p-2"
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
              </select>
            </div>
            <Button type="button" variant="outline" onClick={() => move(position, -1)}>
              {label('moveUp')} {number}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={position === choices.length - 1}
              onClick={() => move(position, 1)}
            >
              {label('moveDown')} {number}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => replace(choices.filter((_, i) => i !== position))}
            >
              {label('removeFallback')} {number}
            </Button>
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={!rule.teamId || !available || choices.length > STAFF_ASSIGNMENT_MAX_FALLBACKS}
        onClick={() => {
          if (available) replace([...choices, { teamId: available.id, strategy: 'round_robin' }]);
        }}
      >
        {label('addFallback')}
      </Button>
    </div>
  );
}

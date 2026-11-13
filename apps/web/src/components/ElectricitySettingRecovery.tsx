import type { ComponentProps } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { record } from '../lib/catalogue-form.js';
import {
  retentionBasis,
  validRetention,
  validVersionId,
  type RetentionSetting,
  type TemplateSetting,
} from '../lib/electricity-settings-form.js';
import ConfigRecovery from './ConfigRecovery.js';

type CommonProps = Pick<
  ComponentProps<typeof ConfigRecovery<RetentionSetting>>,
  'label' | 'disabled' | 'onBusyChange' | 'onDenied' | 'onActivated'
>;
type Props = CommonProps &
  (
    | { setting: 'wizard-draft-ttl' }
    | { setting: 'electricity-contract-template'; options: TemplateSetting['options'] }
  );

function validTemplateSelection(value: unknown): value is { versionId: string | null } {
  return record(value) && (value.versionId === null || validVersionId(value.versionId));
}

const settingsCopy: Record<string, string> = {
  recoveryLoading: 'settingsRecoveryLoading',
  recoveryReadError: 'settingsRecoveryReadError',
  recoveryStageConfirm: 'settingsRecoveryStageConfirm',
  recoveryActivateConfirm: 'settingsRecoveryActivateConfirm',
  recoveryConflict: 'settingsRecoveryConflict',
};

export default function ElectricitySettingRecovery(props: Props) {
  const { setting, label, disabled, onBusyChange, onDenied, onActivated } = props;
  const numbers = useNumberFormatting(useLocale());
  const title = setting === 'wizard-draft-ttl' ? 'retentionRecoveryTitle' : 'templateRecoveryTitle';
  const common = {
    path: `/api/admin/config/${setting}`,
    label: (key: string) => label(key === 'recoveryTitle' ? title : (settingsCopy[key] ?? key)),
    disabled,
    onBusyChange,
    onDenied,
    onActivated,
  };
  if (setting === 'wizard-draft-ttl')
    return (
      <ConfigRecovery
        {...common}
        valid={validRetention}
        basis={retentionBasis}
        renderValues={({ days }) => (
          <p className="text-sm">
            {label('draftTtlDays')} <bdi>{numbers.number(days)}</bdi>
          </p>
        )}
      />
    );
  return (
    <ConfigRecovery
      {...common}
      valid={validTemplateSelection}
      basis={({ versionId }) => versionId ?? ''}
      renderValues={({ versionId }) => {
        const option = props.options.find(({ id }) => id === versionId);
        return (
          <p className="break-words text-sm">
            {option ? (
              `${option.name} · ${label('templateVersion')} ${numbers.number(option.versionNumber)}`
            ) : versionId === null ? (
              label('templateNone')
            ) : (
              <>
                {label('templateInactive')} · <bdi>{versionId}</bdi>
              </>
            )}
          </p>
        );
      }}
    />
  );
}

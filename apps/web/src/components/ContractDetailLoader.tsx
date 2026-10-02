import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import type { ContractDetail } from './ContractDetail.js';

type DetailComponent = typeof ContractDetail;
export function ContractDetailLoader(props: ComponentProps<DetailComponent>) {
  const locale = useLocale();
  const [Detail, setDetail] = useState<DetailComponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void import('./ContractDetail.js')
      .then((module) => {
        if (!cancelled) setDetail(() => module.ContractDetail);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (Detail) return <Detail {...props} />;
  if (!failed) return <PageLoading label={contractText('loading', locale)} />;
  return (
    <Alert variant="destructive">
      <AlertDescription>{feedbackText('chunkTitle', locale)}</AlertDescription>
      <Button variant="outline" onClick={props.onClose}>
        {contractText('close', locale)}
      </Button>
    </Alert>
  );
}

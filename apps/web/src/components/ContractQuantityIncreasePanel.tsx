import { ElectricityIncreasePanel } from '../pages/ElectricityIncreasePanel.js';

export default function ContractQuantityIncreasePanel(
  props: Parameters<typeof ElectricityIncreasePanel>[0]
) {
  return <ElectricityIncreasePanel {...props} />;
}

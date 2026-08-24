"use client"

/**
 * MultiSelect — Combobox with `multiple` mode and chips for multi-select UX.
 *
 * Built on `@base-ui/react/combobox` with `multiple` and chip rendering.
 * For single-select dropdowns, use the `Select` component from `@/components/ui/select`.
 */

export {
  ComboBox as MultiSelect,
  ComboBoxLabel as MultiSelectLabel,
  ComboBoxTrigger as MultiSelectTrigger,
  ComboBoxInput as MultiSelectInput,
  ComboBoxPopup as MultiSelectPopup,
  ComboBoxItem as MultiSelectItem,
  ComboBoxEmpty as MultiSelectEmpty,
  ComboBoxGroup as MultiSelectGroup,
  ComboBoxGroupLabel as MultiSelectGroupLabel,
  ComboBoxSeparator as MultiSelectSeparator,
  ComboBoxChips as MultiSelectChips,
  ComboBoxChip as MultiSelectChip,
} from "./combo-box"
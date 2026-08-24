"use client"

import * as React from "react"
import { format as dateFnsFormat } from "date-fns"
import {
  format as jalaliFormat,
} from "date-fns-jalali"
import { faIR as jalaliLocale } from "date-fns-jalali/locale"
import { CalendarIcon } from "lucide-react"
import { type DateRange, type Locale } from "react-day-picker"

import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import { Calendar } from "../ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover"

type CalendarMode = "single" | "range"

interface DatePickerBaseProps {
  calendarMode?: CalendarMode
  jalali?: boolean
  placeholder?: string
  className?: string
}

interface DatePickerSingleProps extends DatePickerBaseProps {
  calendarMode?: "single"
  value?: Date
  onChange?: (date: Date | undefined) => void
}

interface DatePickerRangeProps extends DatePickerBaseProps {
  calendarMode: "range"
  value?: DateRange
  onChange?: (range: DateRange | undefined) => void
}

type DatePickerProps = DatePickerSingleProps | DatePickerRangeProps

function DatePicker({
  calendarMode = "single",
  jalali = false,
  placeholder = "انتخاب تاریخ",
  className,
  value,
  onChange,
  ...props
}: DatePickerProps & Omit<React.ComponentProps<typeof Popover>, "children">) {
  const [open, setOpen] = React.useState(false)

  const formatDate = React.useCallback(
    (date: Date) => {
      if (jalali) {
        return jalaliFormat(date, "yyyy/MM/dd", { locale: jalaliLocale })
      }
      return dateFnsFormat(date, "yyyy/MM/dd")
    },
    [jalali]
  )

  const formatRange = React.useCallback(
    (range: DateRange) => {
      if (!range.from) return ""
      if (!range.to) return formatDate(range.from)
      return `${formatDate(range.from)} - ${formatDate(range.to)}`
    },
    [formatDate]
  )

  const displayValue = React.useMemo(() => {
    if (!value) return undefined
    if (calendarMode === "range") {
      return formatRange(value as DateRange)
    }
    return formatDate(value as Date)
  }, [value, calendarMode, formatDate, formatRange])

  return (
    <Popover open={open} onOpenChange={setOpen} {...props}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-start gap-2 text-left font-normal",
              !value && "text-muted-foreground",
              className
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            {displayValue ? (
              <span>{displayValue}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        {calendarMode === "range" ? (
          <Calendar
            mode="range"
            selected={value as DateRange | undefined}
            onSelect={onChange as (range: DateRange | undefined) => void}
            locale={jalali ? (jalaliLocale as unknown as Locale) : undefined}
            defaultMonth={value ? (value as DateRange).from : undefined}
          />
        ) : (
          <Calendar
            mode="single"
            selected={value as Date | undefined}
            onSelect={onChange as (date: Date | undefined) => void}
            locale={jalali ? (jalaliLocale as unknown as Locale) : undefined}
            defaultMonth={value as Date | undefined}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps, DatePickerSingleProps, DatePickerRangeProps }
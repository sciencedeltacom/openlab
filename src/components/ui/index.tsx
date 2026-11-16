/**
 * openlab's component layer.
 *
 * The rule for this file: **HeroUI's own styling is the design.** Wrappers here exist to
 * (a) give one import path, (b) collapse a compound API into a prop-driven one where the
 * app would otherwise repeat the same six lines, and (c) add the handful of components
 * HeroUI does not ship.
 *
 * They must not restyle HeroUI. A wrapper that adds `rounded-full` or `text-[11px]` is
 * fighting the design system, and the fight shows: buttons stop matching menus, chips stop
 * matching fields. If a HeroUI component needs to look different, the theme variables are
 * the place to say so — not a className.
 *
 * So: no radius, no font size, no colour on a HeroUI component. Only composition.
 */

import { useState, type ComponentProps, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X, type LucideIcon } from 'lucide-react';
import { BRAND_ICONS } from '@/lib/brand-icons';
import { parseDate, type CalendarDate } from '@internationalized/date';
import {
  Alert as HeroAlert,
  Avatar as HeroAvatar,
  AvatarGroup as HeroAvatarGroup,
  Badge as HeroBadge,
  Button as HeroButton,
  ButtonGroup as HeroButtonGroup,
  Calendar as HeroCalendar,
  Checkbox as HeroCheckbox,
  Chip as HeroChip,
  DateField as HeroDateField,
  DatePicker as HeroDatePicker,
  Description as HeroDescription,
  Disclosure as HeroDisclosure,
  Drawer as HeroDrawer,
  Dropdown as HeroDropdown,
  Header as HeroHeader,
  Input as HeroInput,
  Kbd as HeroKbd,
  Label as HeroLabel,
  ListBox as HeroListBox,
  Meter as HeroMeter,
  Modal as HeroModal,
  NumberField as HeroNumberField,
  Popover as HeroPopover,
  ProgressBar as HeroProgressBar,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
  ScrollShadow as HeroScrollShadow,
  SearchField as HeroSearchField,
  Select as HeroSelect,
  Separator as HeroSeparator,
  Skeleton as HeroSkeleton,
  Spinner as HeroSpinner,
  Slider as HeroSlider,
  Surface as HeroSurface,
  Switch as HeroSwitch,
  Table as HeroTable,
  Tabs as HeroTabs,
  TextArea as HeroTextArea,
  TextField as HeroTextField,
  Toast as HeroToast,
  ToggleButton as HeroToggleButton,
  ToggleButtonGroup as HeroToggleButtonGroup,
  Toolbar as HeroToolbar,
  Tooltip as HeroTooltip,
  Typography as HeroTypography,
} from '@heroui/react';
import type { SliderProps } from '@heroui/react';

import { cn } from '@/lib/cn';
import { PHASE_CLASS, type Phase } from '@/theme/tokens';

/* ================================================================================================
 * Controls — pure pass-through
 * ============================================================================================== */

export type ButtonProps = ComponentProps<typeof HeroButton> & {
  title?: string;
  /**
   * Shape.
   *
   * `default` is HeroUI's own pill. `field` squares it to the field radius, which is what a
   * control that is the *width of something* wants — a full-width switcher, a trigger that
   * sits in a row of cells. This is the one shape override in the file, and it exists
   * because HeroUI's button radius is fixed in its base styles.
   */
  shape?: 'default' | 'field';
};

/**
 * Button.
 *
 * A pass-through with one addition: `title`. HeroUI styles it, HeroUI names its props.
 * `block` was a private alias for `fullWidth` and has been removed for the same reason.
 */
export function Button({ shape = 'default', className, ref, ...props }: ButtonProps) {
  // `ref` is passed explicitly: HeroUI's Tooltip, Dropdown and Popover attach a press
  // responder to their child, and a wrapper that swallows the ref leaves that responder with
  // nothing to press — which is what React Aria warns about.
  return (
    <HeroButton
      ref={ref}
      className={cn(shape === 'field' && 'rounded-xl', className)}
      {...(props as Record<string, unknown>)}
    />
  );
}

/** Icon-only button. `active` picks HeroUI's secondary variant, not a custom colour. */
export function IconButton({
  active,
  size = 'sm',
  ref,
  ...props
}: Omit<ComponentProps<typeof HeroButton>, 'isIconOnly'> & {
  active?: boolean;
  title?: string;
  /** Forwarded, so a tip or a menu can attach its press responder to this control. */
  ref?: ComponentProps<typeof HeroButton>['ref'];
}) {
  return (
    <HeroButton
      ref={ref}
      isIconOnly
      size={size}
      variant={active ? 'secondary' : 'ghost'}
      {...(props as Record<string, unknown>)}
    />
  );
}

export const Input = HeroInput;

/**
 * A number field.
 *
 * HeroUI's NumberField with its decrement/increment group, collapsed to the value/onChange
 * pair the app already uses so a numeric cell does not repeat the six-line anatomy. Clearing
 * the input calls `onChange(undefined)` — the caller decides what "empty" means for it.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  label,
  className,
  fullWidth,
  variant = 'secondary',
}: {
  value?: number;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  className?: string;
  fullWidth?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <HeroNumberField
      value={value ?? undefined}
      onChange={onChange}
      minValue={min}
      maxValue={max}
      step={step}
      variant={variant}
      className={cn(fullWidth && 'w-full', className)}
    >
      <HeroNumberField.Group>
        <HeroNumberField.DecrementButton aria-label={label ? `Decrease ${label}` : 'Decrease'} />
        <HeroNumberField.Input aria-label={label} className="w-full" />
        <HeroNumberField.IncrementButton aria-label={label ? `Increase ${label}` : 'Increase'} />
      </HeroNumberField.Group>
    </HeroNumberField>
  );
}
export const TextArea = HeroTextArea;
export const TextField = HeroTextField;
export const Label = HeroLabel;
export const Description = HeroDescription;
export const SearchField = HeroSearchField;
export const Switch = HeroSwitch;
export const ListBox = HeroListBox;

/** A single-select with HeroUI's compound parts collapsed into one prop-driven API. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  className,
  variant = 'secondary',
  renderOption,
  renderValue,
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  /**
   * HeroUI's field emphasis. Defaults to `secondary`, which is what a field on a surface
   * wants; pass `primary` for a field that sits directly on the canvas.
   */
  variant?: 'primary' | 'secondary';
  /** Draw an option with its own icon or tint. Falls back to its label. */
  renderOption?: (option: { value: T; label: string }) => ReactNode;
  /** Draw the closed trigger the same way, so the control does not change on open. */
  renderValue?: (option: { value: T; label: string } | undefined) => ReactNode;
}) {
  return (
    <HeroSelect
      aria-label={label ?? placeholder}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
      variant={variant}
      className={className}
    >
      <HeroSelect.Trigger>
        {renderValue ? renderValue(options.find((option) => option.value === value)) : <HeroSelect.Value />}
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover>
        <HeroListBox>
          {options.map((option) => (
            <HeroListBox.Item key={option.value} id={option.value} textValue={option.label}>
              {renderOption ? renderOption(option) : option.label}
            </HeroListBox.Item>
          ))}
        </HeroListBox>
      </HeroSelect.Popover>
    </HeroSelect>
  );
}

/** A labelled switch row. Layout only — the control is HeroUI's. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-body">{label}</div>
        {hint && <div className="text-meta text-muted">{hint}</div>}
      </div>
      {/* HeroUI's Switch is compound: the track is `Control` and the knob is `Thumb`, so a
          bare `<Switch/>` renders nothing and a `Control` without a `Thumb` renders an empty
          track. */}
      <HeroSwitch isSelected={checked} onChange={onChange} aria-label={label}>
        <HeroSwitch.Content>
          <HeroSwitch.Control>
            <HeroSwitch.Thumb />
          </HeroSwitch.Control>
        </HeroSwitch.Content>
      </HeroSwitch>
    </div>
  );
}

/* ================================================================================================
 * Surfaces and layout — HeroUI components, re-exported
 * ============================================================================================== */

export const Surface = HeroSurface;
export const Separator = HeroSeparator;
export const ScrollShadow = HeroScrollShadow;
export const Toolbar = HeroToolbar;
export const Tabs = HeroTabs;
export const Avatar = HeroAvatar;
export const AvatarGroup = HeroAvatarGroup;
export const Badge = HeroBadge;
export const Kbd = HeroKbd;
export const Typography = HeroTypography;
export const Skeleton = HeroSkeleton;
export const Spinner = HeroSpinner;

/** The data table, as a single import point like every other HeroUI component. */
export const Table = HeroTable;
export const ProgressBar = HeroProgressBar;
export const Meter = HeroMeter;
export const Radio = HeroRadio;
export const RadioGroup = HeroRadioGroup;
export const Checkbox = HeroCheckbox;
export const Alert = HeroAlert;

/**
 * HeroUI's toast compound.
 *
 * Re-exported whole so `src/lib/toast.ts` can enqueue a message without importing
 * `@heroui/react` itself. The provider is mounted once in {@link App}; the singleton
 * behind `Toast.toast` is what makes `notify` reachable without a hook or context.
 */
export const Toast = HeroToast;

/**
 * Slider.
 *
 * React Aria's slider is generic over `number | number[]`; a caller that only ever wants
 * one thumb narrows the value itself at the call site. Layout passes through untouched.
 */
const SliderRoot = HeroSlider as unknown as (props: SliderProps) => ReactNode;

export const Slider = Object.assign(SliderRoot, {
  Output: HeroSlider.Output,
  Track: HeroSlider.Track,
  Fill: HeroSlider.Fill,
  Thumb: HeroSlider.Thumb,
  Marks: HeroSlider.Marks,
});

export const Modal = HeroModal;
export const Drawer = HeroDrawer;

/** Chip, untouched. */
export function Chip({ children, ...props }: ComponentProps<typeof HeroChip>) {
  return <HeroChip {...props}>{children}</HeroChip>;
}

/* ================================================================================================
 * Additions HeroUI does not ship
 * ============================================================================================== */

/**
 * A brand's mark on its own, with no tile around it — for a button or a line of text.
 *
 * Same source as `BrandMark`, different job: a control says "Python" once, so its icon is the
 * logo in brand colour rather than a letter in a box.
 */
export function BrandGlyph({
  name,
  className,
  inherit = false,
}: {
  /** A simpleicons slug from the bundled set. */
  name: string;
  className?: string;
  /**
   * Draw it in the text colour instead of the brand's. A control that sits on the themed bar
   * reads as part of the interface that way; the brand blue on a dark bar reads as a sticker.
   */
  inherit?: boolean;
}) {
  const brand = BRAND_ICONS[name];
  if (!brand) {
    return null;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      style={inherit ? undefined : { color: brand.hex }}
      fill="currentColor"
    >
      <path d={brand.path} />
    </svg>
  );
}

/**
 * A service's mark: the brand's own icon in its own colour, or the label's first letter.
 *
 * A brand mark is recognition, not decoration: a list of tiles that all say “G” makes the
 * reader read every label. Where simpleicons.org has no mark — a store with no brand, a
 * connector an extension declared — the letter is the honest fallback rather than a guess.
 */
export function BrandMark({
  icon,
  label,
  className,
}: {
  /** A simpleicons slug. Absent when the service has no mark. */
  icon?: string;
  /** What the letter falls back to. */
  label: string;
  className?: string;
}) {
  const brand = icon ? BRAND_ICONS[icon] : undefined;
  return (
    <span
      aria-hidden
      className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-surface-secondary', className)}
    >
      {brand ? (
        <svg viewBox="0 0 24 24" className="size-[18px]" style={{ color: brand.hex }} fill="currentColor">
          <title>{brand.title}</title>
          <path d={brand.path} />
        </svg>
      ) : (
        <span className="text-body font-medium text-muted">{label.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/** Small-caps section heading, used above grouped content. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}

/**
 * A titled block.
 *
 * Pure layout: a heading, an optional hint and trailing actions above arbitrary content.
 * It composes HeroUI components rather than styling them.
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2">
          {title && <SectionLabel>{title}</SectionLabel>}
          {hint && <span className="text-meta text-muted">{hint}</span>}
          {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Pastel research-phase badge, built on Chip's own colour props. */
export function PhaseChip({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <Chip className={cn(PHASE_CLASS[phase], className)}>
      {/* The domain stores phases in caps for comparison; the chip reads them as words. */}
      {phase.charAt(0) + phase.slice(1).toLowerCase()}
    </Chip>
  );
}

/** Monospace pill for hashes and identifiers. */
export function MonoPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded-sm bg-surface px-1.5 py-0.5 text-meta text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A ring for context-window usage. HeroUI's ProgressCircle is determinate-only in shape. */
export function ProgressRing({
  value,
  size = 22,
  stroke = 2.5,
  tone = 'accent',
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'accent' | 'warning' | 'danger';
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.5s cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      {label && <span className=" text-meta tabular-nums text-muted">{label}</span>}
    </span>
  );
}

/* ================================================================================================
 * Date
 * ============================================================================================== */

/**
 * The domain's `YYYY-MM-DD` as the value HeroUI's picker works in, or `null` when unset.
 *
 * The only place the two representations meet. A malformed string is treated as unset rather
 * than thrown at the UI: the domain is trusted to hold ISO dates, but a bad record should not
 * take the page down.
 */
function toCalendarDate(value: string | null): CalendarDate | null {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/**
 * A date field.
 *
 * The domain stores dates as `YYYY-MM-DD` strings; HeroUI's picker works in
 * `@internationalized/date` values. This wrapper is the only place the two meet, so a caller
 * keeps strings and never learns that library exists. The calendar is HeroUI's own — composed,
 * never restyled.
 */
export function DateInput({
  label,
  value,
  onChange,
  clearable = true,
  className,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Offer a Clear action. Off for a date the domain cannot leave empty. */
  clearable?: boolean;
  className?: string;
}) {
  const date = toCalendarDate(value);
  // The popover's open state is held here so the Clear action can close it as it empties the field.
  const [open, setOpen] = useState(false);

  return (
    <HeroDatePicker
      isOpen={open}
      onOpenChange={setOpen}
      value={date}
      onChange={(next) => onChange(next ? next.toString() : null)}
      className={className}
    >
      <Label>{label}</Label>
      <HeroDateField.Group variant="secondary" fullWidth>
        <HeroDateField.Input>{(segment) => <HeroDateField.Segment segment={segment} />}</HeroDateField.Input>
        <HeroDateField.Suffix>
          <HeroDatePicker.Trigger>
            <HeroDatePicker.TriggerIndicator />
          </HeroDatePicker.Trigger>
        </HeroDateField.Suffix>
      </HeroDateField.Group>
      <HeroDatePicker.Popover>
        <HeroCalendar aria-label={label}>
          <HeroCalendar.Header>
            <HeroCalendar.YearPickerTrigger>
              <HeroCalendar.YearPickerTriggerHeading />
              <HeroCalendar.YearPickerTriggerIndicator />
            </HeroCalendar.YearPickerTrigger>
            <HeroCalendar.NavButton slot="previous" />
            <HeroCalendar.NavButton slot="next" />
          </HeroCalendar.Header>
          <HeroCalendar.Grid>
            <HeroCalendar.GridHeader>
              {(day) => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}
            </HeroCalendar.GridHeader>
            <HeroCalendar.GridBody>
              {(cellDate) => <HeroCalendar.Cell date={cellDate} />}
            </HeroCalendar.GridBody>
          </HeroCalendar.Grid>
          <HeroCalendar.YearPickerGrid>
            <HeroCalendar.YearPickerGridBody>
              {(entry) => <HeroCalendar.YearPickerCell year={entry.year} />}
            </HeroCalendar.YearPickerGridBody>
          </HeroCalendar.YearPickerGrid>
        </HeroCalendar>
        {clearable && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="size-3.5" aria-hidden />
              Clear
            </Button>
          </div>
        )}
      </HeroDatePicker.Popover>
    </HeroDatePicker>
  );
}

/* ================================================================================================
 * Composition helpers
 * ============================================================================================== */

/**
 * Tooltip.
 *
 * `children` is the trigger element itself — a Button, usually. HeroUI's Tooltip takes
 * its trigger as a direct child; wrapping it in `Tooltip.Trigger` is only for custom
 * triggers (an Avatar, a Chip, a plain div), and doing it around a Button nests two
 * focusable elements and trips React Aria's press-responder check.
 */
export function Tip({
  content,
  children,
  placement = 'bottom',
  delay,
}: {
  content: ReactNode;
  children: ReactNode;
  placement?: ComponentProps<typeof HeroTooltip.Content>['placement'];
  /** Milliseconds before the tooltip appears. HeroUI shares one delay across a group. */
  delay?: number;
}) {
  return (
    <HeroTooltip delay={delay}>
      {children as never}
      <HeroTooltip.Content placement={placement}>{content}</HeroTooltip.Content>
    </HeroTooltip>
  );
}

/**
 * A dropdown menu.
 *
 * `trigger` is the button itself, passed as the direct child — HeroUI's `Dropdown` root
 * is the trigger context, so a `Dropdown.Trigger` wrapper around a Button is wrong (it
 * produces a button inside a button).
 */
export function Menu({
  label,
  trigger,
  onAction,
  children,
  placement = 'bottom end',
  popoverClassName,
}: {
  label: string;
  trigger: ReactNode;
  onAction: (key: string) => void;
  children: ReactNode;
  placement?: ComponentProps<typeof HeroDropdown.Popover>['placement'];
  /** Documented way to size a menu: `min-w-[220px]`. */
  popoverClassName?: string;
}) {
  return (
    <HeroDropdown>
      {trigger as never}
      <HeroDropdown.Popover placement={placement} className={popoverClassName}>
        <HeroDropdown.Menu aria-label={label} onAction={(key) => onAction(String(key))}>
          {children}
        </HeroDropdown.Menu>
      </HeroDropdown.Popover>
    </HeroDropdown>
  );
}

/** One entry in a {@link Menu}. `id` is what `onAction` receives. */
export function MenuItem({
  id,
  icon,
  danger,
  children,
}: {
  id: string;
  /** Leading icon, sized and coloured by the caller (`size-4 shrink-0 text-muted`). */
  icon?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <HeroDropdown.Item
      id={id}
      textValue={typeof children === 'string' ? children : undefined}
      variant={danger ? 'danger' : 'default'}
    >
      {icon}
      <Label>{children}</Label>
    </HeroDropdown.Item>
  );
}

/** A collapsible section. Wraps HeroUI's Disclosure without restyling it. */
export function Collapsible({
  title,
  count,
  actions,
  children,
  defaultExpanded = true,
  className,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}) {
  return (
    <HeroDisclosure defaultExpanded={defaultExpanded} className={className}>
      <HeroDisclosure.Heading>
        <HeroDisclosure.Trigger className="flex w-full items-center gap-1.5">
          <HeroDisclosure.Indicator />
          <SectionLabel>{title}</SectionLabel>
          {count !== undefined && <span className=" text-meta text-muted">{count}</span>}
        </HeroDisclosure.Trigger>
        {actions}
      </HeroDisclosure.Heading>
      <HeroDisclosure.Content>
        <HeroDisclosure.Body>{children}</HeroDisclosure.Body>
      </HeroDisclosure.Content>
    </HeroDisclosure>
  );
}

/** A row in a {@link RowList}. */
export function Row({ id, textValue, children }: { id: string; textValue?: string; children: ReactNode }) {
  return (
    <HeroListBox.Item id={id} textValue={textValue}>
      {children}
    </HeroListBox.Item>
  );
}

/** A list of rows. Renders a real listbox, so arrow keys and selection work. */
export function RowList({
  children,
  label,
  selectionMode = 'none',
  selectedKeys,
  onSelectionChange,
  onAction,
}: {
  children: ReactNode;
  label: string;
  selectionMode?: 'none' | 'single' | 'multiple';
  selectedKeys?: ComponentProps<typeof HeroListBox>['selectedKeys'];
  onSelectionChange?: (keys: string[]) => void;
  onAction?: (key: string) => void;
}) {
  return (
    <HeroListBox
      aria-label={label}
      selectionMode={selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={
        onSelectionChange
          ? (keys) => onSelectionChange(keys === 'all' ? [] : [...(keys as Set<string | number>)].map(String))
          : undefined
      }
      onAction={onAction ? (key) => onAction(String(key)) : undefined}
    >
      {children}
    </HeroListBox>
  );
}

/* ================================================================================================
 * Navigation
 *
 * A sidebar is a list of destinations you can be at exactly one of, which is a single-select
 * listbox. Building it out of HeroUI's ListBox rather than out of buttons means arrow keys,
 * type-ahead and selection state come from the library instead of from us.
 * ============================================================================================== */

/** A titled block of destinations. */
export function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <HeroListBox.Section>
      <HeroHeader className="section-label px-2 pt-3 pb-1">{title}</HeroHeader>
      {children}
    </HeroListBox.Section>
  );
}

/* ================================================================================================
 * Segmented control
 *
 * HeroUI ships `ToggleButtonGroup`; these re-exports give it the names the app uses and keep
 * the "one import path" rule intact.
 * ============================================================================================== */

/** HeroUI's Disclosure, for callers that need to compose their own header. */
export const Disclosure = HeroDisclosure;

export const ToggleButtonGroup = HeroToggleButtonGroup;
export type ToggleButtonProps = ComponentProps<typeof HeroToggleButton> & {
  /**
   * Native tooltip.
   *
   * HeroUI's toggle button does not type the DOM `title`, and an icon-only choice still
   * has to say what it is. Same reason `Button` takes one.
   */
  title?: string;
};
/** HeroUI's toggle button, plus a native `title` for icon-only choices. */
export function ToggleButton(props: ToggleButtonProps) {
  return <HeroToggleButton {...(props as Record<string, unknown>)} />;
}
export const ButtonGroup = HeroButtonGroup;

/* ================================================================================================
 * Cells
 *
 * The settings idiom: a labelled row with a description and one trailing control. Apple's
 * Settings app has used this shape for fifteen years because it reads in one glance — the
 * label says what, the description says why, the control does it.
 *
 * A group is one surface with hairline separators between rows rather than one bordered box
 * per row. That is the one place a hairline earns its keep: inside a group, a line separates
 * peers; around a card, a line is just a box.
 * ============================================================================================== */

/** A group of cells on one surface. */
export function CellGroup({
  title,
  footnote,
  children,
  className,
}: {
  title?: string;
  footnote?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title && <SectionLabel>{title}</SectionLabel>}
      {/*
        A real Surface rather than a `bg-surface` div. HeroUI's rule for fields — use
        `variant="secondary"` when a field sits on a Surface — only means anything if the
        container *is* one, and a secondary field fills with `--default`, so a `bg-surface`
        island would swallow it whole.
      */}
      <HeroSurface className="overflow-hidden rounded-2xl">{children}</HeroSurface>
      {footnote && <p className="px-1 text-meta text-muted">{footnote}</p>}
    </section>
  );
}

/** One row in a {@link CellGroup}. */
export function Cell({
  label,
  description,
  control,
  onClick,
  leading,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** Trailing control: a Switch, a Select, a value, a chevron. */
  control?: ReactNode;
  /** Makes the whole row pressable when the control is not. */
  onClick?: () => void;
  leading?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-body text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-meta text-muted">{description}</span>}
      </span>
      {control && <span className="flex shrink-0 items-center gap-1.5">{control}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn('flex w-full items-center gap-3 px-4 py-3 text-start', className)}
      >
        {content}
      </button>
    );
  }

  return <div className={cn('flex items-center gap-3 px-4 py-3', className)}>{content}</div>;
}

/** A hairline between two cells. Use between rows inside a {@link CellGroup}. */
export function CellSeparator() {
  return <div className="mx-4 h-px bg-separator" aria-hidden />;
}

/**
 * A popover anchored to a trigger.
 *
 * `trigger` is the trigger element itself, passed as the direct child — HeroUI's Popover
 * root is the trigger context, so wrapping a Button in `Popover.Trigger` nests two
 * focusables. Unlike the menu wrapper this exists to hold *content* rather than a list of
 * actions: a filter panel, a tabbed picker, a form.
 */
export function Popover({
  trigger,
  children,
  placement = 'bottom end',
  className,
  isOpen,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  placement?: ComponentProps<typeof HeroPopover.Content>['placement'];
  className?: string;
  /**
   * Controlled open state. A popover whose content makes a choice (a picker) has to close
   * itself on that choice, which an uncontrolled trigger cannot express.
   */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <HeroPopover isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger as never}
      <HeroPopover.Content placement={placement} className={className}>
        {children}
      </HeroPopover.Content>
    </HeroPopover>
  );
}

/**
 * A dialog.
 *
 * One shape for every overlay in the app, because five dialogs each choosing their own
 * padding is five chances to get it wrong — and they had: a body padded like a page inside a
 * panel that is already a surface, and a footer with its own inset on top of that.
 *
 * The entrance is a spring rather than a curve, and it rises: the dialog comes up from below
 * the place it lands, fading in as it arrives, which reads as an object appearing rather than
 * a div being shown. The container centres it — its own layout does not, so the wrapper says
 * so, and the dialog was sitting at the top of the window with the room's worth of nothing
 * underneath it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  width = 520,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <HeroModal isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <HeroModal.Backdrop className="backdrop-blur-sm">
        <HeroModal.Container placement="center" className="justify-center">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.9 }}
            style={{ width, maxWidth: '92vw' }}
          >
            {/* HeroUI pads its dialog 24px. A hundred and fifty per cent of that on a
                three-field form is a dialog that looks like an empty room. */}
            <HeroModal.Dialog className="p-4">
              {/* The dialog already pads itself 24px. Anything more here is padding added
                  twice — which is what it was: 44px of inset around a three-field form. */}
              <HeroModal.Header className="gap-1">
                <HeroModal.Heading className="text-title">{title}</HeroModal.Heading>
                {description && <p className="text-meta text-muted">{description}</p>}
              </HeroModal.Header>

              <HeroModal.Body className="mt-3 flex flex-none flex-col gap-3">{children}</HeroModal.Body>

              {footer && <HeroModal.Footer className="mt-4">{footer}</HeroModal.Footer>}
            </HeroModal.Dialog>
          </motion.div>
        </HeroModal.Container>
      </HeroModal.Backdrop>
    </HeroModal>
  );
}

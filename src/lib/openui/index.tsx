/**
 * OpenUI, as openlab uses it.
 *
 * OpenUI is a streaming-first language for model-generated interfaces. The agent writes a
 * short program — `root = Stack([...])` — and the renderer draws it from the component
 * library as each line arrives. This module is the single place the app and the model meet:
 * it holds the library the renderer draws with, the fence the model wraps a program in, and
 * the system-prompt fragment that teaches the model to write one when a picture helps.
 *
 * The library is OpenUI's own, with two changes that make it belong here:
 *
 *  - **The theme.** `theme/openui.css` points OpenUI's tokens at openlab's (which are HeroUI's),
 *    so every generated surface and chart reads in the app's palette and follows the workbench
 *    into dark mode.
 *  - **The controls.** Everything the reader touches — button, fields, slider, toggles — is the
 *    app's own HeroUI component, wrapped so OpenUI keeps driving its state, validation and
 *    actions. The schemas are OpenUI's, so the prompt and the parser are unchanged.
 *
 * openlab answers in prose by default and reaches for UI only when it earns its place, so the
 * preamble steers the model to mix the two rather than reply in OpenUI alone.
 */

import { useEffect, useMemo } from 'react';
import type { ActionPlan, DefinedComponent } from '@openuidev/react-lang';
import {
  ACTION_STEPS,
  createLibrary,
  defineComponent,
  parseStructuredRules,
  useFormName,
  useFormValidation,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from '@openuidev/react-lang';
import {
  openuiComponentGroups,
  openuiLibrary as baseLibrary,
  openuiPromptOptions,
} from '@openuidev/react-ui/genui-lib';

import {
  Button as HeroButton,
  Checkbox as HeroCheckbox,
  Input as HeroInput,
  Radio as HeroRadio,
  RadioGroup as HeroRadioGroup,
  Select as HeroSelect,
  Slider as HeroSlider,
  Switch as HeroSwitch,
  Table as HeroTable,
  TextArea as HeroTextArea,
} from '@/components/ui';

/** Coerce a column's `data` into a row array, the way OpenUI's own table does. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value == null ? [] : [value];
}

/** The fence the model wraps an interactive program in, and the renderer looks for. */
export const OPENUI_FENCE = 'openui-lang';

/** One stable paragraph steering the model to mix prose and interface. */
const PREAMBLE = [
  'You are openlab, a research workbench agent. Answer in Markdown by default.',
  'When a visual, interactive or structured answer genuinely helps the reader (a chart, a table,',
  'a form, a set of choices, a confirmation), include a single fenced ```openui-lang block that',
  'builds it, and keep the surrounding prose in Markdown. Never make the whole answer OpenUI Lang.',
  'Always write a complete program inside the fence: define root and every reference it uses.',
].join(' ');

let cached: string | undefined;

/**
 * The OpenUI instructions, appended to the session system prompt.
 *
 * Generated once from the library: it is deterministic and large (~40 KB), so building it per
 * turn would waste the work. The same library is handed to the renderer, so every component
 * the model is told about is one the interface can draw.
 */
export function openuiSystemPrompt(): string {
  if (cached === undefined) {
    cached = openuiLibrary.prompt({
      ...openuiPromptOptions,
      // Two examples teach the idiom; the other four are the same idiom again, and every
      // token here is paid on every turn of every session.
      examples: (openuiPromptOptions.examples ?? []).slice(0, 2),
      preamble: PREAMBLE,
      // Let the model answer with prose, an interface, or both.
      inlineMode: true,
      // Forms and `$variables` are interactive without needing a backend tool.
      bindings: true,
      additionalRules: [
        ...(openuiPromptOptions.additionalRules ?? []),
        'Inside the fence, always output a complete, self-contained program: define root and every reference it uses.',
      ],
    });
  }
  return cached;
}

/* ------------------------------------------------------------------------------------------------
 * The HeroUI controls
 *
 * Each wrapper keeps OpenUI's contract exactly — the same schema, the same field state and the
 * same validation registration — and swaps only the paint for an openlab (HeroUI) component.
 * ---------------------------------------------------------------------------------------------- */

const base = baseLibrary.components;

/** Register a field with the form's validator while the turn has settled. */
function useFieldRules(
  name: string,
  value: unknown,
  rules: ReturnType<typeof parseStructuredRules>,
  isStreaming: boolean,
): void {
  const formValidation = useFormValidation();
  useEffect(() => {
    if (!isStreaming && rules.length > 0 && formValidation) {
      formValidation.registerField(name, rules, () => value);
      return () => formValidation.unregisterField(name);
    }
    return undefined;
  }, [name, value, formValidation, rules, isStreaming]);
}

const BUTTON_VARIANTS: Record<string, 'primary' | 'secondary' | 'ghost'> = {
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'ghost',
  ghost: 'ghost',
};

const Button = defineComponent({
  name: 'Button',
  props: base.Button.props,
  description: base.Button.description,
  component: ({ props }) => {
    const triggerAction = useTriggerAction();
    const formName = useFormName();
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const label = props.label as string;
    const variant = (props.variant as string) || 'primary';

    return (
      <HeroButton
        variant={props.type === 'destructive' ? 'danger' : (BUTTON_VARIANTS[variant] ?? 'primary')}
        isDisabled={isStreaming}
        onPress={() => {
          const action = props.action as ActionPlan | undefined;
          // A primary button that submits or mutates must first pass the form's own rules.
          if (formValidation && variant === 'primary') {
            if (action?.steps) {
              const needsValidation = action.steps.some(
                (step) =>
                  step.type === ACTION_STEPS.ToAssistant ||
                  (step.type === ACTION_STEPS.Run && step.refType === 'mutation'),
              );
              if (needsValidation && !formValidation.validateForm()) {
                return;
              }
            } else if (!formValidation.validateForm()) {
              return;
            }
          }
          triggerAction(label, formName, action);
        }}
      >
        {label}
      </HeroButton>
    );
  },
});

const Input = defineComponent({
  name: 'Input',
  props: base.Input.props,
  description: base.Input.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const field = useStateField(props.name, props.value);
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    useFieldRules(field.name, field.value, rules, isStreaming);

    return (
      <HeroInput
        fullWidth
        name={field.name}
        type={(props.type as string) || 'text'}
        placeholder={(props.placeholder as string) || ''}
        value={field.value ?? ''}
        disabled={isStreaming}
        onFocus={() => formValidation?.clearFieldError(field.name)}
        onChange={(event) => {
          field.setValue(event.target.value);
          if (rules.length > 0) {
            formValidation?.clearFieldError(field.name);
          }
        }}
        onBlur={(event) => {
          if (rules.length > 0) {
            formValidation?.validateField(field.name, event.target.value, rules);
          }
        }}
      />
    );
  },
});

const TextArea = defineComponent({
  name: 'TextArea',
  props: base.TextArea.props,
  description: base.TextArea.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const field = useStateField(props.name, props.value);
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    useFieldRules(field.name, field.value, rules, isStreaming);

    return (
      <HeroTextArea
        fullWidth
        name={field.name}
        rows={(props.rows as number) || 3}
        placeholder={(props.placeholder as string) || ''}
        value={field.value ?? ''}
        disabled={isStreaming}
        onFocus={() => formValidation?.clearFieldError(field.name)}
        onChange={(event) => {
          field.setValue(event.target.value);
          if (rules.length > 0) {
            formValidation?.clearFieldError(field.name);
          }
        }}
        onBlur={(event) => {
          if (rules.length > 0) {
            formValidation?.validateField(field.name, event.target.value, rules);
          }
        }}
      />
    );
  },
});

const Slider = defineComponent({
  name: 'Slider',
  props: base.Slider.props,
  description: base.Slider.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const field = useStateField(props.name, props.value);
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    useFieldRules(field.name, field.value, rules, isStreaming);

    const value =
      (field.value as number[] | undefined)?.[0] ??
      (props.defaultValue as number[] | undefined)?.[0] ??
      props.min;
    const label = (props.label as string) || props.name;

    return (
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-label text-foreground">{label}</span>
          <span className="text-label tabular-nums text-muted">{value}</span>
        </div>
        <HeroSlider
          value={value}
          minValue={props.min}
          maxValue={props.max}
          step={props.step ?? (props.variant === 'discrete' ? 1 : undefined)}
          isDisabled={isStreaming}
          aria-label={label}
          className="w-full"
          onChange={(next) => {
            const single = Array.isArray(next) ? next[0] : next;
            field.setValue([single]);
            if (rules.length > 0) {
              formValidation?.validateField(field.name, single, rules);
            }
          }}
        >
          <HeroSlider.Track>
            <HeroSlider.Fill />
            <HeroSlider.Thumb />
          </HeroSlider.Track>
        </HeroSlider>
      </div>
    );
  },
});

const Select = defineComponent({
  name: 'Select',
  props: base.Select.props,
  description: base.Select.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const field = useStateField(props.name, props.value);
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    useFieldRules(field.name, field.value, rules, isStreaming);

    const options = ((props.items ?? []) as Array<{ props: { value: string; label?: string } }>)
      .filter((item) => item?.props?.value)
      .map((item) => ({ value: item.props.value, label: item.props.label || item.props.value }));

    if (options.length === 0) {
      return null;
    }

    return (
      <HeroSelect
        value={(field.value as string) || ''}
        options={options}
        placeholder={(props.placeholder as string) || 'Select…'}
        onChange={(next) => {
          field.setValue(next);
          if (rules.length > 0) {
            formValidation?.validateField(field.name, next, rules);
          }
        }}
        className={isStreaming ? 'pointer-events-none opacity-60' : undefined}
      />
    );
  },
});

const Table = defineComponent({
  name: 'Table',
  props: base.Table.props,
  description: base.Table.description,
  component: ({ props, renderNode }) => {
    const defs = ((props.columns ?? []) as Array<{ props?: { label?: string; data?: unknown } }>)
      .filter((column) => column?.props)
      .map((column) => ({ label: column.props?.label ?? '', data: asArray(column.props?.data) }));

    const rowCount = defs.length > 0 ? Math.max(...defs.map((column) => column.data.length), 0) : 0;

    if (defs.length === 0) {
      return null;
    }

    return (
      <HeroTable>
        <HeroTable.ScrollContainer>
          <HeroTable.Content aria-label="Generated table">
            <HeroTable.Header>
              {defs.map((column, index) => (
                <HeroTable.Column key={index} isRowHeader={index === 0}>
                  {column.label}
                </HeroTable.Column>
              ))}
            </HeroTable.Header>
            <HeroTable.Body>
              {Array.from({ length: rowCount }, (_, rowIndex) => (
                <HeroTable.Row key={rowIndex} id={String(rowIndex)}>
                  {defs.map((column, columnIndex) => {
                    const cell = column.data[rowIndex];
                    return (
                      <HeroTable.Cell key={columnIndex}>
                        {typeof cell === 'object' && cell !== null ? renderNode(cell) : String(cell ?? '')}
                      </HeroTable.Cell>
                    );
                  })}
                </HeroTable.Row>
              ))}
            </HeroTable.Body>
          </HeroTable.Content>
        </HeroTable.ScrollContainer>
      </HeroTable>
    );
  },
});

const CheckBoxGroup = defineComponent({
  name: 'CheckBoxGroup',
  props: base.CheckBoxGroup.props,
  description: base.CheckBoxGroup.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const field = useStateField(props.name, props.value);
    const items = (props.items ?? []) as Array<{
      props: { name: string; label: string; description?: string; defaultChecked?: boolean };
    }>;
    const stored = field.value as Record<string, boolean> | undefined;

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-col gap-2.5">
        {items.map((item) => {
          const checked = stored?.[item.props.name] ?? item.props.defaultChecked ?? false;
          return (
            <HeroCheckbox
              key={item.props.name}
              isSelected={checked}
              isDisabled={isStreaming}
              onChange={(next) => field.setValue({ ...(stored ?? {}), [item.props.name]: next })}
            >
              <HeroCheckbox.Content>
                <HeroCheckbox.Control>
                  <HeroCheckbox.Indicator />
                </HeroCheckbox.Control>
                <span className="flex flex-col">
                  <span className="text-body">{item.props.label}</span>
                  {item.props.description && (
                    <span className="text-meta text-muted">{item.props.description}</span>
                  )}
                </span>
              </HeroCheckbox.Content>
            </HeroCheckbox>
          );
        })}
      </div>
    );
  },
});

const RadioGroup = defineComponent({
  name: 'RadioGroup',
  props: base.RadioGroup.props,
  description: base.RadioGroup.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const formValidation = useFormValidation();
    const field = useStateField(props.name, props.value);
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules]);
    useFieldRules(field.name, field.value, rules, isStreaming);

    const items = (props.items ?? []) as Array<{
      props: { value: string; label?: string; description?: string };
    }>;

    if (items.length === 0) {
      return null;
    }

    return (
      <HeroRadioGroup
        value={(field.value as string) || ''}
        isDisabled={isStreaming}
        className="gap-2"
        onChange={(next) => {
          field.setValue(next);
          if (rules.length > 0) {
            formValidation?.validateField(field.name, next, rules);
          }
        }}
      >
        {items.map((item) => (
          <HeroRadio key={item.props.value} value={item.props.value}>
            <HeroRadio.Content>
              <HeroRadio.Control>
                <HeroRadio.Indicator />
              </HeroRadio.Control>
              <span className="flex flex-col">
                <span className="text-body">{item.props.label ?? item.props.value}</span>
                {item.props.description && (
                  <span className="text-meta text-muted">{item.props.description}</span>
                )}
              </span>
            </HeroRadio.Content>
          </HeroRadio>
        ))}
      </HeroRadioGroup>
    );
  },
});

const SwitchGroup = defineComponent({
  name: 'SwitchGroup',
  props: base.SwitchGroup.props,
  description: base.SwitchGroup.description,
  component: ({ props }) => {
    const isStreaming = useIsStreaming();
    const field = useStateField(props.name, props.value);
    const items = (props.items ?? []) as Array<{
      props: { name: string; label?: string; description?: string; defaultChecked?: boolean };
    }>;
    const stored = field.value as Record<string, boolean> | undefined;

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const label = item.props.label ?? item.props.name;
          return (
            <div key={item.props.name} className="flex items-center gap-3 py-1">
              <div className="min-w-0 flex-1">
                <div className="text-body">{label}</div>
                {item.props.description && (
                  <div className="text-meta text-muted">{item.props.description}</div>
                )}
              </div>
              <HeroSwitch
                aria-label={label}
                isSelected={stored?.[item.props.name] ?? item.props.defaultChecked ?? false}
                isDisabled={isStreaming}
                onChange={(next) => field.setValue({ ...(stored ?? {}), [item.props.name]: next })}
              >
                <HeroSwitch.Content>
                  <HeroSwitch.Control>
                    <HeroSwitch.Thumb />
                  </HeroSwitch.Control>
                  <span className="sr-only">{label}</span>
                </HeroSwitch.Content>
              </HeroSwitch>
            </div>
          );
        })}
      </div>
    );
  },
});

/** OpenUI's library with the reader-facing controls swapped for the app's own. */
export const openuiLibrary = createLibrary({
  root: baseLibrary.root,
  componentGroups: openuiComponentGroups,
  components: Object.values({
    ...base,
    Button,
    Input,
    TextArea,
    Slider,
    Select,
    CheckBoxGroup,
    RadioGroup,
    SwitchGroup,
    Table,
  }) as DefinedComponent[],
});

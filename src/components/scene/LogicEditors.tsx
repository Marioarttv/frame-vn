import { Plus, Trash2 } from "lucide-react";
import type {
  Condition,
  ConditionOperator,
  Effect,
  Variable,
  VariableValue,
} from "../../engine/types";

const NUMBER_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "==", label: "is" },
  { value: "!=", label: "is not" },
  { value: ">", label: "is more than" },
  { value: ">=", label: "is at least" },
  { value: "<", label: "is less than" },
  { value: "<=", label: "is at most" },
];
const BOOLEAN_OPERATORS = NUMBER_OPERATORS.slice(0, 2);

function ValueInput({
  variable,
  value,
  label,
  onChange,
}: {
  variable?: Variable;
  value: VariableValue;
  label: string;
  onChange: (value: VariableValue) => void;
}) {
  if (variable?.type === "boolean")
    return (
      <select
        aria-label={label}
        value={String(value === true)}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  return (
    <input
      aria-label={label}
      type="number"
      step="any"
      value={typeof value === "number" ? value : 0}
      onChange={(event) =>
        onChange(
          Number.isFinite(event.target.valueAsNumber)
            ? event.target.valueAsNumber
            : 0,
        )
      }
    />
  );
}

/** Keeps a comparison valid when the chosen variable changes type. */
function retarget<T extends { variableId: string; value: VariableValue }>(
  item: T,
  variable: Variable,
): T {
  return {
    ...item,
    variableId: variable.id,
    value: typeof item.value === variable.type ? item.value : variable.initial,
  };
}

export function ConditionsEditor({
  label,
  variables,
  conditions,
  onChange,
}: {
  label: string;
  variables: Variable[];
  conditions: Condition[];
  onChange: (conditions: Condition[]) => void;
}) {
  const update = (index: number, patch: Partial<Condition>) =>
    onChange(
      conditions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="logic-editor" role="group" aria-label={label}>
      {conditions.map((condition, index) => {
        const variable = variables.find(
          (item) => item.id === condition.variableId,
        );
        const operators =
          variable?.type === "boolean" ? BOOLEAN_OPERATORS : NUMBER_OPERATORS;
        return (
          <div className="logic-row" key={index}>
            <span className="logic-word">{index ? "and" : "if"}</span>
            <select
              aria-label={`${label} ${index + 1} variable`}
              value={condition.variableId}
              onChange={(event) => {
                const next = variables.find(
                  (item) => item.id === event.target.value,
                );
                if (!next) return;
                const moved = retarget(condition, next);
                if (
                  next.type === "boolean" &&
                  !["==", "!="].includes(moved.operator)
                )
                  moved.operator = "==";
                onChange(
                  conditions.map((item, i) => (i === index ? moved : item)),
                );
              }}
            >
              {!variable && <option value="">Missing variable</option>}
              {variables.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || "Untitled variable"}
                </option>
              ))}
            </select>
            <select
              aria-label={`${label} ${index + 1} comparison`}
              value={condition.operator}
              onChange={(event) =>
                update(index, {
                  operator: event.target.value as ConditionOperator,
                })
              }
            >
              {operators.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <ValueInput
              label={`${label} ${index + 1} value`}
              variable={variable}
              value={condition.value}
              onChange={(value) => update(index, { value })}
            />
            <button
              className="icon-button danger"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <button
        className="text-button"
        disabled={!variables.length || conditions.length >= 8}
        title={
          variables.length ? undefined : "Create a variable in Story data first"
        }
        onClick={() =>
          onChange([
            ...conditions,
            {
              variableId: variables[0].id,
              operator: "==",
              value: variables[0].initial,
            },
          ])
        }
      >
        <Plus size={12} /> Add {label.toLowerCase()}
      </button>
    </div>
  );
}

export function EffectsEditor({
  label,
  variables,
  effects,
  onChange,
}: {
  label: string;
  variables: Variable[];
  effects: Effect[];
  onChange: (effects: Effect[]) => void;
}) {
  const update = (index: number, patch: Partial<Effect>) =>
    onChange(
      effects.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <div className="logic-editor" role="group" aria-label={label}>
      {effects.map((effect, index) => {
        const variable = variables.find(
          (item) => item.id === effect.variableId,
        );
        return (
          <div className="logic-row" key={index}>
            <select
              aria-label={`${label} ${index + 1} operation`}
              value={effect.operation}
              onChange={(event) =>
                update(index, {
                  operation: event.target.value === "add" ? "add" : "set",
                })
              }
            >
              <option value="set">Set</option>
              <option value="add" disabled={variable?.type === "boolean"}>
                Add to
              </option>
            </select>
            <select
              aria-label={`${label} ${index + 1} variable`}
              value={effect.variableId}
              onChange={(event) => {
                const next = variables.find(
                  (item) => item.id === event.target.value,
                );
                if (!next) return;
                const moved = retarget(effect, next);
                if (next.type === "boolean") moved.operation = "set";
                onChange(
                  effects.map((item, i) => (i === index ? moved : item)),
                );
              }}
            >
              {!variable && <option value="">Missing variable</option>}
              {variables.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || "Untitled variable"}
                </option>
              ))}
            </select>
            <span className="logic-word">
              {effect.operation === "add" ? "by" : "to"}
            </span>
            <ValueInput
              label={`${label} ${index + 1} value`}
              variable={variable}
              value={effect.value}
              onChange={(value) => update(index, { value })}
            />
            <button
              className="icon-button danger"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(effects.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <button
        className="text-button"
        disabled={!variables.length || effects.length >= 8}
        title={
          variables.length ? undefined : "Create a variable in Story data first"
        }
        onClick={() =>
          onChange([
            ...effects,
            {
              variableId: variables[0].id,
              operation: variables[0].type === "number" ? "add" : "set",
              value: variables[0].type === "number" ? 1 : true,
            },
          ])
        }
      >
        <Plus size={12} /> Add {label.toLowerCase()}
      </button>
    </div>
  );
}

/** Drops an empty list so unchanged scenes keep their original JSON shape. */
export function optionalList<T>(list: T[]): T[] | undefined {
  return list.length ? list : undefined;
}

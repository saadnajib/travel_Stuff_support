import { COUNTRIES } from '../lib/countries';

interface Props {
  id?: string;
  name?: string;
  value: string;
  onChange: (code: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Label for the empty option; omit to force a selection. */
  placeholder?: string;
  'aria-label'?: string;
}

export function CountrySelect({ id, name, value, onChange, required, disabled, placeholder, ...rest }: Props) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      required={required}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder ?? 'Select country'}</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name} ({c.code})
        </option>
      ))}
    </select>
  );
}

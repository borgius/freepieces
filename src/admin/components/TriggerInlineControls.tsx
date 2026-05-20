// ---------------------------------------------------------------------------
// Shared inline form controls used inside TriggersPanel forms
// ---------------------------------------------------------------------------

export function InlineInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      style={{
        fontSize: '0.875rem',
        fontFamily: 'monospace',
        padding: '4px 8px',
        border: '1px solid #CBD5E0',
        borderRadius: '6px',
        background: 'white',
        width: '100%',
        outline: 'none',
      }}
    />
  );
}

export function InlineSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: '0.875rem',
        padding: '4px 8px',
        border: '1px solid #CBD5E0',
        borderRadius: '6px',
        background: 'white',
        width: '100%',
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

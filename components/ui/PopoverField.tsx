'use client';

/** Reusable labelled field row inside a detail popover */
export function PopoverField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="ui-section-label">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Reusable editable text input for popovers */
export function PopoverInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const base =
    'ui-input ' +
    className;

  if (multiline) {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ resize: 'vertical', minHeight: '72px' }}
        className={base}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={base}
    />
  );
}

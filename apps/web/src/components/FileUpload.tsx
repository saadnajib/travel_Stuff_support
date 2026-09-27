import { useId, useState } from 'react';
import { errorMessage } from '../api/client';
import { ACCEPTED_UPLOAD_TYPES, registerUpload, validateUploadFile } from '../lib/uploads';
import { Spinner } from './Loading';

export interface UploadedFile {
  ref: string;
  name: string;
  size: number;
}

interface Props {
  label: string;
  hint?: string;
  multiple?: boolean;
  imagesOnly?: boolean;
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  disabled?: boolean;
}

/** File input that hashes each file (SHA-256) in the browser and registers it via POST /uploads. */
export function FileUpload({ label, hint, multiple = false, imagesOnly = false, value, onChange, disabled }: Props) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const files = Array.from(list);
    for (const f of files) {
      const problem = validateUploadFile(f, { imagesOnly });
      if (problem) {
        setError(`${f.name}: ${problem}`);
        return;
      }
    }
    setBusy(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const f of files) {
        const res = await registerUpload(f);
        uploaded.push({ ref: res.ref, name: f.name, size: f.size });
      }
      onChange(multiple ? [...value, ...uploaded] : uploaded.slice(0, 1));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="file"
        accept={imagesOnly ? 'image/*' : ACCEPTED_UPLOAD_TYPES}
        multiple={multiple}
        disabled={disabled || busy}
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {hint && <p className="hint">{hint}</p>}
      {busy && (
        <p className="hint">
          <Spinner small /> Checksumming and uploading…
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      {value.length > 0 && (
        <ul className="file-list">
          {value.map((f) => (
            <li key={f.ref}>
              <span className="file-name">{f.name}</span>
              <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => onChange(value.filter((v) => v.ref !== f.ref))}
                disabled={disabled}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

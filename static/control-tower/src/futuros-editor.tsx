import { useState } from 'react';
import type { FuturosScenario, FuturosScenarioEdit } from '../../../src/shared/futuros';

type Props = {
  scenario: FuturosScenario & { editor: NonNullable<FuturosScenario['editor']> };
  disabled: boolean;
  onPublish: (draft: Omit<FuturosScenarioEdit, 'idempotencyKey'>) => void;
};

export function FuturosEditor({ scenario, disabled, onPublish }: Props) {
  const { editor } = scenario;
  const [name, setName] = useState(editor.mode === 'revise' ? scenario.name : '');
  const [delay, setDelay] = useState(String(editor.delayDays));
  const [validation, setValidation] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
      {editor.mode === 'clone' ? 'Clonar S0' : 'Crear una nueva revisión'}
    </button>;
  }

  return (
    <form className="futuros-editor" aria-labelledby="futuros-editor-title" onSubmit={(event) => {
      event.preventDefault();
      const normalized = name.trim();
      const delayDays = Number(delay);
      if (normalized.length < 1 || normalized.length > 120 || /\p{Cc}/u.test(normalized)) {
        setValidation('Ingresá un nombre válido de hasta 120 caracteres.');
        return;
      }
      if (!/^\d+$/.test(delay) || !Number.isInteger(delayDays) ||
          delayDays < editor.minimumDays || delayDays > editor.maximumDays) {
        setValidation(`El atraso debe ser un número entero de ${editor.minimumDays} a ${editor.maximumDays} días.`);
        return;
      }
      setValidation('');
      onPublish({ sourceScenarioId: scenario.id, expectedRevision: scenario.revision, name: normalized, delayDays });
    }} noValidate>
      <h3 id="futuros-editor-title">{editor.mode === 'clone' ? 'Nuevo escenario desde S0' : 'Nueva revisión del escenario'}</h3>
      <p>Origen {editor.source} · Corte {scenario.asOf} · Revisión de origen {scenario.revision}</p>
      <div className="futuros-settings">
        <label>Nombre del escenario<input required value={name} maxLength={120} disabled={disabled}
          onChange={(event) => setName(event.target.value)} /></label>
        <label>Atraso de A-17 en días corridos<input required type="number" value={delay} step="1"
          min={editor.minimumDays} max={editor.maximumDays} disabled={disabled} aria-describedby="futuros-delay-help"
          onChange={(event) => setDelay(event.target.value)} /></label>
      </div>
      <p id="futuros-delay-help">De {editor.minimumDays} a {editor.maximumDays} días. La revisión publicada queda disponible para ejecutar.</p>
      {validation && <p role="alert" className="message-error">{validation}</p>}
      <div className="demo-actions">
        <button type="submit" disabled={disabled}>Publicar revisión</button>
        <button type="button" disabled={disabled} onClick={() => { setOpen(false); setValidation(''); }}>Cerrar editor</button>
      </div>
    </form>
  );
}

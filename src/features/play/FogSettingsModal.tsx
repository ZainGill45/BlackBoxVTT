import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ColorControl, NumberControl } from './ToolSettingsControls';
import type { FogToolSettings } from './fogSettings';
import styles from './FogSettingsModal.module.css';

interface FogSettingsModalProps {
  color: string;
  isOpen: boolean;
  onChange: (settings: FogToolSettings) => void;
  onClearAll: () => void;
  onColorChange: (color: string) => void;
  onCoverAll: () => void;
  onDismiss: () => void;
  settings: FogToolSettings;
}

export function FogSettingsModal({
  color,
  isOpen,
  onChange,
  onClearAll,
  onColorChange,
  onCoverAll,
  onDismiss,
  settings,
}: FogSettingsModalProps) {
  const [draftColor, setDraftColor] = useState(color);

  const dismiss = () => {
    if (draftColor !== color) {
      onColorChange(draftColor);
    }
    onDismiss();
  };

  return (
    <Modal
      accessibleLabel="Fog settings"
      className={styles.modal}
      initialFocus="dialog"
      isOpen={isOpen}
      onDismiss={dismiss}
    >
      <div className={styles.content}>
        <section className={styles.section} aria-labelledby="fog-appearance-heading">
          <h2 id="fog-appearance-heading">Appearance</h2>
          <div className={styles.fields}>
            <ColorControl
              id="fog-color"
              label="Fog color"
              value={draftColor}
              onChange={setDraftColor}
            />
            <NumberControl
              id="fog-gm-opacity"
              label="GM preview opacity"
              max={100}
              min={0}
              suffix="%"
              value={Math.round(settings.gmOpacity * 100)}
              onChange={(gmOpacity) =>
                onChange({ ...settings, gmOpacity: gmOpacity / 100 })
              }
            />
          </div>
        </section>
        <section className={styles.section} aria-labelledby="fog-brush-heading">
          <h2 id="fog-brush-heading">Brush</h2>
          <div className={styles.fields}>
            <NumberControl
              id="fog-brush-width"
              label="Width"
              max={512}
              min={1}
              suffix="units"
              value={settings.brushWidth}
              onChange={(brushWidth) => onChange({ ...settings, brushWidth })}
            />
            <NumberControl
              id="fog-brush-hardness"
              label="Hardness"
              max={100}
              min={0}
              suffix="%"
              value={Math.round(settings.brushHardness * 100)}
              onChange={(brushHardness) =>
                onChange({ ...settings, brushHardness: brushHardness / 100 })
              }
            />
          </div>
        </section>
        <section className={styles.section} aria-labelledby="fog-map-heading">
          <h2 id="fog-map-heading">Entire map</h2>
          <div className={styles.actions}>
            <Button onClick={onCoverAll}>Cover map</Button>
            <Button variant="danger" onClick={onClearAll}>Clear all fog</Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

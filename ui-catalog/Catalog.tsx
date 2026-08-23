import { Settings, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button, type ButtonVariant } from '../src/components/ui/Button';
import { CanonicalLoader } from '../src/components/ui/CanonicalLoader';
import { Checkbox } from '../src/components/ui/Checkbox';
import { Collapsible } from '../src/components/ui/Collapsible';
import { ColorInput } from '../src/components/ui/ColorInput';
import { DefaultInput } from '../src/components/ui/DefaultInput';
import { Dropdown, DropdownOption } from '../src/components/ui/Dropdown';
import { FormField } from '../src/components/ui/FormField';
import { IconButton } from '../src/components/ui/IconButton';
import { IconTabs } from '../src/components/ui/IconTabs';
import { InlineInput } from '../src/components/ui/InlineInput';
import { RangeInput } from '../src/components/ui/RangeInput';
import { SearchInput } from '../src/components/ui/SearchInput';
import { Surface } from '../src/components/ui/Surface';
import { Tabs } from '../src/components/ui/Tabs';

const buttonVariants: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'danger',
  'text',
  'ghost',
  'toolbar',
  'icon',
  'embedded',
  'list',
];

const tabs = [
  { id: 'controls', label: 'Controls', panelId: 'catalog-controls' },
  { id: 'states', label: 'States', panelId: 'catalog-states' },
] as const;

const iconTabs = [
  { icon: UserRound, id: 'profile', label: 'Profile', panelId: 'catalog-profile' },
  { icon: Settings, id: 'settings', label: 'Settings', panelId: 'catalog-settings' },
] as const;

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <Surface className="catalog-section">
      <h2>{title}</h2>
      {children}
    </Surface>
  );
}

export function Catalog() {
  const [search, setSearch] = useState('Goblin');
  const [single, setSingle] = useState('Human');
  const [multiple, setMultiple] = useState(['Player']);
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('controls');
  const [iconTab, setIconTab] = useState<(typeof iconTabs)[number]['id']>('profile');
  const [color, setColor] = useState('#d6d6d6');
  const [range, setRange] = useState(40);

  const toggleRole = (role: string) => {
    setMultiple((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : [...current, role]);
  };

  return (
    <main className="catalog">
      <header className="catalog-header">
        <p>Standalone development surface · not bundled with the Electron app</p>
        <h1>BlackBox VTT controls</h1>
      </header>

      <Section title="Canonical field surface">
        <p className="catalog-note">
          These controls intentionally share height, surface, border, typography,
          hover, and focus treatment. Only alignment and interaction differ.
        </p>
        <div className="catalog-parity">
          <DefaultInput
            align="center"
            aria-label="Reference text field"
            defaultValue="Human"
          />
          <Dropdown
            accessibleLabel="Reference dropdown"
            align="center"
            label="Human"
            panelLabel="Reference options"
            showIndicator={false}
          >
            <DropdownOption label="Human" active onSelect={() => undefined} />
          </Dropdown>
        </div>
        <div className="catalog-settings-example">
          <strong>Network update rate</strong>
          <span>Updates sent to connected players each second</span>
          <DefaultInput
            aria-label="Network update rate example"
            defaultValue="60"
            inputMode="numeric"
            type="number"
          />
        </div>
      </Section>

      <Section title="DefaultInput">
        <div className="catalog-grid">
          <FormField htmlFor="catalog-name" label="Default text" showLabel>
            <DefaultInput id="catalog-name" defaultValue="Human" />
          </FormField>
          <FormField htmlFor="catalog-centered" label="Explicitly centered" showLabel>
            <DefaultInput align="center" id="catalog-centered" defaultValue="Human" />
          </FormField>
          <FormField htmlFor="catalog-number" label="Number" showLabel>
            <DefaultInput id="catalog-number" inputMode="numeric" defaultValue="0" />
          </FormField>
          <FormField htmlFor="catalog-mono" label="Compact monospace" showLabel>
            <DefaultInput density="compact" font="mono" id="catalog-mono" defaultValue="1d20 + 5" />
          </FormField>
          <FormField htmlFor="catalog-readonly" label="Read only" showLabel>
            <DefaultInput id="catalog-readonly" readOnly value="Inherited value" />
          </FormField>
          <FormField htmlFor="catalog-disabled" label="Disabled" showLabel>
            <DefaultInput disabled id="catalog-disabled" defaultValue="Unavailable" />
          </FormField>
          <FormField htmlFor="catalog-invalid" label="Invalid" showLabel>
            <DefaultInput aria-invalid id="catalog-invalid" defaultValue="Invalid value" />
          </FormField>
          <FormField htmlFor="catalog-area" label="Textarea" showLabel>
            <DefaultInput as="textarea" id="catalog-area" rows={3} defaultValue="A multiline description." />
          </FormField>
        </div>
      </Section>

      <Section title="InlineInput and search">
        <div className="catalog-grid">
          <div>
            <span className="catalog-label">Content-sized pair</span>
            <div className="catalog-inline-pair">
              <InlineInput align="right" aria-label="Current" sizing="content" value="0" readOnly />
              <span aria-hidden>/</span>
              <InlineInput align="right" aria-label="Maximum" sizing="content" value="0" readOnly />
            </div>
          </div>
          <FormField htmlFor="catalog-inline" label="Fill-sized inline editor" showLabel>
            <InlineInput
              defaultValue="Borderless dense editor"
              id="catalog-inline"
              surface="borderless"
            />
          </FormField>
          <FormField htmlFor="catalog-inline-compact" label="Compact underlined editor" showLabel>
            <InlineInput
              defaultValue="Aligned editor"
              density="compact"
              id="catalog-inline-compact"
              surface="underline"
            />
          </FormField>
          <SearchInput label="Search catalog" value={search} onChange={setSearch} />
        </div>
      </Section>

      <Section title="Dropdown">
        <div className="catalog-grid">
          <Dropdown accessibleLabel="Species" label={single} panelLabel="Species options">
            {['Human', 'Elf', 'Dwarf'].map((option) => (
              <DropdownOption
                active={single === option}
                key={option}
                label={option}
                onSelect={() => setSingle(option)}
              />
            ))}
          </Dropdown>
          <Dropdown
            accessibleLabel="Roles"
            label={multiple.length ? multiple.join(', ') : 'No roles'}
            mode="multiple"
            panelLabel="Role options"
          >
            {['Player', 'Game Master'].map((option) => (
              <DropdownOption
                active={multiple.includes(option)}
                key={option}
                label={option}
                onSelect={() => toggleRole(option)}
              />
            ))}
          </Dropdown>
          <Dropdown accessibleLabel="Add entry" label="Add" mode="action" panelLabel="Entry actions">
            <DropdownOption label="Add Note" onSelect={() => undefined} />
            <DropdownOption label="Add Character" onSelect={() => undefined} />
          </Dropdown>
          <Dropdown disabled label="Disabled dropdown">
            <DropdownOption label="Unavailable" onSelect={() => undefined} />
          </Dropdown>
          <div className="catalog-inline-dropdown-example">
            <Dropdown
              accessibleLabel="Inline ability"
              align="center"
              density="inline"
              height="fill"
              label="DEX"
              panelLabel="Inline ability options"
              showIndicator={false}
              surface="borderless"
              tone="muted"
            >
              <DropdownOption active label="Dexterity" onSelect={() => undefined} />
            </Dropdown>
            <span>Inline ability selector</span>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="catalog-row">
          {buttonVariants.map((variant) => (
            <Button key={variant} variant={variant}>{variant}</Button>
          ))}
          <Button disabled>Disabled</Button>
          <Button size="compact">Compact</Button>
          <IconButton icon={Settings} label="Settings" />
          <IconButton active icon={UserRound} label="Active profile" />
        </div>
        <div className="catalog-button-layouts">
          <Button align="left">Left aligned</Button>
          <Button>Centered</Button>
          <Button align="right">Right aligned</Button>
          <Button align="left" layout="spread">
            <span>Spread</span>
            <span>content</span>
          </Button>
          <Button align="left" layout="stack">
            <strong>Stacked content</strong>
            <span>Secondary line</span>
          </Button>
        </div>
      </Section>

      <Section title="Choice and authored-value controls">
        <div className="catalog-row">
          <Checkbox defaultChecked>Checked</Checkbox>
          <Checkbox>Unchecked</Checkbox>
          <Checkbox indeterminate>Mixed</Checkbox>
          <Checkbox disabled>Disabled</Checkbox>
          <label className="catalog-range">
            Range: {range}
            <RangeInput value={range} onChange={(event) => setRange(event.currentTarget.valueAsNumber)} />
          </label>
          <label className="catalog-color" style={{ backgroundColor: color }}>
            Color
            <ColorInput value={color} onChange={(event) => setColor(event.currentTarget.value)} />
          </label>
        </div>
      </Section>

      <Section title="Composite controls">
        <div className="catalog-stack">
          <Tabs activeId={tab} ariaLabel="Catalog tabs" items={tabs} onChange={setTab} />
          <div aria-labelledby={`catalog-${tab}-tab`} id={`catalog-${tab}`} role="tabpanel">
            {tab === 'controls' ? 'Controls panel' : 'States panel'}
          </div>
          <IconTabs activeId={iconTab} ariaLabel="Catalog icon tabs" items={iconTabs} onChange={setIconTab} />
          <Collapsible label="Expandable section">
            This content is owned by the shared collapsible component.
          </Collapsible>
          <CanonicalLoader completedItems={3} label="Catalog loading example" totalItems={5} />
        </div>
      </Section>
    </main>
  );
}

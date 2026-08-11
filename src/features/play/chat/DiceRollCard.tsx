import { Fragment, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import {
  classifyRollOutcome,
  classifyRollResultOutcome,
  type ChatRollCard,
  type ChatRollConditionalSectionResult,
  type ChatRollDefinition,
  type ChatRollDieNode,
  type ChatRollExpressionNode,
  type ChatRollOrdinarySectionResult,
} from '../../../shared/chatRoll';
import styles from './ChatPanel.module.css';

type DieShape = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'generic';

function recognizedShape(node: ChatRollDieNode): DieShape | null {
  if (node.dieKind === 'fudge') return 'd6';
  if (node.dieKind === 'percentile') return 'd10';
  if (typeof node.sides !== 'number') return null;
  return ([4, 6, 8, 10, 12, 20] as const).includes(
    node.sides as 4 | 6 | 8 | 10 | 12 | 20,
  )
    ? (`d${node.sides}` as DieShape)
    : null;
}

function sectionShape(nodes: readonly ChatRollExpressionNode[]): DieShape {
  let shape: DieShape | null = null;
  const visit = (node: ChatRollExpressionNode) => {
    if (shape) return;
    if (node.kind === 'die') shape = recognizedShape(node);
    if (node.kind === 'group') node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return shape ?? 'generic';
}

function Shape({ shape }: { shape: DieShape }) {
  if (shape === 'd4') {
    return <path d="M32 6 58 55H6L32 6Zm0 0v49M6 55l26-18 26 18" />;
  }
  if (shape === 'd6') {
    return (
      <>
        <path d="M32 4 56 18v28L32 60 8 46V18L32 4Z" />
        <path d="M32 4v28m24-14L32 32 8 18m24 14v28" fill="none" />
      </>
    );
  }
  if (shape === 'd8') {
    return <path d="M32 4 58 32 32 60 6 32 32 4Zm0 0v56M6 32h52M32 4 18 32l14 28 14-28L32 4Z" />;
  }
  if (shape === 'd10') {
    return <path d="m32 4 20 10 7 24-13 20H18L5 38l7-24L32 4Zm0 0-9 30 9 24 9-24-9-30ZM5 38l18-4m36 4-18-4M12 14l11 20m29-20L41 34" />;
  }
  if (shape === 'd12') {
    return <path d="m32 4 18 7 10 16-3 20-16 13H23L7 47 4 27l10-16 18-7Zm0 0v18m18-11-18 11-18-11m18 11 14 12-5 26M32 22 18 34l5 26M4 27l14 7L7 47m53-20-14 7 11 13M18 34h28" />;
  }
  if (shape === 'd20') {
    return <path d="m32 3 18 7 11 17-4 21-16 13H23L7 48 3 27l11-17 18-7Zm0 0-9 19h18L32 3Zm-9 19L7 48l25-11L23 22Zm18 0 16 26-25-11 9-15ZM7 48h50M14 10l9 12M50 10l-9 12M23 61l9-24 9 24" />;
  }
  return <path d="m32 4 20 8 9 20-9 20-20 8-20-8-9-20 9-20 20-8Zm0 0v56M3 32h58M12 12l40 40M52 12 12 52" />;
}

type RolledSection =
  | ChatRollOrdinarySectionResult
  | ChatRollConditionalSectionResult;

function DiceTotalIcon({ section }: { section: RolledSection }) {
  const total = String(section.total);
  const size = Math.max(11, 27 - Math.max(0, total.length - 2) * 2.4);
  return (
    <svg
      aria-label={`Total ${total}`}
      className={styles.diceTotal}
      data-shape={sectionShape(section.expression)}
      role="img"
      viewBox="0 0 64 64"
    >
      <g className={styles.diceGeometry}>
        <Shape shape={sectionShape(section.expression)} />
      </g>
      <text
        className={styles.diceTotalText}
        dominantBaseline="central"
        fontSize={size}
        lengthAdjust={total.length > 4 ? 'spacingAndGlyphs' : undefined}
        textAnchor="middle"
        textLength={total.length > 4 ? 48 : undefined}
        x="32"
        y="34"
      >
        {total}
      </text>
    </svg>
  );
}

const flagSymbols: Record<string, string> = {
  compound: '!!',
  'critical-failure': 'crit-fail',
  'critical-success': 'crit',
  drop: 'drop',
  explode: '!',
  max: 'max',
  min: 'min',
  penetrate: 'p',
  're-roll': 'reroll',
  're-roll-once': 'reroll-once',
  'target-failure': 'fail',
  'target-success': 'success',
  unique: 'unique',
  'unique-once': 'unique-once',
};

function Flags({ values }: { values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <small className={styles.rollFlags}>
      {values.map((value) => flagSymbols[value] ?? value).join(' · ')}
    </small>
  );
}

function Expression({
  included = true,
  nodes,
}: {
  included?: boolean;
  nodes: readonly ChatRollExpressionNode[];
}) {
  const children: ReactNode[] = [];
  nodes.forEach((node, index) => {
    if (node.kind === 'die') {
      children.push(
        <span className={styles.rollBadge} key={index}>
          <b>{node.notation}</b>
          <span aria-label="Individual die results">
            {' ['}
            {node.results.map((result, resultIndex) => {
              const resultIncluded = included && result.useInTotal;
              return (
                <Fragment key={resultIndex}>
                  {resultIndex > 0 ? ', ' : null}
                  <span
                    className={styles.rollResult}
                    data-included={resultIncluded}
                    data-outcome={classifyRollResultOutcome(
                      node,
                      result,
                      included,
                    )}
                  >
                    {result.value}
                    <Flags values={result.modifiers} />
                  </span>
                </Fragment>
              );
            })}
            {']'}
          </span>
        </span>,
      );
      return;
    }
    if (node.kind === 'group') {
      children.push(
        <span
          className={`${styles.rollGroup} ${styles.rollBadge}`}
          data-included={included && node.useInTotal}
          key={index}
        >
          (
          <Expression
            included={included && node.useInTotal}
            nodes={node.children}
          />
          )
          <Flags values={node.modifiers} />
        </span>,
      );
      return;
    }
    children.push(
      <span className={`${styles.rollToken} ${styles.rollBadge}`} key={index}>
        {node.value}
      </span>,
    );
  });
  return <>{children}</>;
}

function RollAudit({ section }: { section: RolledSection }) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <Button
        aria-label={`Show rolls for ${section.label}`}
        className={styles.rollAuditReveal}
        onClick={() => setRevealed(true)}
        size="compact"
      >
        Show Rolls
      </Button>
    );
  }

  return (
    <div className={styles.rollEquation}>
      {section.modifiers.length > 0 ? <span>(</span> : null}
      <Expression nodes={section.expression} />
      {section.modifiers.length > 0 ? <span>)</span> : null}
      {section.modifiers.map((modifier, modifierIndex) => (
        <span className={styles.rollBadge} key={modifierIndex}>
          <b>{modifier.label}</b>{' '}
          {modifier.value >= 0 ? '+' : ''}{modifier.value}
        </span>
      ))}
    </div>
  );
}

export function DiceRollCard({ card }: { card: ChatRollCard }) {
  return (
    <div className={styles.rollContent}>
      <div className={styles.rollCommand}>
        <span>{card.category.toLocaleUpperCase()}</span>
        <strong>/R</strong>
      </div>
      {card.title ? (
        <h3 className={styles.rollTitle}>{card.title} - Roll</h3>
      ) : null}
      <div className={styles.rollSections}>
        {card.sections.map((section, index) => {
          if ('kind' in section && section.kind !== 'conditional-roll') {
            const content = section.kind === 'prompt'
              ? `${section.value}${section.detail ? ` — ${section.detail}` : ''}`
              : section.text;
            return (
              <section
                className={styles.rollSection}
                data-outcome="neutral"
                data-static="true"
                key={`${section.label}:${index}`}
              >
                <div className={styles.rollSectionBody}>
                  <div className={styles.rollSectionHeading}>
                    <strong className={styles.rollBadge}>
                      {section.label.toLocaleUpperCase()}
                    </strong>
                  </div>
                  <p className={styles.rollStaticText}>{content}</p>
                </div>
              </section>
            );
          }
          return (
            <section
              className={styles.rollSection}
              data-outcome={classifyRollOutcome(section.expression)}
              key={`${section.label}:${index}`}
            >
              <div className={styles.rollSectionBody}>
                <div className={styles.rollSectionHeading}>
                  <strong className={styles.rollBadge}>
                    {section.label.toLocaleUpperCase()}
                  </strong>
                  {section.typeLabel ? <span>{section.typeLabel}</span> : null}
                </div>
                {'kind' in section && section.usedAlternate ? (
                  <small className={styles.rollCritical}>Critical damage</small>
                ) : null}
                <RollAudit section={section} />
              </div>
              <div className={styles.rollTotalCell}>
                <DiceTotalIcon section={section} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function PendingDiceRollCard({
  definition,
}: {
  definition: ChatRollDefinition;
}) {
  return (
    <div className={styles.rollContent}>
      <div className={styles.rollCommand}>
        <span>{definition.category.toLocaleUpperCase()}</span>
        <strong>/R</strong>
      </div>
      {definition.title ? (
        <h3 className={styles.rollTitle}>{definition.title} - Roll</h3>
      ) : null}
      <div className={styles.rollSections}>
        {definition.sections.map((section, index) => {
          if ('kind' in section && section.kind !== 'conditional-roll') {
            const content = section.kind === 'prompt'
              ? `${section.value}${section.detail ? ` — ${section.detail}` : ''}`
              : section.text;
            return (
              <section
                className={styles.rollSection}
                data-outcome="neutral"
                data-static="true"
                key={index}
              >
                <div className={styles.rollSectionBody}>
                  <div className={styles.rollSectionHeading}>
                    <strong className={styles.rollBadge}>
                      {section.label.toLocaleUpperCase()}
                    </strong>
                  </div>
                  <p className={styles.rollStaticText}>{content}</p>
                </div>
              </section>
            );
          }
          return (
          <section className={styles.rollSection} data-outcome="neutral" key={index}>
            <div className={styles.rollSectionBody}>
              <div className={styles.rollSectionHeading}>
                <strong className={styles.rollBadge}>
                  {section.label.toLocaleUpperCase()}
                </strong>
                {section.typeLabel ? <span>{section.typeLabel}</span> : null}
              </div>
              <div className={styles.rollEquation}>
                <span className={styles.rollBadge}>{section.notation}</span>
                {section.modifiers.map((modifier, modifierIndex) => (
                  <span className={styles.rollBadge} key={modifierIndex}>
                    <b>{modifier.label}</b>{' '}
                    {modifier.value >= 0 ? '+' : ''}{modifier.value}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.rollPendingTotal} aria-label="Roll pending">…</div>
          </section>
          );
        })}
      </div>
    </div>
  );
}

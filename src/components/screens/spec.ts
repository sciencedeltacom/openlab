/**
 * Screen specifications.
 *
 * Fifty surfaces do not need fifty bespoke components. They need four shapes — a form of
 * settings, a catalogue of things, a document, and a table of records — plus a handful of
 * genuinely interactive screens (the tracker, the workbench) that earn their own code.
 *
 * So a screen is *data*: which shape it is, and what it contains. The renderers in
 * `archetypes.tsx` turn a spec into UI, and the design stays consistent because there is
 * one implementation of "a settings section" rather than fifty.
 *
 * This file is the contract. Renderers and specs both import from it and nothing else.
 */

import type { ReactNode } from 'react';

/* ================================================================================================
 * Settings
 * ============================================================================================== */

/**
 * The control a settings field renders.
 *
 * `reference` marks a field the runtime does not enforce: it is stored and sent to the model as
 * a standing preference, and the page says so rather than drawing a control that looks like a
 * rule. The limits the engine does hold are in `lib/agent/policy`.
 */
type FieldKind =
  | { kind: 'text'; label: string; hint?: string; value?: string; placeholder?: string }
  | { kind: 'password'; label: string; hint?: string; placeholder?: string; stored?: boolean }
  | {
      kind: 'textarea';
      label: string;
      hint?: string;
      value?: string;
      rows?: number;
      placeholder?: string;
      mono?: boolean;
    }
  | {
      kind: 'number';
      label: string;
      hint?: string;
      value: number;
      suffix?: string;
      min?: number;
      max?: number;
    }
  | {
      kind: 'slider';
      label: string;
      hint?: string;
      value: number;
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | {
      kind: 'select';
      label: string;
      hint?: string;
      value: string;
      options: { value: string; label: string }[];
      /**
       * The store setting this field edits.
       *
       * A spec is static data and a store is live, so a field that is really the user's names
       * the setting it stands for and the settings screen renders a control bound to it.
       * Without it the field is reference: a description of how openlab is meant to behave.
       */
      setting?: LiveSetting;
    }
  | { kind: 'switch'; label: string; hint?: string; value: boolean }
  | {
      kind: 'radio';
      label: string;
      hint?: string;
      value: string;
      options: { value: string; label: string; hint?: string }[];
    }
  | { kind: 'tags'; label: string; hint?: string; values: string[]; placeholder?: string }
  | { kind: 'rows'; label: string; hint?: string; columns: string[]; rows: string[][] };

/** One settings control, with the marker for a preference the runtime does not read. */
export type Field = FieldKind & { reference?: boolean };

/**
 * The store settings a settings field can stand for.
 *
 * Deliberately a short list: each one is a choice the workbench actually reads, and adding a
 * name here is the whole wiring — the screen renders the control, the reducer already owns it.
 */
export type LiveSetting = 'theme' | 'navMode';

/** A titled block of fields. */
export interface SettingsSection {
  id: string;
  title: string;
  fields: Field[];
}

/** A form-shaped screen. */
export interface SettingsScreenSpec {
  kind: 'settings';
  sections: SettingsSection[];
  /** A right-hand column of facts. */
  aside?: { title: string; items: { label: string; value: string }[] }[];
}

/* ================================================================================================
 * Catalogue
 * ============================================================================================== */

/** How ready an entry is to be used. */
export type EntryTone = 'ok' | 'warn' | 'muted' | 'danger';

/** One thing in a catalogue: a tool, a database, a connector, a skill, a model. */
export interface CatalogEntry {
  id: string;
  name: string;
  /** A simpleicons slug for its brand mark, when one exists. */
  icon?: string;
  summary: string;
  /** Facet this entry is filed under. */
  group: string;
  tags?: string[];
  status?: { label: string; tone: EntryTone };
  /** Small facts shown as chips. */
  meta?: string[];
  /** Documentation link. */
  href?: string;
  /** Anything the renderer should show in the entry's footer, e.g. a switch. */
  footer?: ReactNode;
  /**
   * Facts only the record page shows.
   *
   * The card carries what a reader scans in a list; the page carries what they came for. A
   * section that has nothing extra to say can leave this empty — the page still renders the
   * entry's own fields, which is what makes it linkable.
   */
  detail?: { label: string; value: ReactNode }[];
}

/** A browsable grid of things. */
export interface CatalogScreenSpec {
  kind: 'catalog';
  entries: CatalogEntry[];
  /** Facet label, e.g. "Domain" or "Kind". */
  facetLabel?: string;
  columns?: 2 | 3;
  /** Shown above the grid. */
  actions?: ReactNode;
  /** Shown when the catalogue is empty. */
  empty?: string;
  /**
   * Set when each entry has a page of its own.
   *
   * The record renderer finds the entry by id in this same spec, so the list and its records
   * cannot drift: there is one source of truth and the page is a view of it.
   */
  records?: { noun: string };
}

/* ================================================================================================
 * Document
 * ============================================================================================== */

/** A section of prose, steps, code, cards, or a table. */
export interface DocSection {
  id: string;
  title: string;
  body?: string[];
  bullets?: string[];
  steps?: { title: string; body: string }[];
  code?: { language: string; source: string };
  cards?: { title: string; body: string; tone?: 'default' | 'accent' | 'warning' | 'danger' }[];
  table?: { columns: string[]; rows: string[][] };
}

/** A prose screen: a guide, a reference, a help page. */
export interface DocScreenSpec {
  kind: 'doc';
  sections: DocSection[];
  aside?: { title: string; items: { label: string; value: string }[] }[];
}

/* ================================================================================================
 * Data
 * ============================================================================================== */

/** A table of records. */
export interface DataScreenSpec {
  kind: 'data';
  columns: { key: string; label: string; align?: 'start' | 'end'; mono?: boolean; width?: string }[];
  rows: Record<string, ReactNode>[];
  stats?: { label: string; value: string }[];
  pageSize?: number;
  /** Actions shown above the grid. */
  actions?: ReactNode;
  /** Which column identifies a row, for its record page. Defaults to `id`. */
  recordKey?: string;
  /** Set when each row has a page of its own. */
  records?: { noun: string };
}

/* ================================================================================================
 * Overview
 *
 * The landing shape, and the one with a budget.
 *
 * An overview answers "what is the state of this" in one screen, and the failure mode is
 * obvious the moment you look at one: a wall of prose and a table nobody reads. So the spec
 * is deliberately narrow — a sentence, a handful of numbers, a few cards that carry a chart
 * or a short list, and somewhere to go next.
 *
 * The rule of thumb, enforced by the renderer's layout rather than by good intentions:
 * **four stats, three cards.** If a fact needs a paragraph, it belongs on a section page, and
 * the overview should link to it instead.
 * ============================================================================================== */

/** A headline number. */
export interface Stat {
  label: string;
  value: string;
  /** A qualifier, e.g. "of 132" or "last 30 days". */
  note?: string;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  /** Where the number comes from, for a reader who wants to check it. */
  href?: string;
}

/** A card on an overview. The body is already-built content: a chart, a list, a figure. */
export interface OverviewCard {
  id: string;
  title: string;
  /** A headline value for the card, shown next to the title. */
  value?: string;
  /** How much of the row the card takes. Three cards of `1` fill a row. */
  span?: 1 | 2 | 3;
  /** A one-line note under the card. */
  note?: string;
  body: ReactNode;
}

/** A landing page. */
export interface OverviewScreenSpec {
  kind: 'overview';
  /** Up to four. More than four is a table, not an overview. */
  stats: Stat[];
  /** Up to three or four. */
  cards: OverviewCard[];
  /** Somewhere to go next, rendered as a short list of links. */
  next?: { label: string; to: string; hint?: string }[];
}

/** Everything a screen can be. */
export type ScreenSpec =
  SettingsScreenSpec | CatalogScreenSpec | DocScreenSpec | DataScreenSpec | OverviewScreenSpec;

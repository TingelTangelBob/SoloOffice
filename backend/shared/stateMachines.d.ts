export type StateMachineName =
  | 'invoice' | 'creditNote' | 'quote' | 'job'
  | 'recurringInvoice' | 'recurringInvoiceRun'
  | 'recurringExpense' | 'recurringExpenseRun'
  | 'importRun' | 'migrationSession' | 'migrationCategory'
  | 'receiptOcr' | 'euerEntry' | 'fixedAsset' | 'incomingEInvoice'
  | 'emailLog' | 'supportTicket';

export type StateTone =
  | 'neutral' | 'primary' | 'success' | 'progress'
  | 'warning' | 'warningStrong' | 'danger' | 'dangerStrong' | 'settled';

/** manual: Nutzer wählt den Status; action: eigene Aktion; automatic: vom System abgeleitet. */
export type TransitionTrigger = 'manual' | 'action' | 'automatic';

export interface StateDefinition {
  label: string;
  tone: StateTone;
}

export interface StateTransition {
  from: string;
  to: string;
  trigger: TransitionTrigger;
  label: string;
  guard?: string;
}

export interface StateMachineDefinition {
  label: string;
  /** workflow: echte Übergänge; log: unveränderlicher Protokollwert; external: Bestand liegt außerhalb. */
  kind: 'workflow' | 'log' | 'external';
  db: { table: string; column: string } | null;
  tsType: string | null;
  initial: string | null;
  states: Record<string, StateDefinition>;
  transitions: StateTransition[];
  notes: string[];
}

export interface ManualTransitionProblem {
  code: 'unknown_state' | 'terminal_state' | 'action_required' | 'not_allowed';
  message: string;
}

export declare const STATE_MACHINES: Record<StateMachineName, StateMachineDefinition>;
export declare const STATE_TONES: StateTone[];
export declare function statesOf(name: StateMachineName): string[];
export declare function isKnownState(name: StateMachineName, state: unknown): state is string;
export declare function stateLabel(name: StateMachineName, state: unknown, fallback?: string): string;
export declare function stateTone(name: StateMachineName, state: unknown): StateTone;
export declare function transitionsFrom(name: StateMachineName, from: string, triggers?: TransitionTrigger[]): StateTransition[];
export declare function canTransition(name: StateMachineName, from: string, to: string, triggers?: TransitionTrigger[]): boolean;
export declare function manualTargets(name: StateMachineName, from: string): string[];
export declare function manualTargetsForSelection(name: StateMachineName, fromStates: string[]): string[];
export declare function isTerminal(name: StateMachineName, state: string): boolean;
export declare function checkManualTransition(name: StateMachineName, from: string, to: unknown): ManualTransitionProblem | null;

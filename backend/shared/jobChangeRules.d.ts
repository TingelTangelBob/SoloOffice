export interface JobChangeProblem {
  status: number;
  error: string;
  message: string;
}

export interface JobBulkDeleteProblem extends JobChangeProblem {
  invoicedJobIds: string[];
}

export declare const JOB_INVOICED_STATUS: 'invoiced';
/** null: erlaubt. Sonst HTTP-Status plus Meldung. */
export declare function jobEditProblem(currentStatus: string): JobChangeProblem | null;
export declare function jobDeleteProblem(currentStatus: string): JobChangeProblem | null;
export declare function jobBulkDeleteProblem(jobs: Array<{ id: string; status: string }>): JobBulkDeleteProblem | null;

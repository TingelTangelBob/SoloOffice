import type { Dispatch, SetStateAction } from 'react';
import type { Company } from '../../types';
import type { TerminologyDefinition } from '../../utils/terminology';

/** Gemeinsame Props der Bereiche, die das Firmenformular bearbeiten. */
export interface CompanySettingsAreaProps {
  formData: Company;
  setFormData: Dispatch<SetStateAction<Company>>;
  terminology: TerminologyDefinition;
}

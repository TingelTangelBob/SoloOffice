/** PostgreSQL meldet den atomaren Workspace-Claim über die Unique-Constraint. */
export function isTakeoverAlreadyUsedError(error) {
  return error?.code === '23505';
}

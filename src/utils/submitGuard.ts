/** Blockiert weitere Speicheraktionen bereits vor dem nächsten React-Render. */
export function createSubmitGuard(onPendingChange: (pending: boolean) => void) {
  let pending = false;
  return {
    async run(action: () => Promise<void>): Promise<void> {
      if (pending) return;
      pending = true;
      onPendingChange(true);
      try {
        await action();
      } finally {
        pending = false;
        onPendingChange(false);
      }
    },
  };
}

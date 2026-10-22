export type StatePatch<T> = Partial<T> | ((current: T) => Partial<T>);

/** Berechnet jeden Patch erst nach der vorherigen bestätigten Speicherung. */
export function createSerialStateWriter<T>(options: {
  current: () => T;
  save: (patch: Partial<T>) => Promise<T>;
  commit: (saved: T) => void;
  active?: () => boolean;
}) {
  let tail: Promise<void> = Promise.resolve();
  return (patch: StatePatch<T>): Promise<void> => {
    const write = tail.then(async () => {
      if (options.active && !options.active()) throw new Error('Der Arbeitsbereich wurde verlassen.');
      const changes = typeof patch === 'function' ? patch(options.current()) : patch;
      const saved = await options.save(changes);
      if (!options.active || options.active()) options.commit(saved);
    });
    // Ein fehlgeschlagener Vorgang darf spätere Korrekturen nicht blockieren.
    tail = write.catch(() => undefined);
    return write;
  };
}

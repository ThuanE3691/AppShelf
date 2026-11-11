/** A sleep that `wake()` ends early, so shutdown does not wait out a poll interval. */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
  wake(): void;
}

export function interruptibleSleep(): Sleeper {
  const pending = new Set<() => void>();
  return {
    sleep(ms) {
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          pending.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        pending.add(done);
      });
    },
    wake() {
      for (const done of [...pending]) done();
    },
  };
}

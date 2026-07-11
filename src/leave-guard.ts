export type LeaveChoice = "save-and-leave" | "discard-and-leave" | "cancel";

export interface LeaveGuardOptions {
  isDirty(): boolean;
  choose(): Promise<LeaveChoice>;
  save(): Promise<boolean>;
}

async function saveUntilClean(options: LeaveGuardOptions): Promise<boolean> {
  if (!await options.save()) return false;
  if (!options.isDirty()) return true;
  if (!await options.save()) return false;
  return !options.isDirty();
}

export async function guardLeave(options: LeaveGuardOptions): Promise<boolean> {
  if (!options.isDirty()) {
    return true;
  }

  const choice = await options.choose();
  if (choice === "cancel") {
    return false;
  }
  if (choice === "discard-and-leave") {
    return true;
  }
  return saveUntilClean(options);
}

export class LeaveCoordinator {
  private pending: Promise<boolean> | null = null;
  private readonly options: LeaveGuardOptions;

  constructor(options: LeaveGuardOptions) {
    this.options = options;
  }

  run(): Promise<boolean> {
    if (this.pending) return this.pending;

    this.pending = guardLeave(this.options).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

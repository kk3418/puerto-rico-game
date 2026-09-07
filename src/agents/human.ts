import type { Action } from "../engine/types";
import type { PlayerAgent } from "./types";

export class HumanAgent implements PlayerAgent {
  private resolve: ((action: Action) => void) | null = null;
  private reject: ((error: Error) => void) | null = null;

  chooseAction(): Promise<Action> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  submit(action: Action): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.reject = null;
    if (!resolve) {
      throw new Error("現在不是你的行動");
    }
    resolve(action);
  }

  cancel(): void {
    const reject = this.reject;
    this.resolve = null;
    this.reject = null;
    reject?.(new Error("cancelled"));
  }

  get waiting(): boolean {
    return this.resolve !== null;
  }
}

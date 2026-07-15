/**
 * Test-only `ProviderAdapter` implementation (architecture-update.md R4;
 * ticket 004 AC3). Not a production-selectable provider option -- its
 * entire purpose is to be the second implementation of the exact same
 * `ProviderAdapter` interface `anthropic.ts` implements, so a test can
 * drive one scripted tool-use exchange through both adapters and prove
 * the D10 "swap is contained to the adapter" claim is real, not just
 * documented.
 *
 * Makes no network call and reads no `ANTHROPIC_API_KEY` -- it returns
 * exactly the scripted/canned response sequence supplied at construction,
 * one entry per `sendTurn` call, so each test controls its own script.
 */
import type { ProviderAdapter, ProviderTurnInput, ProviderTurnResult } from './types';

/** The scripted sequence of turn results a mock adapter returns, one per
 * `sendTurn` call, in order. */
export type MockProviderScript = ProviderTurnResult[];

/** Optional hook for tests that want to assert on what `sendTurn` was
 * called with (e.g. to check the turn controller shaped `toolResults`
 * correctly before the next call), without the mock adapter needing any
 * awareness of `ChatMessage`/`Lock`/Prisma itself. */
export interface MockAdapterOptions {
  onSendTurn?: (input: ProviderTurnInput) => void;
}

/** Creates a `ProviderAdapter` that returns `script[0]` on the first
 * `sendTurn` call, `script[1]` on the second, and so on. Throws if
 * called more times than the script has entries -- a test bug (an
 * under-specified script), not a real "provider" error, so it fails loud
 * rather than returning something misleading. */
export function createMockAdapter(script: MockProviderScript, options: MockAdapterOptions = {}): ProviderAdapter {
  let step = 0;

  return {
    async sendTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> {
      options.onSendTurn?.(input);

      if (step >= script.length) {
        throw new Error(
          `MockAdapter: sendTurn called ${step + 1} times but the script only has ${script.length} entries -- extend the script for this test.`
        );
      }

      const result = script[step];
      step += 1;
      return result;
    },
  };
}

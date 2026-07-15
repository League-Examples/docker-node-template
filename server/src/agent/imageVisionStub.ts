/**
 * Stub `ImageVisionClient` interface (architecture-001 §Module 9, Image &
 * Vision Service -- explicitly Out of Scope this sprint per sprint.md;
 * this ticket's AC8).
 *
 * The Agent Runtime's turn controller (`turn.ts`) routes any
 * image-generation step in the loop through this interface instead of a
 * real OpenAI/OpenRouter API call. Sprint 004 ticket 002 built the real
 * implementation of this exact interface at `./realImageVisionClient.ts`
 * (`createRealImageVisionClient`, backed by ticket 004-001's `services/
 * imaging.ts`), wired into production in `routes/chat.ts` -- `turn.ts`'s
 * call site (`imageVisionClient.generateImage(...)`) did not change. This
 * stub remains in place, unmodified, as `runTurn`'s default `Image
 * VisionClient` when no client is injected (every test continues to get
 * it, or an explicit mock/the real client, exactly as before).
 */

export interface GenerateImageInput {
  /** The prompt text describing the desired image. */
  prompt: string;
  projectId: number;
  /** Free-form model parameters (size, style, etc.) -- passed through
   * unmodified; the stub does not interpret them. */
  modelParams?: unknown;
}

export interface GenerateImageResult {
  /** Workspace-relative path a real implementation would write the
   * generated image to. The stub never writes a file -- this is a
   * deterministic placeholder value only. */
  imagePath: string;
  modelParams?: unknown;
}

/** The seam Sprint 004 implements for real. Deliberately minimal --
 * exactly the one operation `turn.ts` currently needs to call. */
export interface ImageVisionClient {
  generateImage(input: GenerateImageInput): Promise<GenerateImageResult>;
}

/**
 * Test/dev-only stub implementation: returns a deterministic placeholder
 * result, makes no network call, reads no API key. This is the default
 * `ImageVisionClient` `turn.ts` uses until Sprint 004 replaces it.
 */
export function createStubImageVisionClient(): ImageVisionClient {
  return {
    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      return {
        imagePath: `projects/${input.projectId}/outputs/stub-image-${Date.now()}.png`,
        modelParams: input.modelParams,
      };
    },
  };
}

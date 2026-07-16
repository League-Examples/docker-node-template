import fs from 'fs/promises';
import path from 'path';
import { prisma as defaultPrisma } from '../services/prisma';
import { resolveWorkspacePath } from '../services/workspaceDirectorySync';
import { versioningService as defaultVersioningService } from '../services/versioning';
import {
  generateImage as imagingGenerateImage,
  type GenerateImageInput as ImagingGenerateImageInput,
  type GenerateImageResult as ImagingGenerateImageResult,
  type ImageSize,
  type ImagingCallOptions,
} from '../services/imaging';
import { createIteration } from '../agent-mcp/catalogTools';
import type { VersioningRecorder } from '../agent-mcp/fsTools';
import type { ImageVisionClient, GenerateImageInput, GenerateImageResult } from './imageVisionStub';

/**
 * Real `ImageVisionClient` implementation (ticket 004-002; completes the
 * `image-generation-service.md` issue). The `ImageVisionClient` seam
 * `imageVisionStub.ts` describes, implemented for real against ticket
 * 004-001's `services/imaging.ts` -- `turn.ts`'s `dispatchToolCall` call
 * site (`imageVisionClient.generateImage({ prompt, projectId,
 * modelParams })`) is unchanged; only what runs behind it changes.
 *
 * **Flow**: `imaging.generateImage` (OpenAI direct) -> write the returned
 * bytes to `projects/<id>/iterations/iter-<seq>.png` under the workspace
 * root, resolved via `resolveWorkspacePath` (the same path-containment
 * mechanism `agent-mcp/catalogTools.ts` uses) -> call the existing
 * `create_iteration` Workspace MCP Server tool (`catalogTools
 * .createIteration`, unchanged) to record the `Iteration` row.
 *
 * **Sequence-number / locking note**: `create_iteration` acquires its own
 * `directory` lock on `projects/<id>` internally, so this module must not
 * hold that same lock itself around the call (the `Lock` table's unique
 * constraint would reject the second acquisition). Instead this module
 * reads the next `seq` up front (a plain, unlocked query -- safe because
 * every caller of `ImageVisionClient.generateImage` reaches it through
 * `turn.ts`'s `dispatchToolCall`, which only ever runs while `runTurn`
 * holds the project's `project_turn` lock; two `generate_image` calls for
 * the same project, whether sequential within one turn or across
 * different turns, can therefore never race here) and passes that same
 * `seq` through to `createIteration` explicitly, so the file name and the
 * recorded `Iteration.seq` always agree and `createIteration`'s own
 * locked insert never needs to recompute it.
 *
 * **File extension**: always `.png` -- `OPENAI_API_KEY`-backed
 * `gpt-image-2` generations return PNG bytes (predecessor parity, see
 * `imaging.ts`'s module header); no other format is ever produced by
 * `generateImage`.
 *
 * **Reference images / size / background**: `GenerateImageInput` (the
 * `ImageVisionClient` contract) carries only `prompt`, `projectId`, and a
 * free-form `modelParams` -- `turn.ts`'s `dispatchToolCall` does not
 * forward a separate `referenceImages` argument (that call site is
 * deliberately unchanged by this ticket). A caller that needs reference
 * images, a non-default `size`, or an OpenAI `background` value this
 * sprint supplies them nested under `modelParams` (`size`,
 * `referenceImages`, `background`); `size` defaults to `'1024x1024'` when
 * absent.
 */

interface GenerateImageModelParams {
  size?: ImageSize;
  referenceImages?: string[];
  background?: string;
  [key: string]: unknown;
}

const DEFAULT_IMAGE_SIZE: ImageSize = '1024x1024';
const GENERATED_IMAGE_EXTENSION = 'png';

export interface RealImageVisionClientOptions {
  /** Test-injectable stand-in for `services/imaging.ts`'s `generateImage`
   * -- every test in this sprint injects this rather than letting a real
   * network call/API key ever be reached. Defaults to the real
   * implementation. */
  generateImage?: (
    input: ImagingGenerateImageInput,
    options?: ImagingCallOptions
  ) => Promise<ImagingGenerateImageResult>;
  /** Passed through unmodified to `imaging.generateImage` (API keys,
   * `fetchImpl`, logger, etc.). */
  imagingOptions?: ImagingCallOptions;
  /** Prisma client used for the `Project`/`Iteration` reads and the
   * `create_iteration` call. Defaults to the shared app singleton;
   * test-injectable. */
  prismaClient?: any;
  /** Versioning Service instance handed to `create_iteration`. Defaults
   * to the shared app singleton; test-injectable. */
  versioning?: VersioningRecorder;
  /** Free-text `Lock.holder` value `create_iteration` records, for
   * diagnostics only. */
  lockHolder?: string;
}

/** `Iteration.seq` for the next iteration under `projectId`: one past the
 * highest existing `seq`, or `1` if none exist yet. Mirrors
 * `agent-mcp/catalogTools.ts`'s private `nextIterationSeq` -- duplicated
 * here (rather than exported and imported) because it is a five-line
 * read, not the path-resolution/locking machinery this module is
 * required to reuse rather than reimplement (see module header). */
async function nextIterationSeq(prismaClient: any, projectId: number): Promise<number> {
  const last = await prismaClient.iteration.findFirst({
    where: { projectId },
    orderBy: { seq: 'desc' },
  });
  return (last?.seq ?? 0) + 1;
}

/**
 * Creates the real, `imaging.ts`-backed `ImageVisionClient` `turn.ts`
 * uses in production (wired in `routes/chat.ts`) instead of
 * `imageVisionStub.ts`'s `createStubImageVisionClient` default. Tests
 * continue to inject the stub, a plain mock, or this real client with a
 * fake `options.generateImage` -- never a real network call.
 */
export function createRealImageVisionClient(options: RealImageVisionClientOptions = {}): ImageVisionClient {
  const callImaging = options.generateImage ?? imagingGenerateImage;
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const versioning = options.versioning ?? defaultVersioningService;

  return {
    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      const project = await prismaClient.project.findUnique({ where: { id: input.projectId } });
      if (!project) {
        throw new Error(`generate_image: no Project with id ${input.projectId}`);
      }

      const modelParams = (input.modelParams ?? {}) as GenerateImageModelParams;
      const size = modelParams.size ?? DEFAULT_IMAGE_SIZE;

      // A failure here (simulated or real) propagates as a thrown error --
      // no file write and no create_iteration call are ever attempted, so
      // no new Iteration row is added and no existing file is touched
      // (UC-006 E1; this ticket's AC5).
      const generated = await callImaging(
        {
          prompt: input.prompt,
          size,
          referenceImages: modelParams.referenceImages,
          background: modelParams.background,
        },
        options.imagingOptions
      );

      const seq = await nextIterationSeq(prismaClient, input.projectId);
      const relPath = `projects/${input.projectId}/iterations/iter-${seq}.${GENERATED_IMAGE_EXTENSION}`;
      const resolved = resolveWorkspacePath(relPath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, generated.bytes);

      const recordedModelParams = {
        ...modelParams,
        model: generated.model,
        size: generated.size,
        quality: generated.quality,
      };

      // Always inserts (create_iteration, unchanged) -- an existing
      // iteration's file is never overwritten (sprint.md Success
      // Criteria; this ticket's AC4).
      //
      // `role` (Sprint 005 OOP change, 2026-07-15): tags the new Iteration
      // into whichever stream tab was active client-side when this turn's
      // chat message was sent (`input.activeFace`, threaded from
      // `turn.ts`'s `dispatchToolCall`). Defaults to `'front'` when absent
      // (an older client that doesn't send it, or "a new project starts on
      // Front") -- never left `null`, so a freshly generated image always
      // lands in a visible stream rather than nowhere.
      await createIteration(
        {
          projectId: input.projectId,
          imagePath: relPath,
          promptUsed: input.prompt,
          modelParams: recordedModelParams,
          seq,
          role: input.activeFace ?? 'front',
        },
        { versioning, lockHolder: options.lockHolder, prismaClient }
      );

      return { imagePath: relPath, modelParams: recordedModelParams };
    },
  };
}

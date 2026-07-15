/**
 * Coverage for the Image & Vision Service (ticket 004-001:
 * `server/src/services/imaging.ts`) -- the only place in the codebase
 * that talks to OpenAI or OpenRouter. Every test in this file injects
 * `options.fetchImpl` (a scripted stub) and never reaches the real
 * global `fetch`, and `process.env.OPENAI_API_KEY` /
 * `process.env.OPENROUTER_API` are deleted in `beforeEach` so this suite
 * proves the module stays green with no real key present and no network
 * access (architecture-update.md R4-equivalent for this module).
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  generateImage,
  classifyAndDescribe,
  ImagingServiceError,
  type ImagingLogger,
} from '../../server/src/services/imaging';

const previousOpenaiKey = process.env.OPENAI_API_KEY;
const previousOpenrouterKey = process.env.OPENROUTER_API;
const previousImageModel = process.env.IMAGE_MODEL;
const previousOpenrouterModel = process.env.OPENROUTER_MODEL;

beforeEach(() => {
  // This suite must stay green with no real OPENAI_API_KEY/OPENROUTER_API
  // present, even if the developer's own shell happens to export one
  // (e.g. via dotconfig) -- every call here injects a stub fetchImpl and
  // an explicit test key, so a real env credential must never be
  // consulted.
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API;
  delete process.env.IMAGE_MODEL;
  delete process.env.OPENROUTER_MODEL;
});

afterAll(() => {
  if (previousOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenaiKey;
  if (previousOpenrouterKey === undefined) delete process.env.OPENROUTER_API;
  else process.env.OPENROUTER_API = previousOpenrouterKey;
  if (previousImageModel === undefined) delete process.env.IMAGE_MODEL;
  else process.env.IMAGE_MODEL = previousImageModel;
  if (previousOpenrouterModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = previousOpenrouterModel;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubLogger(): ImagingLogger & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), error: vi.fn() };
}

const SAMPLE_IMAGE_BYTES = Buffer.from('fake-png-bytes-for-test');
const SAMPLE_B64 = SAMPLE_IMAGE_BYTES.toString('base64');

// ---------------------------------------------------------------------------
// generateImage
// ---------------------------------------------------------------------------

describe('generateImage', () => {
  it('with no reference images calls /v1/images/generations and returns bytes + model/size/quality', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: SAMPLE_B64 }] }));
    const logger = stubLogger();

    const result = await generateImage(
      { prompt: 'a robot mascot', size: '1024x1024' },
      { openaiApiKey: 'test-openai-key', imageModel: 'gpt-image-2', fetchImpl, logger }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-openai-key');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'gpt-image-2', prompt: 'a robot mascot', n: 1, size: '1024x1024', quality: 'high' });

    expect(result.bytes.equals(SAMPLE_IMAGE_BYTES)).toBe(true);
    expect(result.model).toBe('gpt-image-2');
    expect(result.size).toBe('1024x1024');
    expect(result.quality).toBe('high');

    // Every successful call logs an approximate spend estimate.
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [logPayload] = logger.info.mock.calls[0];
    expect(logPayload.imagingSpend).toMatchObject({ provider: 'openai', operation: 'generateImage', model: 'gpt-image-2' });
    expect(typeof logPayload.imagingSpend.estimateUsd).toBe('number');
  });

  it('with one or more reference image paths calls /v1/images/edits and attaches them', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imaging-test-'));
    const refPath = path.join(tmpDir, 'reference.png');
    const refBytes = Buffer.from('fake-reference-png-bytes');
    await fs.writeFile(refPath, refBytes);

    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: SAMPLE_B64 }] }));

      const result = await generateImage(
        { prompt: 'edit this scene', size: '1536x1024', referenceImages: [refPath] },
        { openaiApiKey: 'test-openai-key', fetchImpl }
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/images/edits');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer test-openai-key');

      const form = init.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('size')).toBe('1536x1024');
      expect(form.get('quality')).toBe('high');

      const images = form.getAll('image[]') as unknown as Blob[];
      expect(images).toHaveLength(1);
      expect(images[0].type).toBe('image/png');
      const uploadedBytes = Buffer.from(await images[0].arrayBuffer());
      expect(uploadedBytes.equals(refBytes)).toBe(true);

      expect(result.bytes.equals(SAMPLE_IMAGE_BYTES)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws (no bytes returned) when OpenAI responds with a failure status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'rate limited' } }, 429));

    await expect(
      generateImage({ prompt: 'x', size: '1024x1024' }, { openaiApiKey: 'test-openai-key', fetchImpl })
    ).rejects.toBeInstanceOf(ImagingServiceError);
  });

  it('throws (no bytes returned) when the OpenAI request times out / rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    const error = await generateImage({ prompt: 'x', size: '1024x1024' }, { openaiApiKey: 'test-openai-key', fetchImpl }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(ImagingServiceError);
    expect(error.provider).toBe('openai');
  });

  it('throws a clear error naming OPENAI_API_KEY when no credential is available', async () => {
    const fetchImpl = vi.fn();
    const error = await generateImage({ prompt: 'x', size: '1024x1024' }, { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ImagingServiceError);
    expect(error.message).toContain('OPENAI_API_KEY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classifyAndDescribe
// ---------------------------------------------------------------------------

function classificationCompletion(json: Record<string, unknown>): Record<string, unknown> {
  return {
    model: 'deepseek/deepseek-v4-pro',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }],
  };
}

describe('classifyAndDescribe', () => {
  it('calls the OpenRouter chat-completions endpoint and parses all six fields', async () => {
    const fixture = classificationCompletion({
      isPhotograph: true,
      isLogo: false,
      style: 'photograph',
      peopleReal: 'real',
      description: 'A student robot on a workbench.',
      tags: ['robot', 'workbench', 'student'],
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(fixture));
    const logger = stubLogger();

    const result = await classifyAndDescribe(
      { imageBytes: Buffer.from('fake-image-bytes'), mimeType: 'image/png' },
      { openrouterApiKey: 'test-openrouter-key', openrouterModel: 'deepseek/deepseek-v4-pro', fetchImpl, logger }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-openrouter-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek/deepseek-v4-pro');
    const content = body.messages[0].content;
    expect(content[0].type).toBe('image_url');
    expect(content[0].image_url.url).toMatch(/^data:image\/png;base64,/);

    expect(result).toEqual({
      isPhotograph: true,
      isLogo: false,
      style: 'photograph',
      peopleReal: 'real',
      description: 'A student robot on a workbench.',
      tags: ['robot', 'workbench', 'student'],
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [logPayload] = logger.info.mock.calls[0];
    expect(logPayload.imagingSpend).toMatchObject({ provider: 'openrouter', operation: 'classifyAndDescribe' });
  });

  it('passes an imageUrl payload through directly instead of base64-encoding', async () => {
    const fixture = classificationCompletion({
      isPhotograph: false,
      isLogo: true,
      style: 'flat',
      peopleReal: 'none',
      description: 'A logo.',
      tags: ['logo'],
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(fixture));

    await classifyAndDescribe(
      { imageUrl: 'https://example.com/asset.png' },
      { openrouterApiKey: 'test-openrouter-key', fetchImpl }
    );

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content[0].image_url.url).toBe('https://example.com/asset.png');
  });

  it('always includes all four classification fields, defaulting ones the model omits or answers ambiguously', async () => {
    // Model response deliberately omits isLogo/style/peopleReal/tags.
    const fixture = classificationCompletion({
      isPhotograph: true,
      description: 'Something the model was unsure how to classify.',
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(fixture));

    const result = await classifyAndDescribe(
      { imageBytes: Buffer.from('x') },
      { openrouterApiKey: 'test-openrouter-key', fetchImpl }
    );

    expect(result.isPhotograph).toBe(true);
    expect(result.isLogo).toBe(false);
    expect(result.style).toBe('unknown');
    expect(result.peopleReal).toBe('unknown');
    expect(result.description).toBe('Something the model was unsure how to classify.');
    expect(result.tags).toEqual([]);
  });

  it('handles a content-array message shape (text block) the same as a plain string', async () => {
    const fixture = {
      model: 'deepseek/deepseek-v4-pro',
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  isPhotograph: false,
                  isLogo: false,
                  style: 'illustration',
                  peopleReal: 'ai',
                  description: 'An illustrated scene.',
                  tags: ['illustration'],
                }),
              },
            ],
          },
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(fixture));

    const result = await classifyAndDescribe({ imageBytes: Buffer.from('x') }, { openrouterApiKey: 'test-openrouter-key', fetchImpl });

    expect(result.style).toBe('illustration');
    expect(result.peopleReal).toBe('ai');
  });

  it('throws (no result returned) when OpenRouter responds with a failure status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'service unavailable' } }, 503));

    await expect(
      classifyAndDescribe({ imageBytes: Buffer.from('x') }, { openrouterApiKey: 'test-openrouter-key', fetchImpl })
    ).rejects.toBeInstanceOf(ImagingServiceError);
  });

  it('throws (no result returned) when the OpenRouter request times out / rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));

    const error = await classifyAndDescribe({ imageBytes: Buffer.from('x') }, { openrouterApiKey: 'test-openrouter-key', fetchImpl }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(ImagingServiceError);
    expect(error.provider).toBe('openrouter');
  });

  it('throws a clear error naming OPENROUTER_API when no credential is available', async () => {
    const fetchImpl = vi.fn();
    const error = await classifyAndDescribe({ imageBytes: Buffer.from('x') }, { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ImagingServiceError);
    expect(error.message).toContain('OPENROUTER_API');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

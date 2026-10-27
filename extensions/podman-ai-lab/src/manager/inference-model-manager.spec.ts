/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider } from '@openkaiden/api';
import { Container } from 'inversify';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ModelInfo } from '/@/api/model-info';
import { ModelsHandler } from '/@/handler/models-handler';
import { PodmanAiLabProvider } from '/@/inject/symbol';

import { InferenceModelManager } from './inference-model-manager';

vi.mock(import('@ai-sdk/openai-compatible'));

const disposableMock = { dispose: vi.fn() };
const modelsHandlerMock: ModelsHandler = {
  init: vi.fn(),
  onModelsChanged: vi.fn(),
} as unknown as ModelsHandler;
const podmanAiLabProviderMock: Provider = {
  registerInferenceProviderConnection: vi.fn(),
} as unknown as Provider;

describe('InferenceModelManager', () => {
  let inferenceModelManager: InferenceModelManager;

  beforeEach(async () => {
    vi.resetAllMocks();

    vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mockReturnValue(disposableMock);
    const container = new Container();
    container.bind(InferenceModelManager).toSelf();
    container.bind(ModelsHandler).toConstantValue(modelsHandlerMock);
    container.bind(PodmanAiLabProvider).toConstantValue(podmanAiLabProviderMock);
    inferenceModelManager = await container.getAsync<InferenceModelManager>(InferenceModelManager);
  });

  test('registers each model with the provider using the created sdk', async () => {
    const sdkInstance: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;
    vi.mocked(createOpenAICompatible).mockReturnValueOnce(sdkInstance);

    const modelInfo: ModelInfo = {
      id: 'hf.co/org/modelA',
      name: 'hf.co/org/modelA',
      baseUrl: 'http://localhost:9090/v1',
    };
    await inferenceModelManager.refreshRegistrationOfModels([modelInfo]);

    expect(vi.mocked(createOpenAICompatible)).toHaveBeenCalledWith({
      baseURL: 'http://localhost:9090/v1',
      name: 'PodmanAiLab/hf.co/org/modelA',
    });
    expect(vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'hf.co/org/modelA',
        type: 'local',
        llmMetadata: { name: 'openai' },
        endpoint: 'http://localhost:9090/v1',
        sdk: sdkInstance,
        models: [{ label: 'hf.co/org/modelA' }],
      }),
    );

    const registeredConnection = vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mock
      .calls[0][0];
    expect(registeredConnection.status()).toBe('started');
    expect(registeredConnection.credentials()).toEqual({});
  });

  test('unregisters models that are no longer present', async () => {
    const sdkInstance: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;
    vi.mocked(createOpenAICompatible).mockReturnValue(sdkInstance);

    await inferenceModelManager.refreshRegistrationOfModels([
      { id: 'modelA', name: 'ModelA', baseUrl: 'http://localhost:9090/v1' },
      { id: 'modelB', name: 'ModelB', baseUrl: 'http://localhost:9091/v1' },
    ]);

    await inferenceModelManager.refreshRegistrationOfModels([
      { id: 'modelA', name: 'ModelA', baseUrl: 'http://localhost:9090/v1' },
    ]);

    expect(disposableMock.dispose).toHaveBeenCalledWith();
  });

  test('resolves the current server context when preparing a workspace model', async () => {
    const server = setupServer(
      http.get('http://localhost:9090/props', () =>
        HttpResponse.json({ default_generation_settings: { n_ctx: 32768 } }),
      ),
      http.post('http://localhost:9090/apply-template', async ({ request }) => {
        expect(await request.json()).toMatchObject({
          model: 'qwen',
          tools: [{ type: 'function', function: { name: 'check_tool_support' } }],
        });
        return HttpResponse.json({ prompt: 'Prepared prompt' });
      }),
    );
    server.listen({ onUnhandledRequest: 'error' });
    try {
      await inferenceModelManager.refreshRegistrationOfModels([
        { id: 'qwen', name: 'qwen', baseUrl: 'http://localhost:9090/v1' },
      ]);
      const registration = vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mock.calls[0];
      assert(registration?.[0].getModelInfo);
      expect(await registration[0].getModelInfo({ label: 'qwen' })).toEqual({
        label: 'qwen',
        contextWindow: 32768,
        unsupportedToolSchemaKeywords: ['pattern'],
      });
    } finally {
      server.close();
    }
  });

  test.each([
    { status: 503, body: {}, message: 'HTTP 503' },
    { status: 200, body: {}, message: 'valid context window' },
    { status: 200, body: { default_generation_settings: { n_ctx: -1 } }, message: 'valid context window' },
  ])('reports unusable server properties: $status $body', async ({ status, body, message }) => {
    const server = setupServer(http.get('http://localhost:9090/props', () => HttpResponse.json(body, { status })));
    server.listen({ onUnhandledRequest: 'error' });
    try {
      await inferenceModelManager.refreshRegistrationOfModels([
        { id: 'qwen', name: 'qwen', baseUrl: 'http://localhost:9090/v1/' },
      ]);
      const registration = vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mock.calls[0];
      assert(registration?.[0].getModelInfo);
      await expect(registration[0].getModelInfo({ label: 'qwen' })).rejects.toThrow(message);
    } finally {
      server.close();
    }
  });

  test('rejects workspace preparation when the server cannot accept agent tools', async () => {
    const server = setupServer(
      http.get('http://localhost:9090/props', () =>
        HttpResponse.json({ default_generation_settings: { n_ctx: 32768 } }),
      ),
      http.post('http://localhost:9090/apply-template', () =>
        HttpResponse.json({ error: { message: 'tools param requires --jinja flag' } }, { status: 500 }),
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });
    try {
      await inferenceModelManager.refreshRegistrationOfModels([
        { id: 'qwen', name: 'qwen', baseUrl: 'http://localhost:9090/v1' },
      ]);
      const registration = vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mock.calls[0];
      assert(registration?.[0].getModelInfo);
      await expect(registration[0].getModelInfo({ label: 'qwen' })).rejects.toThrow('MODEL_JINJA=true');
    } finally {
      server.close();
    }
  });

  test('wraps network errors with actionable context', async () => {
    const server = setupServer(http.get('http://localhost:9090/props', () => HttpResponse.error()));
    server.listen({ onUnhandledRequest: 'error' });
    try {
      await inferenceModelManager.refreshRegistrationOfModels([
        { id: 'qwen', name: 'qwen', baseUrl: 'http://localhost:9090/v1' },
      ]);
      const registration = vi.mocked(podmanAiLabProviderMock.registerInferenceProviderConnection).mock.calls[0];
      assert(registration?.[0].getModelInfo);
      await expect(registration[0].getModelInfo({ label: 'qwen' })).rejects.toThrow(/Podman AI Lab:.*props/);
    } finally {
      server.close();
    }
  });

  test('handles empty models array', async () => {
    const sdkInstance: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;
    vi.mocked(createOpenAICompatible).mockReturnValue(sdkInstance);
    await inferenceModelManager.refreshRegistrationOfModels([
      { id: 'modelA', name: 'ModelA', baseUrl: 'http://localhost:9090/v1' },
    ]);

    await inferenceModelManager.refreshRegistrationOfModels([]);

    expect(disposableMock.dispose).toHaveBeenCalledWith();
  });

  test('handles errors during registration', async () => {
    vi.mocked(createOpenAICompatible).mockImplementationOnce(() => {
      throw new Error('SDK creation failed');
    });

    await expect(
      inferenceModelManager.refreshRegistrationOfModels([
        { id: 'modelA', name: 'ModelA', baseUrl: 'http://localhost:9090/v1' },
      ]),
    ).rejects.toThrow('SDK creation failed');
  });

  test('init wires model changes to refresh logic and initializes handler', async () => {
    const refreshRegistrationOfModelsSpy = vi.spyOn(inferenceModelManager, 'refreshRegistrationOfModels');
    await inferenceModelManager.init();

    expect(modelsHandlerMock.onModelsChanged).toHaveBeenCalledTimes(1);
    expect(modelsHandlerMock.init).toHaveBeenCalledTimes(1);

    const modelsSample = [{ id: 'modelThree', name: 'ModelThree', baseUrl: 'http://localhost:3000/v1' }] as ModelInfo[];

    const onModelsChangedCallback = vi.mocked(modelsHandlerMock.onModelsChanged).mock.calls[0]?.[0];
    expect(onModelsChangedCallback).toBeDefined();

    await onModelsChangedCallback?.(modelsSample);

    expect(refreshRegistrationOfModelsSpy).toHaveBeenCalledWith(modelsSample);

    expect(modelsHandlerMock.init).toHaveBeenCalled();
  });

  test('on dispose connections are disposed', async () => {
    const sdkInstance: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;
    vi.mocked(createOpenAICompatible).mockReturnValueOnce(sdkInstance);

    await inferenceModelManager.refreshRegistrationOfModels([
      { id: 'modelA', name: 'ModelA', baseUrl: 'http://localhost:9090/v1' },
    ]);

    inferenceModelManager.dispose();

    expect(disposableMock.dispose).toHaveBeenCalled();
  });
});

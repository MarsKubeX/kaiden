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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Disposable, InferenceModel, Provider } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import type { ModelInfo } from '/@/api/model-info';
import { ModelsHandler } from '/@/handler/models-handler';
import { PodmanAiLabProvider } from '/@/inject/symbol';

@injectable()
export class InferenceModelManager {
  @inject(ModelsHandler)
  private modelsHandler: ModelsHandler;

  @inject(PodmanAiLabProvider)
  private podmanAiLabProvider: Provider;

  #modelsDisposable: Disposable[] = [];
  #connectionIdCounter = 0;

  async init(): Promise<void> {
    this.modelsHandler.onModelsChanged(async models => {
      await this.refreshRegistrationOfModels(models);
    });

    await this.modelsHandler.init();
  }

  async refreshRegistrationOfModels(models: readonly ModelInfo[]): Promise<void> {
    for (const disposable of this.#modelsDisposable) {
      disposable.dispose();
    }
    this.#modelsDisposable = [];

    for (const modelInfo of models) {
      const sdk = createOpenAICompatible({
        baseURL: modelInfo.baseUrl,
        name: `PodmanAiLab/${modelInfo.id}`,
      });
      const disposable = this.podmanAiLabProvider.registerInferenceProviderConnection({
        id: String(this.#connectionIdCounter++),
        name: modelInfo.name,
        type: 'local',
        llmMetadata: { name: 'openai' },
        endpoint: modelInfo.baseUrl,
        sdk,
        status() {
          return 'started';
        },
        models: [{ label: modelInfo.name }],
        getModelInfo: model => this.getModelInfo(modelInfo.baseUrl, model),
        credentials() {
          return {};
        },
      });
      this.#modelsDisposable.push(disposable);
    }
  }

  private async getModelInfo(baseUrl: string, model: InferenceModel): Promise<InferenceModel> {
    const propertiesUrl = new URL('../props', `${baseUrl.replace(/\/$/, '')}/`);
    const response = await fetch(propertiesUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      throw new Error(
        `Podman AI Lab: cannot read inference server settings (HTTP ${response.status}). Check that the model service is ready.`,
      );
    }
    const properties: unknown = await response.json();
    const settings =
      properties && typeof properties === 'object' && 'default_generation_settings' in properties
        ? properties.default_generation_settings
        : undefined;
    const contextWindow = settings && typeof settings === 'object' && 'n_ctx' in settings ? settings.n_ctx : undefined;
    if (typeof contextWindow !== 'number' || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
      throw new Error('Podman AI Lab: the inference server did not report a valid context window in /props.');
    }
    // llama.cpp applies the same tool/template parser as chat completions here, without running inference.
    const templateResponse = await fetch(new URL('apply-template', propertiesUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        model: model.label,
        messages: [{ role: 'user', content: 'Check tool support.' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'check_tool_support',
              description: 'Check that the server accepts agent tools.',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }),
    });
    if (!templateResponse.ok) {
      throw new Error(
        `Podman AI Lab: the inference server cannot prepare agent tool calls (HTTP ${templateResponse.status}). Enable llama.cpp --jinja (MODEL_JINJA=true in the AI Lab llama-server image) and use a model with a tool-calling chat template.`,
      );
    }
    return { ...model, contextWindow, unsupportedToolSchemaKeywords: ['pattern'] };
  }

  dispose(): void {
    for (const disposable of this.#modelsDisposable) {
      disposable.dispose();
    }
    this.#modelsDisposable = [];
  }
}

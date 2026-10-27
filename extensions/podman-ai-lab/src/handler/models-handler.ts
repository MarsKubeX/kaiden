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

import { type Disposable, type Event, EventEmitter } from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
import { inject, preDestroy } from 'inversify';

import type { ModelInfo } from '/@/api/model-info';
import { ContainerModelExtractor } from '/@/helper/container-model-extractor';
import { ContainerPodmanAiLabFinder } from '/@/helper/container-podman-ai-lab-finder';
import { ContainerExtensionAPISymbol } from '/@/inject/symbol';

// Responsible for tracking Podman AI Lab models by scanning containers.
// It refreshes the models when containers or endpoints change.
export class ModelsHandler {
  @inject(ContainerPodmanAiLabFinder)
  private containerPodmanAiLabFinder: ContainerPodmanAiLabFinder;

  @inject(ContainerModelExtractor)
  private containerModelExtractor: ContainerModelExtractor;

  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI: ContainerExtensionAPI;

  #connections: readonly EndpointConnection[] = [];

  #models: readonly ModelInfo[] = [];

  #subscriptions: Disposable[] = [];

  #onModelsChanged: EventEmitter<readonly ModelInfo[]>;
  public readonly onModelsChanged: Event<readonly ModelInfo[]>;

  constructor() {
    this.#onModelsChanged = new EventEmitter<ModelInfo[]>();
    this.onModelsChanged = this.#onModelsChanged.event;
  }

  @preDestroy()
  dispose(): void {
    for (const subscription of this.#subscriptions) {
      subscription.dispose();
    }
    this.#subscriptions = [];
    this.#onModelsChanged.dispose();
  }

  async init(): Promise<void> {
    this.#subscriptions.push(
      this.containerExtensionAPI.onEndpointsChanged(dockerodeConnections => {
        this.#connections = dockerodeConnections;
        this.refreshModels().catch((error: unknown) => {
          console.error('Error refreshing models:', error);
        });
      }),
    );

    this.#subscriptions.push(
      this.containerExtensionAPI.onContainersChanged(() => {
        this.refreshModels().catch((error: unknown) => {
          console.error('Error refreshing models:', error);
        });
      }),
    );

    this.#connections = this.containerExtensionAPI.getEndpoints();

    this.refreshModels().catch((error: unknown) => {
      console.error('Error refreshing models:', error);
    });
  }

  async refreshModels(): Promise<void> {
    const foundModels: ModelInfo[] = [];
    for (const connection of this.#connections) {
      try {
        const containers = await connection.dockerode.listContainers();
        const aiLabContainers = await this.containerPodmanAiLabFinder.getPodmanAiLabContainers(containers);

        for (const container of aiLabContainers) {
          const models = this.containerModelExtractor.extractModels(container);
          foundModels.push(...models);
        }
      } catch (error) {
        console.error(`Error connecting to socket ${connection.path}:`, error);
      }
    }

    this.#models = foundModels;
    this.#onModelsChanged.fire(this.#models);
  }

  protected getModels(): readonly ModelInfo[] {
    return this.#models;
  }

  protected getModelsChanged(): EventEmitter<readonly ModelInfo[]> {
    return this.#onModelsChanged;
  }
}

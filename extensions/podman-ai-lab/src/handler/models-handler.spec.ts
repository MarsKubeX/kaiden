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

import * as kaidenApi from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
import { Container, injectFromBase } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ModelInfo } from '/@/api/model-info';
import type { PodmanAiLabContainerInfo } from '/@/api/podman-ai-lab-container-info';
import { ContainerModelExtractor } from '/@/helper/container-model-extractor';
import { ContainerPodmanAiLabFinder } from '/@/helper/container-podman-ai-lab-finder';
import { ContainerExtensionAPISymbol } from '/@/inject/symbol';

import { ModelsHandler } from './models-handler';

const containerPodmanAiLabFinderMock = {
  getPodmanAiLabContainers: vi.fn(),
} as unknown as ContainerPodmanAiLabFinder;

const containerModelExtractorMock = {
  extractModels: vi.fn(),
} as unknown as ContainerModelExtractor;

const containerExtensionAPIMock = {
  onEndpointsChanged: vi.fn(),
  onContainersChanged: vi.fn(),
  getEndpoints: vi.fn().mockReturnValue([]),
} as unknown as ContainerExtensionAPI;

@injectFromBase()
class TestModelsHandler extends ModelsHandler {
  getModels(): readonly ModelInfo[] {
    return super.getModels();
  }

  getModelsChanged(): kaidenApi.EventEmitter<readonly ModelInfo[]> {
    return super.getModelsChanged();
  }
}

let modelsHandler: TestModelsHandler;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);
  const container = new Container();
  container.bind(TestModelsHandler).toSelf().inSingletonScope();
  container.bind(ContainerPodmanAiLabFinder).toConstantValue(containerPodmanAiLabFinderMock);
  container.bind(ContainerModelExtractor).toConstantValue(containerModelExtractorMock);
  container.bind(ContainerExtensionAPISymbol).toConstantValue(containerExtensionAPIMock);
  modelsHandler = await container.getAsync<TestModelsHandler>(TestModelsHandler);
});

test('should initialize listeners', async () => {
  await modelsHandler.init();

  expect(containerExtensionAPIMock.onEndpointsChanged).toHaveBeenCalled();
  expect(containerExtensionAPIMock.onContainersChanged).toHaveBeenCalled();
  expect(containerExtensionAPIMock.getEndpoints).toHaveBeenCalled();
  expect(modelsHandler.getModels().length).toBe(0);

  const endpointsChangedCallback = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0][0];
  await endpointsChangedCallback([]);

  const containersChangedCallback = vi.mocked(containerExtensionAPIMock.onContainersChanged).mock.calls[0][0];
  await containersChangedCallback();
});

test('test log failures on container change event', async () => {
  await modelsHandler.init();

  const consoleErrorSpy = vi.spyOn(console, 'error');
  const spyRefreshModels = vi.spyOn(modelsHandler, 'refreshModels');
  spyRefreshModels.mockRejectedValueOnce(new Error('Test error'));

  const containersChangedCallback = vi.mocked(containerExtensionAPIMock.onContainersChanged).mock.calls[0][0];
  await containersChangedCallback();
  expect(spyRefreshModels).toHaveBeenCalled();
  expect(consoleErrorSpy).toHaveBeenCalledWith('Error refreshing models:', expect.any(Error));
});

test('test log failures on endpoint change event', async () => {
  await modelsHandler.init();

  const consoleErrorSpy = vi.spyOn(console, 'error');
  const spyRefreshModels = vi.spyOn(modelsHandler, 'refreshModels');
  spyRefreshModels.mockRejectedValueOnce(new Error('Test error'));

  const endpointsChangedCallback = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0][0];
  await endpointsChangedCallback([]);
  expect(spyRefreshModels).toHaveBeenCalled();
  expect(consoleErrorSpy).toHaveBeenCalledWith('Error refreshing models:', expect.any(Error));
});

test('should dispose', async () => {
  modelsHandler.dispose();
  expect(modelsHandler.getModelsChanged().dispose).toHaveBeenCalled();
});

test('should refresh models when connections have Podman AI Lab containers', async () => {
  const mockContainer1 = {
    Id: 'container1',
    Names: ['/ai-lab-container1'],
  } as unknown as PodmanAiLabContainerInfo;
  const mockContainer2 = {
    Id: 'container2',
    Names: ['/ai-lab-container2'],
  } as unknown as PodmanAiLabContainerInfo;

  const mockModelInfo1: ModelInfo = { id: 'model1', name: 'Model 1', baseUrl: 'http://localhost:8000/v1' };
  const mockModelInfo2: ModelInfo = { id: 'model2', name: 'Model 2', baseUrl: 'http://localhost:8001/v1' };

  const mockConnection = {
    path: '/var/run/docker.sock',
    dockerode: {
      listContainers: vi.fn().mockResolvedValue([mockContainer1, mockContainer2]),
    },
  } as unknown as EndpointConnection;

  vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([mockConnection]);
  vi.mocked(containerPodmanAiLabFinderMock.getPodmanAiLabContainers).mockResolvedValue([
    mockContainer1,
    mockContainer2,
  ]);
  vi.mocked(containerModelExtractorMock.extractModels).mockImplementation(container => {
    if (container === mockContainer1) return [mockModelInfo1];
    if (container === mockContainer2) return [mockModelInfo2];
    return [];
  });

  await modelsHandler.init();

  const fireSpy = vi.spyOn(modelsHandler.getModelsChanged(), 'fire');

  await modelsHandler.refreshModels();

  expect(containerPodmanAiLabFinderMock.getPodmanAiLabContainers).toHaveBeenCalledWith([
    mockContainer1,
    mockContainer2,
  ]);
  expect(containerModelExtractorMock.extractModels).toHaveBeenCalledWith(mockContainer1);
  expect(containerModelExtractorMock.extractModels).toHaveBeenCalledWith(mockContainer2);
  expect(modelsHandler.getModels()).toEqual([mockModelInfo1, mockModelInfo2]);
  expect(fireSpy).toHaveBeenCalledWith([mockModelInfo1, mockModelInfo2]);
});

test('should refresh models on init', async () => {
  const refreshModelsSpy = vi.spyOn(modelsHandler, 'refreshModels');

  await modelsHandler.init();
  expect(refreshModelsSpy).toHaveBeenCalled();

  refreshModelsSpy.mockRestore();
});

test('should handle connection errors gracefully', async () => {
  const mockConnection = {
    path: '/var/run/docker.sock',
    dockerode: {
      listContainers: vi.fn().mockRejectedValue(new Error('Connection failed')),
    },
  } as unknown as EndpointConnection;

  vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([mockConnection]);

  await modelsHandler.init();

  const consoleErrorSpy = vi.spyOn(console, 'error');
  const fireSpy = vi.spyOn(modelsHandler.getModelsChanged(), 'fire');

  await modelsHandler.refreshModels();

  expect(consoleErrorSpy).toHaveBeenCalledWith('Error connecting to socket /var/run/docker.sock:', expect.any(Error));
  expect(modelsHandler.getModels()).toEqual([]);
  expect(fireSpy).toHaveBeenCalledWith([]);
});

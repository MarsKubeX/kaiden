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

import { beforeEach, expect, test, vi } from 'vitest';

import type { PodmanAiLabContainerInfo } from '/@/api/podman-ai-lab-container-info';

import { ContainerModelExtractor } from './container-model-extractor';

beforeEach(async () => {
  vi.resetAllMocks();
});

test('extractModels parses model IDs from label and uses api label for baseUrl', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '["hf.co/org/modelA","hf.co/org/modelB"]',
      api: 'http://localhost:9090/v1',
    },
    Ports: [{ PublicPort: 9090 }],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(2);
  expect(models[0]).toEqual({ id: 'hf.co/org/modelA', name: 'modelA', baseUrl: 'http://localhost:9090/v1' });
  expect(models[1]).toEqual({ id: 'hf.co/org/modelB', name: 'modelB', baseUrl: 'http://localhost:9090/v1' });
});

test('extractModels falls back to Ports[0].PublicPort when api label is missing', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '["hf.co/org/modelC"]',
    },
    Ports: [{ PublicPort: 54321 }],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(1);
  expect(models[0]).toEqual({
    id: 'hf.co/org/modelC',
    name: 'modelC',
    baseUrl: 'http://localhost:54321/v1',
  });
});

test('extractModels falls back to default port 8000 when no api label and no ports', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '["model-x"]',
    },
    Ports: [],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(1);
  expect(models[0]).toEqual({ id: 'model-x', name: 'model-x', baseUrl: 'http://localhost:8000/v1' });
});

test('extractModels returns empty array for invalid JSON label', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': 'not-valid-json',
    },
    Ports: [],
  } as unknown as PodmanAiLabContainerInfo;

  const consoleErrorSpy = vi.spyOn(console, 'error');
  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(0);
  expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse ai-lab-inference-server label:', 'not-valid-json');
});

test('extractModels replaces dots with hyphens in display name', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '["hf.ibm-granite.granite-3.3-8b-instruct-GGUF"]',
      api: 'http://localhost:9090/v1',
    },
    Ports: [{ PublicPort: 9090 }],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(1);
  expect(models[0]).toEqual({
    id: 'hf.ibm-granite.granite-3.3-8b-instruct-GGUF',
    name: 'hf-ibm-granite-granite-3-3-8b-instruct-GGUF',
    baseUrl: 'http://localhost:9090/v1',
  });
});

test('extractModels filters out non-string model IDs', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '[123, null, "", "hf.co/org/validModel"]',
      api: 'http://localhost:9090/v1',
    },
    Ports: [{ PublicPort: 9090 }],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(1);
  expect(models[0]).toEqual({ id: 'hf.co/org/validModel', name: 'validModel', baseUrl: 'http://localhost:9090/v1' });
});

test('extractModels returns empty array for empty JSON array label', () => {
  const containerModelExtractor = new ContainerModelExtractor();

  const container = {
    Id: '1',
    Names: ['/container1'],
    Labels: {
      'ai-lab-inference-server': '[]',
    },
    Ports: [],
  } as unknown as PodmanAiLabContainerInfo;

  const models = containerModelExtractor.extractModels(container);
  expect(models).toHaveLength(0);
});

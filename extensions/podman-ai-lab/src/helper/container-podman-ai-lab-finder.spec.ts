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

import type { ContainerInfo } from 'dockerode';
import { beforeEach, expect, test, vi } from 'vitest';

import { ContainerPodmanAiLabFinder } from './container-podman-ai-lab-finder';

beforeEach(async () => {
  vi.resetAllMocks();
});

test('getPodmanAiLabContainers filters containers with ai-lab-inference-server label', async () => {
  const containerPodmanAiLabFinder = new ContainerPodmanAiLabFinder();

  const containers = [
    { Id: '1', Names: ['/container1'], Labels: { 'ai-lab-inference-server': '["model1"]' } },
    { Id: '2', Names: ['/container2'], Labels: {} },
    { Id: '3', Names: ['/container3'], Labels: { 'ai-lab-inference-server': '["model2"]' } },
    { Id: '4', Names: ['/container4'] },
  ] as unknown as ContainerInfo[];

  const aiLabContainers = await containerPodmanAiLabFinder.getPodmanAiLabContainers(containers);

  expect(aiLabContainers).toHaveLength(2);
  expect(aiLabContainers.map(c => c.Id)).toEqual(['1', '3']);
});

test('getPodmanAiLabContainers returns empty array when no containers match', async () => {
  const containerPodmanAiLabFinder = new ContainerPodmanAiLabFinder();

  const containers = [
    { Id: '1', Names: ['/container1'], Labels: {} },
    { Id: '2', Names: ['/container2'], Labels: { 'some-other-label': 'value' } },
  ] as unknown as ContainerInfo[];

  const aiLabContainers = await containerPodmanAiLabFinder.getPodmanAiLabContainers(containers);

  expect(aiLabContainers).toHaveLength(0);
});

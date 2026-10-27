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

import type { Extension, ExtensionContext } from '@openkaiden/api';
import { extensions } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InferenceModelManager } from '/@/manager/inference-model-manager';
import { PodmanAiLabExtension } from '/@/podman-ai-lab-extension';

vi.mock(import('/@/manager/inference-model-manager'));

class TestPodmanAiLabExtension extends PodmanAiLabExtension {
  containerOverride: Container | undefined;

  protected override getContainer(): Container | undefined {
    return this.containerOverride ?? super.getContainer();
  }
}

describe('PodmanAiLabExtension', () => {
  let extensionContext: ExtensionContext;
  let podmanAiLabExtension: TestPodmanAiLabExtension;

  beforeEach(async () => {
    vi.resetAllMocks();
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    podmanAiLabExtension = new TestPodmanAiLabExtension(extensionContext);
    const extensionData = {
      exports: {} as unknown as ContainerExtensionAPI,
    } as unknown as Extension<ContainerExtensionAPI>;
    vi.mocked(extensions.getExtension).mockReturnValue(extensionData);
  });

  test('activate', async () => {
    await podmanAiLabExtension.activate();
    expect(InferenceModelManager.prototype.init).toHaveBeenCalled();
  });

  test('activate fails with extension missing', async () => {
    vi.mocked(extensions.getExtension).mockReturnValue(undefined);
    await expect(podmanAiLabExtension.activate()).rejects.toThrowError(
      'Mandatory extension kaiden.container is not installed',
    );
  });

  test('activate fails with exports missing', async () => {
    const extensionData = { exports: undefined } as unknown as Extension<ContainerExtensionAPI>;

    vi.mocked(extensions.getExtension).mockReturnValue(extensionData);
    await expect(podmanAiLabExtension.activate()).rejects.toThrowError(
      'Missing exports of API in container extension kaiden.container',
    );
  });

  test('activate handles error during container creation', async () => {
    podmanAiLabExtension.containerOverride = {
      getAsync: vi.fn().mockRejectedValue(new Error('Container creation failed')),
    } as unknown as Container;
    await expect(podmanAiLabExtension.activate()).rejects.toThrow('Container creation failed');
  });

  test('deactivate disposes subscriptions', async () => {
    await podmanAiLabExtension.activate();
    await podmanAiLabExtension.deactivate();
    expect(InferenceModelManager.prototype.dispose).toHaveBeenCalled();
  });
});

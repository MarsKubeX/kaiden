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

import { injectable } from 'inversify';

import type { ModelInfo } from '/@/api/model-info';
import type { PodmanAiLabContainerInfo } from '/@/api/podman-ai-lab-container-info';

@injectable()
export class ContainerModelExtractor {
  extractModels(container: PodmanAiLabContainerInfo): ModelInfo[] {
    const inferenceServerLabel = container.Labels['ai-lab-inference-server'];
    let modelIds: string[];
    try {
      modelIds = JSON.parse(inferenceServerLabel) as string[];
    } catch {
      console.error('Failed to parse ai-lab-inference-server label:', inferenceServerLabel);
      return [];
    }

    if (!Array.isArray(modelIds)) {
      return [];
    }

    const validIds = modelIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (validIds.length === 0) {
      return [];
    }

    const baseUrl = this.#resolveBaseUrl(container);

    return validIds.map(id => ({
      id,
      name: this.#toDisplayName(id),
      baseUrl,
    }));
  }

  // Derive a safe display name from a HuggingFace-style model identifier.
  // Strips path prefixes (slashes) and replaces dots with hyphens so the
  // name is safe as a config key, database key, or file path component
  // inside workspace agents (OpenCode, OpenClaw, etc.).
  #toDisplayName(modelId: string): string {
    const lastSegment = modelId.split('/').pop() ?? modelId;
    return lastSegment.replaceAll('.', '-');
  }

  #resolveBaseUrl(container: PodmanAiLabContainerInfo): string {
    const apiLabel = container.Labels['api'];
    if (apiLabel) {
      return apiLabel;
    }

    const publicPort = container.Ports?.[0]?.PublicPort;
    if (publicPort) {
      return `http://localhost:${String(publicPort)}/v1`;
    }

    return 'http://localhost:8000/v1';
  }
}

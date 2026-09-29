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

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, test } from 'vitest';

import { INTERACTIVE_SHELL_COMMAND } from './shell-command.js';

describe('INTERACTIVE_SHELL_COMMAND', () => {
  test('is a /bin/sh -c command array with three elements', () => {
    expect(INTERACTIVE_SHELL_COMMAND[0]).toBe('/bin/sh');
    expect(INTERACTIVE_SHELL_COMMAND[1]).toBe('-c');
    expect(INTERACTIVE_SHELL_COMMAND).toHaveLength(3);
  });

  describe.skipIf(process.platform === 'win32')('shell selection', () => {
    let stubDir: string;

    beforeEach(() => {
      stubDir = mkdtempSync(join(tmpdir(), 'shell-test-'));
      return (): void => {
        rmSync(stubDir, { recursive: true, force: true });
      };
    });

    function addStub(name: string): string {
      const path = join(stubDir, name);
      writeFileSync(path, '#!/bin/sh\n');
      chmodSync(path, 0o755);
      return path;
    }

    function resolvedShell(shellEnv: string, availableStubs: string[]): string {
      for (const stub of availableStubs) {
        addStub(stub);
      }
      const script = INTERACTIVE_SHELL_COMMAND[2];
      assert(script);
      const wrapped = `echo_and_exit() { echo "$@"; exit 0; }; ${script.replaceAll('exec ', 'echo_and_exit ')}`;
      const result = spawnSync('/bin/sh', ['-c', wrapped], {
        env: { SHELL: shellEnv, PATH: stubDir },
        encoding: 'utf-8',
      });
      const output = result.stdout.trim().split('\n').pop();
      assert(output);
      return output;
    }

    test('uses $SHELL when it is a valid interactive shell', () => {
      const zshPath = addStub('zsh');
      expect(resolvedShell(zshPath, [])).toBe(zshPath);
    });

    test('skips $SHELL=nologin and falls back to bash', () => {
      const nologinPath = addStub('nologin');
      expect(resolvedShell(nologinPath, ['bash'])).toBe('bash');
    });

    test('skips $SHELL=false and falls back to bash', () => {
      const falsePath = addStub('false');
      expect(resolvedShell(falsePath, ['bash'])).toBe('bash');
    });

    test('skips $SHELL=sh and falls back to bash', () => {
      const shPath = addStub('sh');
      expect(resolvedShell(shPath, ['bash'])).toBe('bash');
    });

    test('skips empty $SHELL and falls back to bash', () => {
      expect(resolvedShell('', ['bash'])).toBe('bash');
    });

    test('falls back to sh when bash is not available', () => {
      expect(resolvedShell('', ['sh'])).toBe('sh');
    });
  });
});

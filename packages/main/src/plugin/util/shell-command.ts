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

export const InteractiveShellCommand = Symbol.for('InteractiveShellCommand');

// sh does not expand PS1 bash escapes (\u, \h, \w), so prefer $SHELL or bash.
const shellScript = [
  'case "$SHELL" in */nologin|*/false|*/sh|"") ;; *) command -v "$SHELL" >/dev/null 2>&1 && exec "$SHELL";; esac',
  'if command -v bash >/dev/null 2>&1; then exec bash; fi',
  'exec sh',
].join('\n');

export const INTERACTIVE_SHELL_COMMAND: readonly string[] = ['/bin/sh', '-c', shellScript];

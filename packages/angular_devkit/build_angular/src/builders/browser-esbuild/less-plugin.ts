/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import type { OnLoadResult, Plugin, PluginBuild } from 'esbuild';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';

/**
 * The lazy-loaded instance of the less stylesheet preprocessor.
 * It is only imported and initialized if a less stylesheet is used.
 */
let lessPreprocessor: typeof import('less') | undefined;

export interface LessPluginOptions {
  sourcemap: boolean;
  includePaths?: string[];
  inlineComponentData?: Record<string, string>;
}

interface LessException extends Error {
  filename: string;
  line: number;
  column: number;
  extract?: string[];
}

function isLessException(error: unknown): error is LessException {
  return !!error && typeof error === 'object' && 'column' in error;
}

export function createLessPlugin(options: LessPluginOptions): Plugin {
  return {
    name: 'angular-less',
    setup(build: PluginBuild): void {
      // Add a load callback to support inline Component styles
      build.onLoad({ filter: /^less;/, namespace: 'angular:styles/component' }, async (args) => {
        const data = options.inlineComponentData?.[args.path];
        assert(data, `component style name should always be found [${args.path}]`);

        const [, , filePath] = args.path.split(';', 3);

        return compileString(data, filePath, options);
      });

      // Add a load callback to support files from disk
      build.onLoad({ filter: /\.less$/ }, async (args) => {
        const data = await readFile(args.path, 'utf-8');

        return compileString(data, args.path, options);
      });
    },
  };
}

async function compileString(
  data: string,
  filename: string,
  options: LessPluginOptions,
): Promise<OnLoadResult> {
  const less = (lessPreprocessor ??= (await import('less')).default);

  try {
    const result = await less.render(data, {
      filename,
      paths: options.includePaths,
      rewriteUrls: 'all',
      sourceMap: options.sourcemap
        ? {
            sourceMapFileInline: true,
            outputSourceFiles: true,
          }
        : undefined,
    } as Less.Options);

    return {
      contents: result.css,
      loader: 'css',
    };
  } catch (error) {
    if (isLessException(error)) {
      return {
        errors: [
          {
            text: error.message,
            location: {
              file: error.filename,
              line: error.line,
              column: error.column,
              // Middle element represents the line containing the error
              lineText: error.extract && error.extract[Math.trunc(error.extract.length / 2)],
            },
          },
        ],
        loader: 'css',
      };
    }

    throw error;
  }
}

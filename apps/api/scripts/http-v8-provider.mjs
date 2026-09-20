import { ProcessV8CoverageProvider } from '../../../scripts/process-v8-provider.mjs';

export class HttpV8CoverageProvider extends ProcessV8CoverageProvider {
  copiedSources = {
    'dist/src/upload/document-parser.cjs': 'src/upload/document-parser.cjs',
  };
}

import type { Plugin } from 'vite';
type ReplacementFn = (originalPath: string, resolvedPath: string) => string | null | undefined;
export interface DetectStaticOptions {
    extensions?: string[];
    replacementFn?: ReplacementFn;
    replacements?: Record<string, ReplacementFn>;
    srcRoot?: string;
    enableReplace?: boolean;
    excludeUnused?: boolean;
    additionalChecks?: Array<(filePath: string) => boolean>;
}
export default function detectTemplateAssets(options?: DetectStaticOptions): Plugin;
export {};
